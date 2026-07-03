// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';
process.env.ADMIN_EMAIL = 'admin@test.local';

const sessionUser = vi.hoisted(() => ({ current: null as null | { email: string; name?: string } }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => sessionUser.current), isAdminEmail: () => false }));
const emailSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/email', () => ({ notifyAdminContact: emailSpy }));

const { POST } = await import('@/app/api/contact/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { issueCaptcha } = await import('@/lib/captcha');

function makeReq(body: Record<string, unknown>, ip = `10.9.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { emailSpy.mockClear(); sessionUser.current = null; });

describe('contact route', () => {
  it('rejects anonymous senders without a valid captcha and reissues one', async () => {
    const res = await POST(makeReq({ message: 'hi admin' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('captcha_failed');
    expect(body.captcha.id).toBeTruthy();
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('sends for anonymous senders with a correct captcha, anonymous signature', async () => {
    const { id, question } = issueCaptcha();
    const [a, b] = question.match(/\d+/g)!.map(Number);
    const res = await POST(makeReq({ message: 'hi admin', captchaId: id, captchaAnswer: String(a + b) }));
    expect(res.status).toBe(200);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ fromLabel: 'anonymous visitor', message: 'hi admin' }));
  });

  it('sends for authenticated users without captcha, email signature', async () => {
    sessionUser.current = { email: 'u@x.com' };
    const res = await POST(makeReq({ message: 'hello' }));
    expect(res.status).toBe(200);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ fromLabel: 'u@x.com' }));
  });

  it('rejects oversized messages', async () => {
    sessionUser.current = { email: 'u@x.com' };
    const res = await POST(makeReq({ message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('rate limits after 5 sends per day', async () => {
    sessionUser.current = { email: `limit-${Date.now()}@x.com` };
    for (let i = 0; i < 5; i++) {
      expect((await POST(makeReq({ message: 'm' }))).status).toBe(200);
    }
    expect((await POST(makeReq({ message: 'm' }))).status).toBe(429);
  });
});
