// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({
  runCompletion: vi.fn(async () => ({ content: '⚠️ err', estimatedTokens: 999999, providerError: true })),
}));
vi.mock('@/lib/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/quota')>();
  return { ...actual, consumeQuota: vi.fn(async () => {}) };
});

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { consumeQuota } = await import('@/lib/quota');

function makeReq() {
  const { token } = generateCSRFToken('http://x');
  const ip = `10.11.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=c-${globalThis.crypto.randomUUID()}` },
    body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }),
  });
}

describe('provider error responses never charge quota', () => {
  it('returns 200 with the error content but does not call consumeQuota', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.content).toBe('⚠️ err');
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });
});
