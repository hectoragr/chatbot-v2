// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';
process.env.ANON_CAPTCHA_REQUIRED = 'false'; // anon captcha gate covered elsewhere

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  classifyMessage: vi.fn(async () => ({ model: 'us.amazon.nova-lite-v1:0', docIds: [] })),
  AUTO_FALLBACK_MODEL: 'us.amazon.nova-micro-v1:0',
  HISTORY_WINDOW: 5,
  keywordPreMatch: vi.fn(() => []),
}));
vi.mock('@/lib/adminDocs', () => ({
  listDocTopics: vi.fn(async () => []),
  getDocsForInjection: vi.fn(async () => ''),
}));
vi.mock('@/lib/tokens', () => ({ incrementTokenUsed: vi.fn(async () => {}) }));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { classifyMessage } = await import('@/lib/autoModel');
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
    // Anon tier allows Nova Lite, so the classifier's Nova Lite pick is honored.
    expect(body.modelUsed).toBe('us.amazon.nova-lite-v1:0');
    // Classifier receives the caller's tier allowlist (anon), not providers.
    expect(vi.mocked(classifyMessage)).toHaveBeenCalledWith('hello', {
      allowedModels: ['us.amazon.nova-micro-v1:0', 'us.amazon.nova-lite-v1:0'],
      docTopics: undefined,
      history: [],
    });
    // Bedrock signature: (model, messages, promptId?, opts?) — no provider arg.
    expect(vi.mocked(runCompletion)).toHaveBeenCalledWith('us.amazon.nova-lite-v1:0', expect.any(Array), undefined, undefined);
  });

  it('reports modelUsed on non-auto requests too (tier-gated)', async () => {
    // Anon requests Nova Lite explicitly — allowed for the tier.
    const res = await POST(makeReq({ message: 'hello', provider: 'BEDROCK', model: 'us.amazon.nova-lite-v1:0' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelUsed).toBe('us.amazon.nova-lite-v1:0');
  });

  it('anon requesting a flagship model is downgraded to the tier default', async () => {
    // Sonnet is not in the anon allowlist → falls back to the anon default (Nova Lite).
    const res = await POST(makeReq({ message: 'hello', provider: 'BEDROCK', model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelUsed).toBe('us.amazon.nova-lite-v1:0');
  });

  it('rejects invalid model type', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'BEDROCK', model: 42 }));
    expect(res.status).toBe(400);
  });

  it('rejects AUTO provider paired with a concrete model', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'AUTO', model: 'us.amazon.nova-pro-v1:0' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown provider', async () => {
    const res = await POST(makeReq({ message: 'hello', provider: 'BOGUS', model: 'us.amazon.nova-lite-v1:0' }));
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
        body: JSON.stringify({ message: 'hello', provider: 'BEDROCK', model: 'us.amazon.nova-lite-v1:0' }),
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
