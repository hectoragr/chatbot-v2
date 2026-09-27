// @vitest-environment node
/**
 * Preservation Property Tests — Charging semantics (Bedrock-only)
 *
 * After the Bedrock cutover there is NO provider dimension: every token bills
 * via IAM, so token selection is "best token with remaining room", and the
 * charge falls through to the Usage ledger for anon / unapproved / exhausted
 * users. These tests lock that charging behavior. (The old per-provider
 * token-matching tests were removed with selectTokenForProvider.)
 *
 * Covered:
 *   - Case 1: approved user with a single token → that token charged
 *   - Case 3: unapproved user → Usage ledger charged (no token)
 *   - Case 4: anonymous user → anon Usage ledger charged
 *   - Case 5: approved user with two tokens → best (most-remaining) token charged
 *   - Case 6: approved user with all tokens exhausted → daily ledger fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret_preservation';
process.env.ANON_CAPTCHA_REQUIRED = 'false';

const NOVA_LITE = 'us.amazon.nova-lite-v1:0';        // anon/unapproved-allowed
const SONNET = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'; // approved-only

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => ({ email: 'user@example.com', name: 'Test User' })),
  isAdminEmail: () => false,
}));

vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user', email: 'user@example.com', approved: true, token: undefined, tokens: [],
  })),
}));

vi.mock('@/lib/providers', () => ({
  runCompletion: vi.fn(async () => ({ content: 'test response', estimatedTokens: 50 })),
}));

vi.mock('@/lib/tokens', () => ({ incrementTokenUsed: vi.fn(async () => {}) }));

vi.mock('@/lib/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/quota')>();
  return {
    ...actual,
    consumeQuota: vi.fn(async () => {}),
    getQuotaStatus: vi.fn(async () => ({
      tier: 'approved' as const, questionsUsed: 0, tokensUsed: 0, maxQuestions: null,
      maxTokens: 2000, remainingTokens: 2000, remainingQuestions: null, blocked: false, resetsDaily: false,
    })),
  };
});

vi.mock('@/lib/abuse', () => ({ recordHitAndMaybeBlock: vi.fn(async () => false) }));
vi.mock('@/lib/blocks', () => ({
  findBlock: vi.fn(async () => null), findPatternBlock: vi.fn(async () => null), blockSubjects: vi.fn(() => []),
}));

vi.mock('@/lib/conversations', () => ({
  ensureConversation: vi.fn(async (_id: string | undefined, token: string, email: string, provider: string) => ({
    conversation_id: 'test-convo-id', token, user_id: email, displayName: 'Test Conversation',
    token_user: `${token}#${email}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    provider, messages: [],
  })),
  getConversation: vi.fn(async () => ({
    conversation_id: 'test-convo-id', token: 'tok-single', user_id: 'user@example.com',
    displayName: 'Test Conversation Renamed', token_user: 'tok-single#user@example.com',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), provider: 'BEDROCK', messages: [],
  })),
  appendMessages: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  runSmallModelForSummary: vi.fn(async () => 'Test title'),
}));

const { POST } = await import('@/app/api/completions/route');
const { generateCSRFToken } = await import('@/lib/csrf');
const { incrementTokenUsed } = await import('@/lib/tokens');
const { consumeQuota, getQuotaStatus } = await import('@/lib/quota');
const subjectModule = await import('@/lib/subject');
const authModule = await import('@/lib/auth');
const resolveSubject = subjectModule.resolveSubject;
const getSessionUser = authModule.getSessionUser;

// Tokens are provider-agnostic now ('ANY'). Only remaining room matters.
const mkToken = (token: string, used: number) => ({
  token, user_id: 'user@example.com', provider: 'ANY' as const,
  limit: 1000, used, isActive: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
});
const singleToken = mkToken('tok-single', 0);
const tokenBest = mkToken('tok-best', 0);       // 1000 remaining
const tokenSecond = mkToken('tok-second', 500); // 500 remaining
const exhaustedA = mkToken('tok-exhausted-a', 1000);
const exhaustedB = mkToken('tok-exhausted-b', 1000);

const approvedQuota = {
  tier: 'approved' as const, questionsUsed: 0, tokensUsed: 0, maxQuestions: null,
  maxTokens: 2000, remainingTokens: 2000, remainingQuestions: null, blocked: false, resetsDaily: false,
};
const unapprovedQuota = {
  tier: 'unapproved' as const, questionsUsed: 0, tokensUsed: 0, maxQuestions: null,
  maxTokens: 1000, remainingTokens: 1000, remainingQuestions: null, blocked: false, resetsDaily: true,
};
const anonQuota = {
  tier: 'anon' as const, questionsUsed: 0, tokensUsed: 0, maxQuestions: 3,
  maxTokens: 1000, remainingTokens: 1000, remainingQuestions: 3, blocked: false, resetsDaily: true,
};
const dailyFallbackQuota = {
  tier: 'approved' as const, questionsUsed: 0, tokensUsed: 0, maxQuestions: null,
  maxTokens: 1000, remainingTokens: 1000, remainingQuestions: null, blocked: false, resetsDaily: true,
};

function makeRequest(model: string) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-csrf-token': token,
      'x-forwarded-for': '10.0.0.2', cookie: 'anon_id=test-preservation-anon',
    },
    body: JSON.stringify({ message: 'hello world', provider: 'BEDROCK', model }),
  });
}

describe('Preservation — charging semantics (Bedrock-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionUser).mockResolvedValue({ email: 'user@example.com', name: 'Test User', sub: 'auth0|user123' });
    vi.mocked(getQuotaStatus).mockResolvedValue(approvedQuota);
  });

  it('Case 1: approved user with a single token — that token is charged', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user', email: 'user@example.com', approved: true, token: singleToken, tokens: [singleToken],
    });
    const res = await POST(makeRequest(SONNET)); // approved may use the flagship
    expect(res.status).toBe(200);
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(singleToken.token, expect.any(Number));
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });

  it('Case 3: unapproved user — Usage ledger charged, no token', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ email: 'unapproved@example.com', name: 'Unapproved', sub: 'auth0|u2' });
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user', email: 'unapproved@example.com', approved: false, token: undefined, tokens: [],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue(unapprovedQuota);
    const res = await POST(makeRequest(NOVA_LITE));
    expect(res.status).toBe(200);
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });

  it('Case 4: anonymous user — anon Usage ledger charged', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(resolveSubject).mockResolvedValue({ kind: 'anon', anonId: 'test-anon-cookie', ip: '10.0.0.2' });
    vi.mocked(getQuotaStatus).mockResolvedValue(anonQuota);
    const res = await POST(makeRequest(NOVA_LITE));
    expect(res.status).toBe(200);
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();
    expect(vi.mocked(consumeQuota).mock.calls[0][0]).toMatchObject({ kind: 'anon' });
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });

  it('Case 5: approved user with two tokens — best (most-remaining) token charged', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user', email: 'user@example.com', approved: true, token: tokenBest, tokens: [tokenBest, tokenSecond],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue({ ...approvedQuota, tokensUsed: 500, remainingTokens: 1500 });
    const res = await POST(makeRequest(SONNET));
    expect(res.status).toBe(200);
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(tokenBest.token, expect.any(Number));
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(tokenSecond.token, expect.any(Number));
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });

  it('Case 6: approved user with all tokens exhausted — daily ledger fallback', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user', email: 'user@example.com', approved: true,
      token: { ...exhaustedA }, tokens: [exhaustedA, exhaustedB],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue(dailyFallbackQuota);
    const res = await POST(makeRequest(SONNET));
    expect(res.status).toBe(200);
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });
});
