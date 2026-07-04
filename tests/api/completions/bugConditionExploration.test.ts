// @vitest-environment node
/**
 * Bug Condition Exploration Test
 *
 * **Property 1: Bug Condition — Wrong Provider Token Charged**
 *
 * This test encodes the EXPECTED (correct) behavior:
 *   - When a DeepSeek model is used, the DEEPSEEK token should be charged.
 *   - When an OpenAI model is used, the OPENAI token should be charged.
 *
 * On UNFIXED code this test FAILS — proving the bug exists.
 * After the fix is applied (Task 3), this same test should PASS.
 *
 * Counterexamples expected on unfixed code:
 *   - "OPENAI token charged for DeepSeek R1 call when DEEPSEEK token available"
 *   - "DEEPSEEK token charged for GPT-4 call when OPENAI token available"
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Environment setup (must be before imports)
process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret_bugfix';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock getSessionUser so the request is treated as a logged-in user
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => ({ email: 'approved@example.com', name: 'Test User' })),
  isAdminEmail: () => false,
}));

// Mock resolveSubject so we can control which tokens are returned
vi.mock('@/lib/subject', () => ({
  resolveSubject: vi.fn(async () => ({
    kind: 'user',
    email: 'approved@example.com',
    approved: true,
    token: undefined,
    tokens: [],
  })),
}));

// Mock runCompletion so no real API calls happen; cost = 50 tokens
vi.mock('@/lib/providers', () => ({
  runCompletion: vi.fn(async () => ({ content: 'test response', estimatedTokens: 50 })),
}));

// Mock incrementTokenUsed so we can spy on which token is charged
vi.mock('@/lib/tokens', () => ({
  incrementTokenUsed: vi.fn(async () => {}),
}));

// Mock consumeQuota to prevent side effects, and override getQuotaStatus for controlled responses
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

// Mock abuse control to always allow requests
vi.mock('@/lib/abuse', () => ({
  recordHitAndMaybeBlock: vi.fn(async () => false),
}));

// Mock blocks to always return no block
vi.mock('@/lib/blocks', () => ({
  findBlock: vi.fn(async () => null),
  findPatternBlock: vi.fn(async () => null),
  blockSubjects: vi.fn(() => []),
}));

// Mock conversation helpers to avoid DB operations
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
    token: 'tok-openai-best',
    user_id: 'approved@example.com',
    displayName: 'Test Conversation Renamed',
    token_user: 'tok-openai-best#approved@example.com',
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
// resolveSubject is mocked above — import to get a typed reference for vi.mocked()
const subjectModule = await import('@/lib/subject');
const resolveSubject = subjectModule.resolveSubject;

// ─── Token fixtures ───────────────────────────────────────────────────────────

/** OPENAI token with more remaining quota — this becomes the "best" token */
const openaiToken = {
  token: 'tok-openai-best',
  user_id: 'approved@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** DEEPSEEK token with less remaining quota — NOT the "best" token */
const deepseekToken = {
  token: 'tok-deepseek-less',
  user_id: 'approved@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 500,  // only 500 remaining — less than openaiToken's 1000
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** DEEPSEEK token with more remaining quota — becomes the "best" token */
const deepseekTokenBest = {
  token: 'tok-deepseek-best',
  user_id: 'approved@example.com',
  provider: 'DEEPSEEK' as const,
  limit: 1000,
  used: 0,   // 1000 remaining — most quota
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/** OPENAI token with less remaining quota — NOT the "best" token */
const openaiTokenLess = {
  token: 'tok-openai-less',
  user_id: 'approved@example.com',
  provider: 'OPENAI' as const,
  limit: 1000,
  used: 500,  // only 500 remaining — less than deepseekTokenBest's 1000
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCompletionRequest(provider: 'OPENAI' | 'DEEPSEEK', model: string) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': token,
      'x-forwarded-for': '10.0.0.1',
      cookie: 'anon_id=test-anon',
    },
    body: JSON.stringify({ message: 'hello', provider, model }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration: Wrong Provider Token Charged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Case 1: OPENAI token is "best" (most remaining quota), but DeepSeek model is requested.
   *
   * Expected (correct) behavior: DEEPSEEK token should be charged.
   * Actual (buggy) behavior:     OPENAI token is charged (the "best" token).
   *
   * This test FAILS on unfixed code — counterexample:
   *   "OPENAI token charged for DeepSeek R1 call when DEEPSEEK token available"
   *
   * **Validates: Requirements 1.1, 1.3**
   */
  it('Case 1: charges DEEPSEEK token for deepseek-reasoner (R1) call — not the OPENAI best token', async () => {
    // Subject: OPENAI token is best (1000 remaining), DEEPSEEK token has 500 remaining
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'approved@example.com',
      approved: true,
      token: openaiToken,           // "best" token — most remaining quota
      tokens: [openaiToken, deepseekToken],
    });

    const req = makeCompletionRequest('DEEPSEEK', 'deepseek-reasoner');
    const res = await POST(req);

    expect(res.status).toBe(200);

    // The DEEPSEEK token should be charged for a DeepSeek model call
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      deepseekToken.token,  // tok-deepseek-less
      expect.any(Number),
    );

    // The OPENAI token must NOT be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      openaiToken.token,    // tok-openai-best
      expect.any(Number),
    );
  });

  /**
   * Case 2: OPENAI token is "best" (most remaining quota), but deepseek-chat (V3) is requested.
   *
   * Expected (correct) behavior: DEEPSEEK token should be charged.
   * Actual (buggy) behavior:     OPENAI token is charged (the "best" token).
   *
   * This test FAILS on unfixed code — counterexample:
   *   "OPENAI token charged for DeepSeek V3 call when DEEPSEEK token available"
   *
   * **Validates: Requirements 1.1, 1.3**
   */
  it('Case 2: charges DEEPSEEK token for deepseek-chat (V3) call — not the OPENAI best token', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'approved@example.com',
      approved: true,
      token: openaiToken,           // "best" token
      tokens: [openaiToken, deepseekToken],
    });

    const req = makeCompletionRequest('DEEPSEEK', 'deepseek-chat');
    const res = await POST(req);

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

  /**
   * Case 3 (Reverse): DEEPSEEK token is "best" (most remaining quota), but GPT-4o is requested.
   *
   * Expected (correct) behavior: OPENAI token should be charged.
   * Actual (buggy) behavior:     DEEPSEEK token is charged (the "best" token).
   *
   * This test FAILS on unfixed code — counterexample:
   *   "DEEPSEEK token charged for GPT-4 call when OPENAI token available"
   *
   * **Validates: Requirements 1.1, 1.3**
   */
  it('Case 3: charges OPENAI token for gpt-4o call — not the DEEPSEEK best token', async () => {
    // Subject: DEEPSEEK token is best (1000 remaining), OPENAI token has 500 remaining
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'approved@example.com',
      approved: true,
      token: deepseekTokenBest,     // "best" token — most remaining quota
      tokens: [deepseekTokenBest, openaiTokenLess],
    });

    const req = makeCompletionRequest('OPENAI', 'gpt-4o');
    const res = await POST(req);

    expect(res.status).toBe(200);

    // The OPENAI token should be charged for an OpenAI model call
    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiTokenLess.token,  // tok-openai-less
      expect.any(Number),
    );

    // The DEEPSEEK token must NOT be charged
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      deepseekTokenBest.token,  // tok-deepseek-best
      expect.any(Number),
    );
  });

  /**
   * Case 4 (Reverse): DEEPSEEK token is "best", but gpt-4.1-mini (OpenAI) is requested.
   *
   * Expected (correct) behavior: OPENAI token should be charged.
   * Actual (buggy) behavior:     DEEPSEEK token is charged (the "best" token).
   *
   * **Validates: Requirements 1.1, 1.3**
   */
  it('Case 4: charges OPENAI token for gpt-4.1-mini call — not the DEEPSEEK best token', async () => {
    vi.mocked(resolveSubject).mockResolvedValue({
      kind: 'user',
      email: 'approved@example.com',
      approved: true,
      token: deepseekTokenBest,     // "best" token
      tokens: [deepseekTokenBest, openaiTokenLess],
    });

    const req = makeCompletionRequest('OPENAI', 'gpt-4.1-mini');
    const res = await POST(req);

    expect(res.status).toBe(200);

    expect(vi.mocked(incrementTokenUsed)).toHaveBeenCalledWith(
      openaiTokenLess.token,
      expect.any(Number),
    );
    expect(vi.mocked(incrementTokenUsed)).not.toHaveBeenCalledWith(
      deepseekTokenBest.token,
      expect.any(Number),
    );
  });
});
