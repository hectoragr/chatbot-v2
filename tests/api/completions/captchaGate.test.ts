// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';
// This suite specifically exercises the anon captcha gate → keep it ENABLED.
process.env.ANON_CAPTCHA_REQUIRED = 'true';

// Toggle the session user per-test so we can cover anon vs logged-in.
let sessionUser: { email: string } | null = null;
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => sessionUser),
  isAdminEmail: () => false,
}));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { issueCaptcha } = await import('@/lib/captcha');

// A valid captcha id + its correct answer, minted from the same secret.
function validCaptcha(): { captchaId: string; captchaAnswer: string } {
  const { id, question } = issueCaptcha();
  const [a, b] = question.match(/\d+/g)!.map(Number);
  return { captchaId: id, captchaAnswer: String(a + b) };
}

function makeReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, ...headers },
    body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini', ...body }),
  });
}

// Unique cookie/ip per case so anon quota / abuse ceilings never pre-block.
const freshHeaders = () => ({
  'x-forwarded-for': `9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  cookie: `anon_id=cap-${globalThis.crypto.randomUUID()}`,
});

describe('anon captcha gate', () => {
  it('rejects an anon request with NO captcha (400 CAPTCHA_REQUIRED)', async () => {
    sessionUser = null;
    const res = await POST(makeReq({}, freshHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('CAPTCHA_REQUIRED');
  });

  it('rejects an anon request with an INVALID captcha answer (400)', async () => {
    sessionUser = null;
    const { captchaId } = validCaptcha();
    const res = await POST(makeReq({ captchaId, captchaAnswer: '99999' }, freshHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('CAPTCHA_REQUIRED');
  });

  it('allows an anon request with a VALID captcha (200)', async () => {
    sessionUser = null;
    const res = await POST(makeReq(validCaptcha(), freshHeaders()));
    expect(res.status).toBe(200);
  });

  it('does NOT require a captcha from a logged-in user', async () => {
    sessionUser = { email: `cap-user-${Date.now()}@x.com` };
    // No captcha fields at all — must not be rejected with CAPTCHA_REQUIRED.
    const res = await POST(makeReq({}, freshHeaders()));
    expect(res.status).not.toBe(400);
    if (res.status === 400) {
      expect((await res.json()).error).not.toBe('CAPTCHA_REQUIRED');
    }
  });
});
