// @vitest-environment node
/**
 * Bug Condition Exploration Test — About-Me Doc Matching
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 *
 * These tests demonstrate that `classifyMessage` fails to return matching doc IDs
 * when the user message plausibly refers to an about-me doc subject via:
 *   - Diacritic-free name variants (1.2)
 *   - Keyword overlap (1.4, 1.5)
 *   - Pronoun/coreference with history (1.3)
 *   - Cross-language references (1.1)
 *
 * The mock simulates gpt-4.1-nano returning `{"tier":"simple","docs":[]}` — the
 * model misses the match. On UNFIXED code there is no deterministic fallback, so
 * `docIds` comes back empty. These tests MUST FAIL on unfixed code to confirm the bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock runCompletion BEFORE importing classifyMessage so the module picks up the mock.
const mockRunCompletion = vi.hoisted(() =>
  vi.fn(async () => ({
    content: '{"tier":"simple","docs":[]}',
    estimatedTokens: 10,
  })),
);

vi.mock('./providers', () => ({
  runCompletion: mockRunCompletion,
}));

const { classifyMessage } = await import('./autoModel');

describe('Bug Condition Exploration — classifyMessage doc matching', () => {
  beforeEach(() => {
    mockRunCompletion.mockClear();
    // Ensure the mock always returns the "miss" response
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"simple","docs":[]}',
      estimatedTokens: 10,
    });
  });

  it('Test Case 1 - Diacritic Mismatch: "Tell me about Hector" should match doc with "Héctor Gómez"', async () => {
    const result = await classifyMessage('Tell me about Hector', {
      docTopics: [{ doc_id: 'about-hector', topics: 'Héctor Gómez, biography, developer' }],
    });

    // On UNFIXED code: docIds will be [] because no diacritic normalization exists.
    // This assertion EXPECTS the correct behavior — it will FAIL, proving the bug.
    expect(result.docIds).toContain('about-hector');
  });

  it('Test Case 2 - Keyword Overlap: "What are Héctor\'s hobbies?" should match doc with "hobbies" topic', async () => {
    const result = await classifyMessage("What are Héctor's hobbies?", {
      docTopics: [{ doc_id: 'hobbies', topics: 'hobbies, interests, Héctor' }],
    });

    // On UNFIXED code: docIds will be [] because no keyword pre-match exists.
    // This assertion EXPECTS the correct behavior — it will FAIL, proving the bug.
    expect(result.docIds).toContain('hobbies');
  });

  it('Test Case 3 - Pronoun with History: "What are his hobbies?" with conversation context should match', async () => {
    // History provides context for pronoun/coreference resolution.
    // The keyword pre-match should find "hobbies" in the topic AND "Héctor" in the history.
    const result = await classifyMessage('What are his hobbies?', {
      docTopics: [{ doc_id: 'hobbies', topics: 'hobbies, interests, Héctor' }],
      history: [
        { role: 'user', content: 'Tell me about Héctor', createdAt: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Héctor is a developer...', createdAt: '2024-01-01T00:00:01Z' },
      ],
    });

    // On UNFIXED code: docIds will be [] because history is not used and no keyword fallback.
    // This assertion EXPECTS the correct behavior — it will FAIL, proving the bug.
    expect(result.docIds).toContain('hobbies');
  });

  it('Test Case 4 - Cross-Language: Spanish question about hobbies should match "hobbies" topic', async () => {
    const result = await classifyMessage('¿Cuáles son los hobbies del administrador?', {
      docTopics: [{ doc_id: 'hobbies', topics: 'hobbies, interests, Héctor' }],
    });

    // On UNFIXED code: docIds will be [] because "hobbies" keyword is not matched deterministically.
    // The model returned empty docs and there is no keyword fallback.
    // This assertion EXPECTS the correct behavior — it will FAIL, proving the bug.
    expect(result.docIds).toContain('hobbies');
  });
});



// ─────────────────────────────────────────────────────────────────────────────
// Preservation Property Tests — Task 2
// These tests verify CORRECT existing behavior that must be preserved after the fix.
// All tests below MUST PASS on unfixed code (baseline confirmation).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Property 3: Preservation — Unrelated Messages Produce No Docs
 *
 * **Validates: Requirements 3.1**
 *
 * Messages with NO meaningful token overlap with doc topics (coding, math,
 * greetings) must return empty `docIds`. The mock returns
 * `{"tier":"simple","docs":[]}` so the model also reports no docs.
 */
describe('Preservation — Unrelated Messages produce empty docIds', () => {
  beforeEach(() => {
    mockRunCompletion.mockClear();
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"simple","docs":[]}',
      estimatedTokens: 10,
    });
  });

  it('coding question "How do I sort an array in Python?" does not match hobbies doc', async () => {
    const result = await classifyMessage('How do I sort an array in Python?', {
      docTopics: [{ doc_id: 'hobbies', topics: 'hobbies, interests, Héctor' }],
    });
    expect(result.docIds).toEqual([]);
  });

  it('math question "What is 2+2?" does not match about-hector doc', async () => {
    const result = await classifyMessage('What is 2+2?', {
      docTopics: [{ doc_id: 'about-hector', topics: 'Héctor Gómez, developer' }],
    });
    expect(result.docIds).toEqual([]);
  });

  it('greeting "Hello, how are you?" does not match about doc', async () => {
    const result = await classifyMessage('Hello, how are you?', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });
    expect(result.docIds).toEqual([]);
  });

  it('CSS question "How do I center a div in CSS?" does not match about doc', async () => {
    const result = await classifyMessage('How do I center a div in CSS?', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });
    expect(result.docIds).toEqual([]);
  });
});

/**
 * Property 4: Preservation — Error Fallback Unchanged
 *
 * **Validates: Requirements 3.2, 3.5**
 *
 * When `runCompletion` throws, `classifyMessage` must return
 * `{ model: "gpt-4o-mini", docIds: [] }` and must NOT throw itself.
 */
describe('Preservation — Error fallback returns AUTO_FALLBACK_MODEL with empty docIds', () => {
  beforeEach(() => {
    mockRunCompletion.mockClear();
  });

  it('when runCompletion throws Error, classifyMessage returns fallback model with empty docIds', async () => {
    mockRunCompletion.mockRejectedValue(new Error('Network timeout'));

    const result = await classifyMessage('Tell me anything', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });

    expect(result.model).toBe('us.amazon.nova-micro-v1:0');
    expect(result.docIds).toEqual([]);
  });

  it('classifyMessage does NOT throw when runCompletion throws', async () => {
    mockRunCompletion.mockRejectedValue(new Error('Service unavailable'));

    await expect(
      classifyMessage('Any message', {
        docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
      }),
    ).resolves.not.toThrow();
  });
});

/**
 * Property 5: Preservation — Model Tier Selection Unchanged
 *
 * **Validates: Requirements 3.3**
 *
 * When the model returns a valid tier, the model selection must match
 * `pickForTier` logic — simple → Nova Lite, moderate → Nova Pro,
 * complex → Claude Sonnet 4.5 (each capped to the caller's allowlist).
 */
describe('Preservation — Tier selection maps to correct model', () => {
  beforeEach(() => {
    mockRunCompletion.mockClear();
  });

  it('tier "simple" selects Nova Lite', async () => {
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"simple","docs":[]}',
      estimatedTokens: 10,
    });

    const result = await classifyMessage('Hello', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });

    expect(result.model).toBe('us.amazon.nova-lite-v1:0');
  });

  it('tier "moderate" selects Nova Pro', async () => {
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"moderate","docs":[]}',
      estimatedTokens: 10,
    });

    const result = await classifyMessage('Summarize this article for me', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });

    expect(result.model).toBe('us.amazon.nova-pro-v1:0');
  });

  it('tier "complex" selects Claude Sonnet 4.5', async () => {
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"complex","docs":[]}',
      estimatedTokens: 10,
    });

    const result = await classifyMessage('Prove the Riemann hypothesis', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
    });

    expect(result.model).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
  });

  it('respects the caller allowlist: complex on anon tier stays within allowed models', async () => {
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"complex","docs":[]}',
      estimatedTokens: 10,
    });

    const result = await classifyMessage('Prove the Riemann hypothesis', {
      docTopics: [{ doc_id: 'about', topics: 'Héctor, biography' }],
      allowedModels: ['us.amazon.nova-micro-v1:0', 'us.amazon.nova-lite-v1:0'],
    });

    // Sonnet is not allowed for anon → falls back to the cheapest allowed model.
    expect(['us.amazon.nova-micro-v1:0', 'us.amazon.nova-lite-v1:0']).toContain(result.model);
  });
});

/**
 * Preservation — Stopword Non-Match
 *
 * **Validates: Requirements 3.1**
 *
 * Messages containing only common stopwords (that might also appear in topics)
 * should NOT trigger doc injection. On unfixed code, the model returns empty
 * docs and there is no keyword fallback, so trivial stopword messages produce
 * empty docIds.
 */
describe('Preservation — Stopword-only messages do not match', () => {
  beforeEach(() => {
    mockRunCompletion.mockClear();
    mockRunCompletion.mockResolvedValue({
      content: '{"tier":"simple","docs":[]}',
      estimatedTokens: 10,
    });
  });

  it('"the a is are" does not match doc with "the site owner Héctor"', async () => {
    const result = await classifyMessage('the a is are', {
      docTopics: [{ doc_id: 'about', topics: 'the site owner Héctor' }],
    });
    expect(result.docIds).toEqual([]);
  });
});
