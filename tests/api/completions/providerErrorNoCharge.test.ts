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
vi.mock('@/lib/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tokens')>();
  return { ...actual, incrementTokenUsed: vi.fn(async () => {}) };
});
vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user',
    email: 'token-holder@example.com',
    approved: true,
    token: undefined,
    tokens: [],
  })),
}));
vi.mock('@/lib/conversations', () => ({
  ensureConversation: vi.fn(async (_id: string | undefined, token: string, email: string, provider: string) => ({
    conversation_id: 'test-convo-id',
    token,
    user_id: email,
    displayName: 'Test Conversation',
    token_user: `${token}#${email}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider,
    messages: [],
  })),
  getConversation: vi.fn(async () => ({
    conversation_id: 'test-convo-id',
    token: 'tok-provider-error',
    user_id: 'token-holder@example.com',
    displayName: 'Test Conversation',
    token_user: 'tok-provider-error#token-holder@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: 'OPENAI',
    messages: [],
  })),
  appendMessages: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  runSmallModelForSummary: vi.fn(async () => 'Test title'),
}));

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { consumeQuota } = await import('@/lib/quota');
const { incrementTokenUsed } = await import('@/lib/tokens');
const subjectModule = await import('@/lib/subject');
const resolveSubject = subjectModule.resolveSubject;

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

  it('approved user with an active token is not charged (incrementTokenUsed not called) on a provider error', async () => {
    vi.mocked(resolveSubject).mockResolvedValueOnce({
      kind: 'user',
      email: 'token-holder@example.com',
      approved: true,
      token: {
        token: 'tok-provider-error',
        user_id: 'token-holder@example.com',
        provider: 'OPENAI',
        limit: 1000,
        used: 0,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      tokens: [{
        token: 'tok-provider-error',
        user_id: 'token-holder@example.com',
        provider: 'OPENAI',
        limit: 1000,
        used: 0,
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }],
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.content).toBe('⚠️ err');
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });
});
