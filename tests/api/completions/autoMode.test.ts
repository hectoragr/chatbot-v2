// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  pickModelForMessage: vi.fn(async () => 'deepseek-chat'),
  AUTO_FALLBACK_MODEL: 'gpt-4o-mini',
}));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { pickModelForMessage } = await import('@/lib/autoModel');
const { generateCSRFToken } = await import('@/lib/csrf');

const anonId = `c-${globalThis.crypto.randomUUID()}`;
const ip = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

function makeReq(body: Record<string, unknown>) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=${anonId}` },
    body: JSON.stringify(body),
  });
}

describe('completions auto mode', () => {
  it('resolves model=auto via classifier and reports modelUsed', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'AUTO', model: 'auto' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.modelUsed).toBe('deepseek-chat');
    expect(vi.mocked(pickModelForMessage)).toHaveBeenCalledWith('hello');
    // Provider derived from the resolved model, not the client-sent 'AUTO'.
    expect(vi.mocked(runCompletion)).toHaveBeenCalledWith('DEEPSEEK', 'deepseek-chat', expect.any(Array));
  });

  it('reports modelUsed on non-auto requests too', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelUsed).toBe('gpt-4o-mini');
  });
});
