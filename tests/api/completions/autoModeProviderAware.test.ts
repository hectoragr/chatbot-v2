// @vitest-environment node
/**
 * Integration test: auto mode must not pick a provider the approved user
 * cannot cover with their active tokens.
 *
 * An approved user holding only an OPENAI token who sends an auto-mode
 * message classified as "moderate" must be routed to the OPENAI candidate
 * (gpt-4o-mini), not deepseek-chat — otherwise selectTokenForProvider finds no
 * DEEPSEEK/ANY token and falls back to charging the OPENAI token for DeepSeek
 * usage (cross-provider billing).
 *
 * Follows the mocking pattern in tests/api/completions/multiTokenCharging.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret_auto_provider_aware';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => ({ email: 'openai-only@example.com', name: 'OpenAI Only User', sub: 'auth0|test' })),
  isAdminEmail: () => false,
}));

vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user',
    email: 'openai-only@example.com',
    approved: true,
    token: undefined,
    tokens: [],
  })),
}));

vi.mock('@/lib/tokens', () => ({
  incrementTokenUsed: vi.fn(async () => {}),
}));

// Real pickModelForMessage logic is exercised (not mocked) so this test proves
// the route wires allowedProviders through correctly; only the underlying
// classifier network call (lib/providers.runCompletion) is mocked to return a
// "moderate" classification. The same mock also serves as the real completion
// call (route calls runCompletion twice: once to classify, once to answer).
vi.mock('@/lib/providers', () => ({
  runCompletion: vi.fn(async () => ({ content: 'moderate', estimatedTokens: 50 })),
}));

vi.mock('@/lib/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/quota')>();
  return {
    ...actual,
    consumeQuota: vi.fn(async () => {}),
    getQuotaStatus: vi.fn(async () => ({
      tier: 'approved' as const,
      questionsUsed: 0,
      tokensUsed: 0,
      maxQuestions: null,
      maxTokens: 2000,
      remainingTokens: 2000,
      remainingQuestions: null,
      blocked: false,
      resetsDaily: false,
    })),
  };
});

vi.mock('@/lib/abuse', () => ({
  recordHitAndMaybeBlock: vi.fn(async () => false),
}));

vi.mock('@/lib/blocks', () => ({
  findBlock: vi.fn(async () => null),
  blockSubjects: vi.fn(() => []),
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
    token: 'tok-openai-only',
    user_id: 'openai-only@example.com',
    displayName: 'Test Conversation',
    token_user: 'tok-openai-only#openai-only@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: 'OPENAI',
    messages: [],
  })),
  appendMessages: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  runSmallModelForSummary: vi.fn(async () => 'Test title'),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { incrementTokenUsed } = await import('@/lib/tokens');
const { runCompletion } = await import('@/lib/providers');
const subjectModule = await import('@/lib/subject');
const resolveSubject = subjectModule.resolveSubject;

// ─── Token fixtures ───────────────────────────────────────────────────────────

const openaiOnlyToken = {
  token: 'tok-openai-only',
  user_id: 'openai-only@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest() {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      'x-forwarded-for': '10.0.0.9',
      cookie: 'anon_id=test-auto-provider-aware-anon',
    },
    body: JSON.stringify({ message: 'please summarize this document', provider: 'AUTO', model: 'auto' }),
  });
}

describe('Integration: Auto mode is provider-aware for token-holding approved users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runCompletion).mockResolvedValue({ content: 'moderate', estimatedTokens: 50 });
  });

  it('approved user with only an OPENAI token routes moderate auto-mode to gpt-4o-mini and charges the OPENAI token', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'openai-only@example.com',
      approved: true,
      token: openaiOnlyToken,
      tokens: [openaiOnlyToken],
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Must NOT be routed to deepseek-chat (the unconstrained "moderate" default) —
    // the user has no DEEPSEEK/ANY token to cover it.
    expect(body.modelUsed).toBe('gpt-4o-mini');

    // The classification call itself always runs on OPENAI/gpt-4.1-nano regardless
    // of allowedProviders — only the final chosen model call matters here.
    // The second runCompletion call is the real completion; assert it used OPENAI.
    const calls = vi.mocked(runCompletion).mock.calls;
    const completionCall = calls[calls.length - 1];
    expect(completionCall[0]).toBe('OPENAI');
    expect(completionCall[1]).toBe('gpt-4o-mini');

    // The OPENAI token must be charged — never cross-provider billed.
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiOnlyToken.token,
      expect.any(Number),
    );
  });
});
