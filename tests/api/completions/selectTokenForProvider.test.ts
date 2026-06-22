// @vitest-environment node
/**
 * Unit tests for selectTokenForProvider() helper function.
 *
 * Tests the provider-aware token selection logic in isolation:
 * - Exact provider match
 * - 'ANY' provider fallback
 * - undefined fallback when no match
 * - Exact match priority over ANY
 * - Inactive token filtering
 * - Empty token array
 *
 * **Validates: Requirements 2.1, 2.3**
 */

import { describe, it, expect } from 'vitest';
import { selectTokenForProvider } from '@/app/api/completions/selectTokenForProvider';
import type { TokenDoc } from '@/lib/ddb';

// ─── Token Fixtures ──────────────────────────────────────────────────────────

function makeToken(overrides: Partial<TokenDoc> & Pick<TokenDoc, 'token' | 'provider' | 'limit' | 'used' | 'isActive'>): TokenDoc {
  return {
    user_id: 'user@example.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('selectTokenForProvider()', () => {
  it('returns exact provider match token', () => {
    const openaiToken = makeToken({ token: 'tok-openai', provider: 'OPENAI', limit: 1000, used: 100, isActive: true });
    const deepseekToken = makeToken({ token: 'tok-deepseek', provider: 'DEEPSEEK', limit: 1000, used: 0, isActive: true });

    const result = selectTokenForProvider(
      [openaiToken, deepseekToken],
      'DEEPSEEK',
      'deepseek-chat',
    );

    expect(result).toBe(deepseekToken);
  });

  it('returns ANY provider token as fallback when no exact match exists', () => {
    const openaiToken = makeToken({ token: 'tok-openai', provider: 'OPENAI', limit: 1000, used: 500, isActive: true });
    const anyToken = makeToken({ token: 'tok-any', provider: 'ANY', limit: 1000, used: 200, isActive: true });

    const result = selectTokenForProvider(
      [openaiToken, anyToken],
      'DEEPSEEK',
      'deepseek-chat',
    );

    expect(result).toBe(anyToken);
  });

  it('returns undefined when no matching token exists', () => {
    // OPENAI token is exhausted (used === limit)
    const openaiToken = makeToken({ token: 'tok-openai', provider: 'OPENAI', limit: 500, used: 500, isActive: true });

    const result = selectTokenForProvider(
      [openaiToken],
      'DEEPSEEK',
      'deepseek-chat',
    );

    expect(result).toBeUndefined();
  });

  it('prefers exact provider match over ANY token even when ANY has more remaining', () => {
    const deepseekToken = makeToken({ token: 'tok-deepseek', provider: 'DEEPSEEK', limit: 1000, used: 900, isActive: true }); // 100 remaining
    const anyToken = makeToken({ token: 'tok-any', provider: 'ANY', limit: 1000, used: 100, isActive: true }); // 900 remaining

    const result = selectTokenForProvider(
      [deepseekToken, anyToken],
      'DEEPSEEK',
      'deepseek-chat',
    );

    expect(result).toBe(deepseekToken);
  });

  it('ignores inactive tokens', () => {
    const deepseekInactive = makeToken({ token: 'tok-deepseek', provider: 'DEEPSEEK', limit: 1000, used: 0, isActive: false });
    const openaiToken = makeToken({ token: 'tok-openai', provider: 'OPENAI', limit: 1000, used: 500, isActive: true });

    const result = selectTokenForProvider(
      [deepseekInactive, openaiToken],
      'DEEPSEEK',
      'deepseek-chat',
    );

    expect(result).toBeUndefined();
  });

  it('returns undefined for empty token array', () => {
    const result = selectTokenForProvider(
      [],
      'OPENAI',
      'gpt-4o',
    );

    expect(result).toBeUndefined();
  });
});
