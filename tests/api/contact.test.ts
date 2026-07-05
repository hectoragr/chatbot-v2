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
const emailSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/email', () => ({ notifyAdminContact: emailSpy }));
const abuseSpy = vi.hoisted(() => ({ blocked: false }));
vi.mock('@/lib/abuse', () => ({ recordHitAndMaybeBlock: vi.fn(async () => abuseSpy.blocked) }));

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

beforeEach(() => { emailSpy.mockClear(); sessionUser.current = null; abuseSpy.blocked = false; });

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
    const email = `auth-${Date.now()}@x.com`;
    sessionUser.current = { email };
    const res = await POST(makeReq({ message: 'hello' }));
    expect(res.status).toBe(200);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ fromLabel: email }));
  });

  it('rejects oversized messages', async () => {
    sessionUser.current = { email: `oversized-${Date.now()}@x.com` };
    const res = await POST(makeReq({ message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('rate limits after 10 sends per day', async () => {
    sessionUser.current = { email: `limit-${Date.now()}@x.com` };
    for (let i = 0; i < 10; i++) {
      expect((await POST(makeReq({ message: 'm' }))).status).toBe(200);
    }
    expect((await POST(makeReq({ message: 'm' }))).status).toBe(429);
  });

  it('rejects a blocked subject with 403 and never calls the email spy', async () => {
    sessionUser.current = { email: `blocked-${Date.now()}@x.com` };
    abuseSpy.blocked = true;
    const res = await POST(makeReq({ message: 'hi admin' }));
    expect(res.status).toBe(403);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('returns 500 before consuming a rate-limit slot when ADMIN_EMAIL is unset', async () => {
    const email = `noadmin-${Date.now()}@x.com`;
    sessionUser.current = { email };
    const original = process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_EMAIL;
    try {
      const res = await POST(makeReq({ message: 'hi admin' }));
      expect(res.status).toBe(500);
      expect(emailSpy).not.toHaveBeenCalled();
    } finally {
      process.env.ADMIN_EMAIL = original;
    }
    // The failed attempt above must not have consumed a daily rate-limit slot:
    // all 10 allowed sends should still succeed now that ADMIN_EMAIL is restored.
    for (let i = 0; i < 10; i++) {
      expect((await POST(makeReq({ message: 'm' }))).status).toBe(200);
    }
    expect((await POST(makeReq({ message: 'm' }))).status).toBe(429);
  });

  it('returns 502 when notifyAdminContact fails to send', async () => {
    sessionUser.current = { email: `sendfail-${Date.now()}@x.com` };
    emailSpy.mockResolvedValueOnce(false);
    const res = await POST(makeReq({ message: 'hi admin' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('send_failed');
  });

  it('strips control chars (zero-width) while preserving \\n and \\t before the email spy sees the message', async () => {
    sessionUser.current = { email: `ctrl-${Date.now()}@x.com` };
    const zeroWidth = '​'; // zero-width space (Cf category)
    const raw = `line1${zeroWidth}\nline2\tindented${zeroWidth}`;
    const res = await POST(makeReq({ message: raw }));
    expect(res.status).toBe(200);
    const lastCall = emailSpy.mock.calls.at(-1) as unknown as [{ message: string }];
    const sentMessage = lastCall[0].message;
    expect(sentMessage).not.toContain(zeroWidth);
    expect(sentMessage).toContain('\n');
    expect(sentMessage).toContain('\t');
    expect(sentMessage).toBe('line1\nline2\tindented');
  });
});
