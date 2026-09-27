// @vitest-environment node
/**
 * Preservation Property Tests
 *
 * **Property 2: Preservation — Single Token and Non-Approved User Charging**
 *
 * These tests capture the CORRECT baseline behavior for all inputs where the
 * bug condition does NOT hold. They MUST PASS on UNFIXED code — passing here
 * confirms the existing behavior we must not regress after the fix.
 *
 * Covered scenarios:
 *   - Test Case 1: Approved user with single OPENAI token → token charged
 *   - Test Case 2: Approved user with single DEEPSEEK token → token charged
 *   - Test Case 3: Unapproved user → consumeQuota called with Usage ledger
 *   - Test Case 4: Anonymous user → consumeQuota called with anon subject
 *   - Test Case 5: Approved user with two OPENAI tokens → best OPENAI token charged
 *   - Test Case 6: Approved user with exhausted tokens → Usage ledger charged (daily fallback)
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Environment setup (must be before any lib imports)
process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret_preservation';
// Case 4 resolves an anon subject to assert charging semantics; the anon
// captcha gate is exercised by captchaGate.test.ts, so disable it here.
process.env.ANON_CAPTCHA_REQUIRED = 'false';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => ({ email: 'user@example.com', name: 'Test User' })),
  isAdminEmail: () => false,
}));

vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user',
    email: 'user@example.com',
    approved: true,
    token: undefined,
    tokens: [],
  })),
}));

vi.mock('@/lib/providers', () => ({
  runCompletion: vi.fn(async () => ({ content: 'test response', estimatedTokens: 50 })),
}));

vi.mock('@/lib/tokens', () => ({
  incrementTokenUsed: vi.fn(async () => {}),
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
  findPatternBlock: vi.fn(async () => null),
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
    token: 'tok-openai-single',
    user_id: 'user@example.com',
    displayName: 'Test Conversation Renamed',
    token_user: 'tok-openai-single#user@example.com',
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
const { consumeQuota, getQuotaStatus } = await import('@/lib/quota');
const subjectModule = await import('@/lib/subject');
const authModule = await import('@/lib/auth');
const resolveSubject = subjectModule.resolveSubject;
const getSessionUser = authModule.getSessionUser;

// ─── Token fixtures ───────────────────────────────────────────────────────────

/** Single OPENAI token, 1000 remaining */
const singleOpenaiToken = {
  token: 'tok-openai-single',
  user_id: 'user@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** Single DEEPSEEK token, 1000 remaining */
const singleDeepseekToken = {
  token: 'tok-deepseek-single',
  user_id: 'user@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** First OPENAI token — more remaining quota (the "best") */
const openaiTokenBest = {
  token: 'tok-openai-best',
  user_id: 'user@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 0,    // 1000 remaining — best
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** Second OPENAI token — less remaining quota */
const openaiTokenSecond = {
  token: 'tok-openai-second',
  user_id: 'user@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 500,  // 500 remaining — not best
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** Exhausted OPENAI token — no remaining quota */
const exhaustedOpenaiToken = {
  token: 'tok-openai-exhausted',
  user_id: 'user@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 1000, // 0 remaining — fully exhausted
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** Exhausted DEEPSEEK token — no remaining quota */
const exhaustedDeepseekToken = {
  token: 'tok-deepseek-exhausted',
  user_id: 'user@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 1000, // 0 remaining — fully exhausted
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

// ─── Quota status helpers ─────────────────────────────────────────────────────

const approvedQuotaStatus = {
  tier: 'approved' as const,
  questionsUsed: 0,
  tokensUsed: 0,
  maxQuestions: null,
  maxTokens: 2000,
  remainingTokens: 2000,
  remainingQuestions: null,
  blocked: false,
  resetsDaily: false,
};

const unapprovedQuotaStatus = {
  tier: 'unapproved' as const,
  questionsUsed: 0,
  tokensUsed: 0,
  maxQuestions: null,
  maxTokens: 1000,
  remainingTokens: 1000,
  remainingQuestions: null,
  blocked: false,
  resetsDaily: true,
};

const anonQuotaStatus = {
  tier: 'anon' as const,
  questionsUsed: 0,
  tokensUsed: 0,
  maxQuestions: 3,
  maxTokens: 1000,
  remainingTokens: 1000,
  remainingQuestions: 3,
  blocked: false,
  resetsDaily: true,
};

const dailyFallbackQuotaStatus = {
  tier: 'approved' as const,
  questionsUsed: 0,
  tokensUsed: 0,
  maxQuestions: null,
  maxTokens: 1000,
  remainingTokens: 1000,
  remainingQuestions: null,
  blocked: false,
  resetsDaily: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(provider: 'OPENAI' | 'DEEPSEEK', model: string) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      'x-forwarded-for': '10.0.0.2',
      cookie: 'anon_id=test-preservation-anon',
    },
    body: JSON.stringify({ message: 'hello world', provider, model }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Property Tests: Single Token and Non-Approved User Charging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getSessionUser to logged-in user by default; individual tests override as needed
    vi.mocked(getSessionUser).mockResolvedValue({ email: 'user@example.com', name: 'Test User', sub: 'auth0|user123' });
    vi.mocked(getQuotaStatus).mockResolvedValue(approvedQuotaStatus);
  });

  /**
   * Test Case 1: Approved user with single OPENAI token makes GPT-4 call.
   *
   * Non-buggy scenario: only one token exists, so charging the "best" token is
   * automatically the correct token. This behavior must be preserved after the fix.
   *
   * Expected: incrementTokenUsed called with the single OPENAI token.
   * consumeQuota must NOT be called.
   *
   * **Validates: Requirements 3.4**
   */
  it('Case 1: approved user with single OPENAI token — token charged for GPT-4o call', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'user@example.com',
      approved: true,
      token: singleOpenaiToken,
      tokens: [singleOpenaiToken],
    });

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    // The single OPENAI token must be charged
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      singleOpenaiToken.token,
      expect.any(Number),
    );
    // Usage ledger must NOT be charged
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });

  /**
   * Test Case 2: Approved user with single DEEPSEEK token makes DeepSeek call.
   *
   * Non-buggy scenario: only one token exists. Behavior identical to Case 1 but
   * for the DeepSeek provider. Must be preserved after the fix.
   *
   * Expected: incrementTokenUsed called with the single DEEPSEEK token.
   * consumeQuota must NOT be called.
   *
   * **Validates: Requirements 3.4**
   */
  it('Case 2: approved user with single DEEPSEEK token — token charged for deepseek-chat call', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'user@example.com',
      approved: true,
      token: singleDeepseekToken,
      tokens: [singleDeepseekToken],
    });

    const res = await POST(makeRequest('DEEPSEEK', 'deepseek-chat'));
    expect(res.status).toBe(200);

    // The single DEEPSEEK token must be charged
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      singleDeepseekToken.token,
      expect.any(Number),
    );
    // Usage ledger must NOT be charged
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });

  /**
   * Test Case 3: Unapproved user makes any completion call.
   *
   * The Usage ledger (keyed by user email) must be charged, not a token.
   * incrementTokenUsed must NOT be called.
   *
   * Expected: consumeQuota called; incrementTokenUsed not called.
   *
   * **Validates: Requirements 3.6**
   */
  it('Case 3: unapproved user — consumeQuota called with Usage ledger, not incrementTokenUsed', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ email: 'unapproved@example.com', name: 'Unapproved User', sub: 'auth0|unapproved123' });
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'unapproved@example.com',
      approved: false,    // unapproved
      token: undefined,
      tokens: [],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue(unapprovedQuotaStatus);

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    // Usage ledger must be charged via consumeQuota
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();
    // No token should be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });

  /**
   * Test Case 4: Anonymous user makes any completion call.
   *
   * The anon Usage ledger (cookie + IP) must be charged. incrementTokenUsed
   * must NOT be called.
   *
   * Expected: consumeQuota called with anon subject; incrementTokenUsed not called.
   *
   * **Validates: Requirements 3.7**
   */
  it('Case 4: anonymous user — consumeQuota called with anon subject, not incrementTokenUsed', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null); // no session → anonymous
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'anon',
      anonId: 'test-anon-cookie',
      ip: '10.0.0.2',
    });
    vi.mocked(getQuotaStatus).mockResolvedValue(anonQuotaStatus);

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    // Anonymous usage ledger must be charged
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();

    // Verify the subject passed to consumeQuota is the anon subject
    const consumeQuotaCall = vi.mocked(consumeQuota).mock.calls[0];
    expect(consumeQuotaCall[0]).toMatchObject({ kind: 'anon' });

    // No token should be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });

  /**
   * Test Case 5: Approved user with two OPENAI tokens makes GPT-4 call.
   *
   * Both tokens are the same provider (OPENAI). The bug condition does NOT hold
   * here (no provider mismatch). The "best" OPENAI token (most remaining quota)
   * should be charged. This behavior must be preserved after the fix.
   *
   * Expected: incrementTokenUsed called with the best (most remaining) OPENAI token.
   *
   * **Validates: Requirements 3.4**
   */
  it('Case 5: approved user with two OPENAI tokens — best OPENAI token charged for GPT-4o call', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'user@example.com',
      approved: true,
      token: openaiTokenBest,       // "best" token — 1000 remaining
      tokens: [openaiTokenBest, openaiTokenSecond],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue({
      ...approvedQuotaStatus,
      tokensUsed: 500,
      maxTokens: 2000,
      remainingTokens: 1500,
    });

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    // The best OPENAI token (1000 remaining) must be charged
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiTokenBest.token,
      expect.any(Number),
    );
    // The second OPENAI token must NOT be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      openaiTokenSecond.token,
      expect.any(Number),
    );
    // Usage ledger must NOT be charged
    expect(vi.mocked(consumeQuota)).not.toHaveBeenCalled();
  });

  /**
   * Test Case 6: Approved user with all tokens exhausted makes call.
   *
   * When ALL tokens are exhausted, subject.token is undefined (no token has
   * remaining quota), so the charging logic falls through to consumeQuota
   * (daily 1000-token fallback). This behavior must be preserved.
   *
   * Expected: consumeQuota called; incrementTokenUsed NOT called.
   *
   * **Validates: Requirements 3.5**
   */
  it('Case 6: approved user with exhausted tokens — Usage ledger (daily fallback) charged', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'user@example.com',
      approved: true,
      // subject.token is undefined: resolveSubject sets this to undefined when all tokens
      // are exhausted (the sort picks the best but it has 0 remaining, so token is still set;
      // however the charging guard `(subject.token.limit - subject.token.used) > 0` will be false)
      token: { ...exhaustedOpenaiToken }, // token exists but has 0 remaining
      tokens: [exhaustedOpenaiToken, exhaustedDeepseekToken],
    });
    vi.mocked(getQuotaStatus).mockResolvedValue(dailyFallbackQuotaStatus);

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    // Daily fallback: consumeQuota must be called because the token guard
    // `(subject.token.limit - subject.token.used) > 0` evaluates to false
    expect(vi.mocked(consumeQuota)).toHaveBeenCalled();
    // No individual token should be incremented
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalled();
  });
});
