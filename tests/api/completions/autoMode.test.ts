// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  classifyMessage: vi.fn(async () => ({ model: 'deepseek-chat', docIds: [] })),
  AUTO_FALLBACK_MODEL: 'gpt-4o-mini',
}));
vi.mock('@/lib/adminDocs', () => ({
  listDocTopics: vi.fn(async () => []),
  getDocsForInjection: vi.fn(async () => ''),
}));
vi.mock('@/lib/tokens', () => ({ incrementTokenUsed: vi.fn(async () => {}) }));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { classifyMessage } = await import('@/lib/autoModel');
const { incrementTokenUsed } = await import('@/lib/tokens');
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
    expect(vi.mocked(classifyMessage)).toHaveBeenCalledWith('hello', { allowedProviders: undefined, docTopics: undefined });
    // Provider derived from the resolved model, not the client-sent 'AUTO'.
    expect(vi.mocked(runCompletion)).toHaveBeenCalledWith('DEEPSEEK', 'deepseek-chat', expect.any(Array), undefined, undefined);
  });

  it('reports modelUsed on non-auto requests too', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelUsed).toBe('gpt-4o-mini');
  });

  it('rejects invalid model type', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'OPENAI', model: 42 }));
    expect(res.status).toBe(400);
  });

  it('rejects AUTO provider paired with a concrete model', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'AUTO', model: 'gpt-4o' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown provider', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'BOGUS', model: 'gpt-4o' }));
    expect(res.status).toBe(400);
  });
});

describe('completions auto mode: gated users never invoke the classifier', () => {
  beforeEach(() => {
    vi.mocked(classifyMessage).mockClear();
  });

  it('anon quota exhaustion returns 402 and never calls the classifier', async () => {
    const localAnonId = `c-${globalThis.crypto.randomUUID()}`;
    const localIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    function req() {
      const { token } = generateCSRFToken('http://x');
      return new Request('http://x/api/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': localIp, cookie: `anon_id=${localAnonId}` },
        body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }),
      });
    }
    // Exhaust the anon quota (3 questions/day) with non-auto requests first.
    for (let i = 0; i < 3; i++) {
      const res = await POST(req());
      expect(res.status).toBe(200);
    }
    vi.mocked(classifyMessage).mockClear();

    const { token } = generateCSRFToken('http://x');
    const gatedRes = await POST(new Request('http://x/api/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': localIp, cookie: `anon_id=${localAnonId}` },
      body: JSON.stringify({ message: 'hello', provider: 'AUTO', model: 'auto' }),
    }));
    expect(gatedRes.status).toBe(402);
    expect(vi.mocked(classifyMessage)).not.toHaveBeenCalled();
  });
});
