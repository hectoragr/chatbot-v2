import { runCompletion } from './providers';
import type { Message } from './ddb';

// Cheapest capable model per difficulty tier (see ALL_MODELS in lib/models.ts).
const TIER_MODEL: Record<string, string> = {
  simple: 'gpt-4.1-nano',
  moderate: 'deepseek-chat',
  complex: 'deepseek-reasoner',
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
 */
export async function pickModelForMessage(message: string): Promise<string> {
  try {
    const probe: Message = {
      role: 'user',
      content: `${CLASSIFY_PROMPT}\n\nQuestion:\n${message.slice(0, 2000)}`,
      createdAt: new Date().toISOString(),
    };
    const { content } = await runCompletion('OPENAI', 'gpt-4.1-nano', [probe]);
    const tier = content.trim().toLowerCase().match(/\b(simple|moderate|complex)\b/)?.[1];
    return (tier && TIER_MODEL[tier]) || AUTO_FALLBACK_MODEL;
  } catch {
    return AUTO_FALLBACK_MODEL;
  }
}
