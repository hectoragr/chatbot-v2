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

export interface ClassifyOpts {
  allowedProviders?: Provider[];
  docTopics?: { doc_id: string; topics: string }[];
}
export interface ClassifyResult { model: string; docIds: string[] }

const JSON_CLASSIFY_PROMPT = (docs: { doc_id: string; topics: string }[]) =>
  'Classify the difficulty of answering the following user question as "simple" (greetings, trivia, short factual answers), ' +
  '"moderate" (summaries, translations, everyday coding, general explanations), or "complex" (multi-step reasoning, math ' +
  'proofs, debugging, architecture, long analysis). Also decide which of these reference documents about the site owner, ' +
  'if any, the question is about:\n' +
  docs.map((d) => `- ${d.doc_id}: ${d.topics}`).join('\n') +
  '\nReply with ONLY strict JSON: {"tier":"simple|moderate|complex","docs":["matching_doc_ids_or_empty"]}';

function pickForTier(tier: Tier, allowedProviders?: Provider[]): string {
  const candidates = TIER_MODELS[tier];
  if (allowedProviders && allowedProviders.length > 0) {
    const match = candidates.find((c) => allowedProviders.includes(c.provider));
    if (match) return match.model;
  }
  return candidates[0].model;
}

/**
 * One cheap classifier call, two jobs: difficulty tier (→ model) and about-me
 * doc matching. Never throws; failures fall back to AUTO_FALLBACK_MODEL and
 * no docs, so classification can never block a completion.
 */
export async function classifyMessage(message: string, opts?: ClassifyOpts): Promise<ClassifyResult> {
  const docTopics = opts?.docTopics ?? [];
  try {
    const prompt = docTopics.length > 0 ? JSON_CLASSIFY_PROMPT(docTopics) : CLASSIFY_PROMPT;
    const probe: Message = {
      role: 'user',
      content: `${prompt}\n\nQuestion:\n${message.slice(0, 2000)}`,
      createdAt: new Date().toISOString(),
    };
    const { content } = await runCompletion('OPENAI', 'gpt-4.1-nano', [probe]);

    if (docTopics.length > 0) {
      const jsonText = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonText) as { tier?: string; docs?: unknown };
      const tier = ['simple', 'moderate', 'complex'].includes(parsed.tier ?? '') ? (parsed.tier as Tier) : undefined;
      const known = new Set(docTopics.map((d) => d.doc_id));
      const docIds = Array.isArray(parsed.docs) ? parsed.docs.filter((d): d is string => typeof d === 'string' && known.has(d)) : [];
      return { model: tier ? pickForTier(tier, opts?.allowedProviders) : AUTO_FALLBACK_MODEL, docIds };
    }

    const tier = content.trim().toLowerCase().match(/\b(simple|moderate|complex)\b/)?.[1] as Tier | undefined;
    return { model: tier ? pickForTier(tier, opts?.allowedProviders) : AUTO_FALLBACK_MODEL, docIds: [] };
  } catch {
    return { model: AUTO_FALLBACK_MODEL, docIds: [] };
  }
}
