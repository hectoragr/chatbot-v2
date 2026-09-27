// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';
// Anon captcha gate is exercised by lib/captcha.test.ts + a dedicated gate
// test; disable it here so this test can focus on the anon quota behaviour.
process.env.ANON_CAPTCHA_REQUIRED = 'false';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');

// Unique-per-run cookie + ip so persistent Usage rows from prior runs don't
// pre-exhaust the anon quota (blocks on max(cookie, ip)). Fixed across the 4
// calls in the test (same subject), different each run.
const anonId = `c-${globalThis.crypto.randomUUID()}`;
const ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

function makeReq() {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=${anonId}` },
    body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }),
  });
}

describe('completions anon quota', () => {
  it('allows first 3 then blocks with 402', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(makeReq());
      expect(res.status).toBe(200);
    }
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('quota_exceeded');
  });
});
