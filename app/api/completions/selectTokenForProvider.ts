import { providerForModel } from '@/lib/models';
import type { TokenDoc } from '@/lib/ddb';

/**
 * Selects the appropriate token to charge based on the model's provider.
 *
 * Matching strategy (in priority order):
 * 1. Exact provider match — token.provider === providerForModel(model), active, has quota
 * 2. 'ANY' provider token — acts as a wildcard for any provider, active, has quota
 * 3. Returns `undefined` — caller should fall back to subject.token (the "best" token)
 *
 * @param tokens  All active tokens available for the user (subject.tokens)
 * @param provider  The provider string from the request (informational; model is authoritative)
 * @param model  The model ID being used — determines the actual provider via providerForModel()
 * @returns The TokenDoc to charge, or undefined if no provider-specific match exists
 */
export function selectTokenForProvider(tokens: TokenDoc[], provider: string, model: string): TokenDoc | undefined {
  const actualProvider = providerForModel(model);

  // 1. Exact provider match
  const exactMatch = tokens.find(
    (t) => t.isActive && t.provider === actualProvider && (t.limit - t.used) > 0
  );
  if (exactMatch) return exactMatch;

  // 2. 'ANY' provider fallback
  const anyMatch = tokens.find(
    (t) => t.isActive && t.provider === 'ANY' && (t.limit - t.used) > 0
  );
  if (anyMatch) return anyMatch;

  // 3. No match — caller uses subject.token as tertiary fallback
  return undefined;
}
