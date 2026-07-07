// @vitest-environment node
/**
 * Integration Tests: Full Completion Flow — Multi-Token Charging
 *
 * These tests verify the end-to-end multi-token charging flow after the fix.
 * They exercise the full POST handler with provider-aware token selection.
 *
 * Test Cases:
 *   1. Multi-token user makes provider-specific calls → correct token charged per provider
 *   2. Multi-token user with 'ANY' provider token → ANY token charged as fallback
 *   3. Sequential requests alternate providers correctly
 *   4. Exhaustion of provider-specific token falls back correctly
 *   5. Quota display updates correctly after charging
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Environment setup (must be before imports)
process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret_integration';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => ({ email: 'multi@example.com', name: 'Multi Token User', sub: 'auth0|test' })),
  isAdminEmail: () => false,
}));

vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user',
    email: 'multi@example.com',
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
    token: 'tok-openai',
    user_id: 'multi@example.com',
    displayName: 'Test Conversation',
    token_user: 'tok-openai#multi@example.com',
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
const { getQuotaStatus } = await import('@/lib/quota');
const subjectModule = await import('@/lib/subject');
const resolveSubject = subjectModule.resolveSubject;

// ─── Token fixtures ───────────────────────────────────────────────────────────

const openaiToken = {
  token: 'tok-openai',
  user_id: 'multi@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const deepseekToken = {
  token: 'tok-deepseek',
  user_id: 'multi@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const anyToken = {
  token: 'tok-any',
  user_id: 'multi@example.com',
  provider: 'ANY' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const openaiTokenPartial = {
  token: 'tok-openai-partial',
  user_id: 'multi@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 100,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const deepseekTokenPartial = {
  token: 'tok-deepseek-partial',
  user_id: 'multi@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 200,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const deepseekTokenExhausted = {
  token: 'tok-deepseek-exhausted',
  user_id: 'multi@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 100,
  used: 100,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(provider: 'OPENAI' | 'DEEPSEEK', model: string) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      'x-forwarded-for': '10.0.0.3',
      cookie: 'anon_id=test-integration-anon',
    },
    body: JSON.stringify({ message: 'hello', provider, model }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: Multi-Token Charging Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test Case 1: Multi-token user makes provider-specific calls.
   *
   * User has both OPENAI and DEEPSEEK tokens. Each request should charge the
   * provider-appropriate token.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  describe('Test Case 1: Provider-specific calls charge correct token', () => {
    it('GPT-4o request charges OPENAI token', async () => {
      vi.mocked(resolveSubject).mockResolvedValue({
        kind: 'user',
        email: 'multi@example.com',
        approved: true,
        token: openaiToken, // best token
        tokens: [openaiToken, deepseekToken],
      });

      const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
      expect(res.status).toBe(200);

      expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
        openaiToken.token,
        expect.any(Number),
      );
      expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
        deepseekToken.token,
        expect.any(Number),
      );
    });

    it('DeepSeek request charges DEEPSEEK token', async () => {
      vi.mocked(resolveSubject).mockResolvedValue({
        kind: 'user',
        email: 'multi@example.com',
        approved: true,
        token: openaiToken, // best token (OPENAI has more remaining)
        tokens: [openaiToken, deepseekToken],
      });

      const res = await POST(makeRequest('DEEPSEEK', 'deepseek-chat'));
      expect(res.status).toBe(200);

      expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
        deepseekToken.token,
        expect.any(Number),
      );
      expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
        openaiToken.token,
        expect.any(Number),
      );
    });
  });

  /**
   * Test Case 2: Multi-token user with 'ANY' provider token.
   *
   * User has OPENAI and ANY tokens, but no DEEPSEEK-specific token. When making
   * a DeepSeek request, the ANY token should be charged as fallback.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it('Test Case 2: ANY token charged when no provider-specific token exists', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'multi@example.com',
      approved: true,
      token: openaiToken, // best token
      tokens: [openaiToken, anyToken],
    });

    const res = await POST(makeRequest('DEEPSEEK', 'deepseek-chat'));
    expect(res.status).toBe(200);

    // ANY token should be charged (no DEEPSEEK-specific token exists)
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      anyToken.token,
      expect.any(Number),
    );
    // OPENAI token should NOT be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      openaiToken.token,
      expect.any(Number),
    );
  });

  /**
   * Test Case 3: Sequential requests alternate providers correctly.
   *
   * Makes alternating OpenAI and DeepSeek requests. Each should charge the
   * provider-appropriate token consistently.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  describe('Test Case 3: Sequential requests alternate providers correctly', () => {
    it('alternating provider requests charge correct tokens each time', async () => {
      // Use tokens with partial usage (like realistic scenario)
      vi.mocked(resolveSubject).mockResolvedValue({
        kind: 'user',
        email: 'multi@example.com',
        approved: true,
        token: openaiTokenPartial, // best: 900 remaining vs 800
        tokens: [openaiTokenPartial, deepseekTokenPartial],
      });

      // Request 1: OpenAI → OPENAI token charged
      const res1 = await POST(makeRequest('OPENAI', 'gpt-4o'));
      expect(res1.status).toBe(200);
      expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
        openaiTokenPartial.token,
        expect.any(Number),
      );

      vi.mocked(incrementTokenUsed).mockClear();

      // Request 2: DeepSeek → DEEPSEEK token charged
      const res2 = await POST(makeRequest('DEEPSEEK', 'deepseek-chat'));
      expect(res2.status).toBe(200);
      expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
        deepseekTokenPartial.token,
        expect.any(Number),
      );

      vi.mocked(incrementTokenUsed).mockClear();

      // Request 3: OpenAI again → OPENAI token charged again
      const res3 = await POST(makeRequest('OPENAI', 'gpt-4o'));
      expect(res3.status).toBe(200);
      expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
        openaiTokenPartial.token,
        expect.any(Number),
      );
    });
  });

  /**
   * Test Case 4: Exhaustion of provider-specific token falls back correctly.
   *
   * DEEPSEEK token is exhausted (100/100), OPENAI token has quota. When making
   * a DeepSeek request, the system should fall back to the best token (OPENAI)
   * since no DEEPSEEK token has remaining quota and no 'ANY' token exists.
   *
   * **Validates: Requirements 2.1, 2.3**
   */
  it('Test Case 4: exhausted provider token falls back to best token', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'multi@example.com',
      approved: true,
      token: openaiToken, // best token (1000 remaining; DEEPSEEK is exhausted)
      tokens: [deepseekTokenExhausted, openaiToken],
    });

    const res = await POST(makeRequest('DEEPSEEK', 'deepseek-chat'));
    expect(res.status).toBe(200);

    // DEEPSEEK is exhausted, no ANY token → falls back to best token (OPENAI)
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiToken.token,
      expect.any(Number),
    );
    // Exhausted DEEPSEEK token must NOT be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      deepseekTokenExhausted.token,
      expect.any(Number),
    );
  });

  /**
   * Test Case 5: Quota display updates correctly after charging.
   *
   * After a completion request charges the correct provider token, the response
   * should reflect updated quota information. We verify that getQuotaStatus is
   * called after the charging step and the response includes remaining info.
   *
   * **Validates: Requirements 2.2, 2.3**
   */
  it('Test Case 5: quota display updates correctly after charging', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'multi@example.com',
      approved: true,
      token: openaiToken,
      tokens: [openaiToken, deepseekToken],
    });

    // First call to getQuotaStatus (pre-check): quota is fine
    // Second call to getQuotaStatus (post-charge): reflects updated remaining
    vi.mocked(getQuotaStatus)
      .mockResolvedValueOnce({
        tier: 'approved' as const,
        questionsUsed: 0,
        tokensUsed: 0,
        maxQuestions: null,
        maxTokens: 2000,
        remainingTokens: 2000,
        remainingQuestions: null,
        blocked: false,
        resetsDaily: false,
      })
      .mockResolvedValueOnce({
        tier: 'approved' as const,
        questionsUsed: 0,
        tokensUsed: 50,
        maxQuestions: null,
        maxTokens: 2000,
        remainingTokens: 1950,
        remainingQuestions: null,
        blocked: false,
        resetsDaily: false,
      });

    const res = await POST(makeRequest('OPENAI', 'gpt-4o'));
    expect(res.status).toBe(200);

    const body = await res.json();

    // Response should include remaining tokens from the post-charge quota check
    expect(body.remaining).toBe(1950);
    expect(body.blocked).toBe(false);

    // Verify token was charged
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiToken.token,
      expect.any(Number),
    );

    // getQuotaStatus should have been called twice (pre and post)
    expect(vi.mocked(getQuotaStatus)).toHaveBeenCalledTimes(2);
  });
});
