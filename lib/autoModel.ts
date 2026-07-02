import { runCompletion } from './providers';
import type { Message } from './ddb';
import type { Provider } from './models';

type Tier = 'simple' | 'moderate' | 'complex';

// Cheapest capable model per difficulty tier (see ALL_MODELS in lib/models.ts),
// preference-ordered per provider: primary keeps the original approved mapping,
// secondary is the same-tier model on the other provider. This lets the route
// pick a candidate the user actually has token room on.
const TIER_MODELS: Record<Tier, { provider: Provider; model: string }[]> = {
  simple:   [{ provider: 'OPENAI', model: 'gpt-4.1-nano' },   { provider: 'DEEPSEEK', model: 'deepseek-chat' }],
  moderate: [{ provider: 'DEEPSEEK', model: 'deepseek-chat' }, { provider: 'OPENAI', model: 'gpt-4o-mini' }],
  complex:  [{ provider: 'DEEPSEEK', model: 'deepseek-reasoner' }, { provider: 'OPENAI', model: 'o3-mini' }],
};

export const AUTO_FALLBACK_MODEL = 'gpt-4o-mini';

const CLASSIFY_PROMPT =
  'Classify the difficulty of answering the following user question. ' +
  'Reply with exactly one word: "simple" (greetings, trivia, short factual answers), ' +
  '"moderate" (summaries, translations, everyday coding, general explanations), or ' +
  '"complex" (multi-step reasoning, math proofs, debugging, architecture, long analysis). ' +
  'Reply with only that one word.';

/**
 * Picks the cheapest capable model for a message by asking gpt-4.1-nano to
 * rate its difficulty. Never throws — any failure falls back to a safe default
 * so classification can never block a completion.
 *
 * `allowedProviders`, when given, restricts the result to a provider the caller
 * can actually bill (e.g. the providers of the user's active tokens with quota
 * room). The tier's primary candidate is preferred; if it's not allowed, the
 * secondary (same-tier, other-provider) candidate is used instead. If neither
 * is allowed, or `allowedProviders` is omitted/empty, the primary candidate is
 * returned (current/default behavior).
 */
export async function pickModelForMessage(message: string, allowedProviders?: Provider[]): Promise<string> {
  try {
    const probe: Message = {
      role: 'user',
      content: `${CLASSIFY_PROMPT}\n\nQuestion:\n${message.slice(0, 2000)}`,
      createdAt: new Date().toISOString(),
    };
    const { content } = await runCompletion('OPENAI', 'gpt-4.1-nano', [probe]);
    const tier = content.trim().toLowerCase().match(/\b(simple|moderate|complex)\b/)?.[1] as Tier | undefined;
    if (!tier) return AUTO_FALLBACK_MODEL;

    const candidates = TIER_MODELS[tier];
    if (allowedProviders && allowedProviders.length > 0) {
      const match = candidates.find((c) => allowedProviders.includes(c.provider));
      if (match) return match.model;
    }
    return candidates[0].model;
  } catch {
    return AUTO_FALLBACK_MODEL;
  }
}
