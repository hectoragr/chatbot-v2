import { runCompletion } from './providers';
import type { Message } from './ddb';
import type { Provider } from './models';

type Tier = 'simple' | 'moderate' | 'complex';

const TIER_MODELS: Record<Tier, { provider: Provider; model: string }[]> = {
  simple:   [{ provider: 'OPENAI', model: 'gpt-4.1-nano' },   { provider: 'DEEPSEEK', model: 'deepseek-chat' }],
  moderate: [{ provider: 'DEEPSEEK', model: 'deepseek-chat' }, { provider: 'OPENAI', model: 'gpt-4o-mini' }],
  complex:  [{ provider: 'DEEPSEEK', model: 'deepseek-reasoner' }, { provider: 'OPENAI', model: 'o3-mini' }],
};

export const AUTO_FALLBACK_MODEL = 'gpt-4o-mini';

/** How many recent conversation turns to include in classification context. */
export const HISTORY_WINDOW = 5;

const CLASSIFY_PROMPT =
  'Classify the difficulty of answering the following user question. ' +
  'Reply with exactly one word: "simple" (greetings, trivia, short factual answers), ' +
  '"moderate" (summaries, translations, everyday coding, general explanations), or ' +
  '"complex" (multi-step reasoning, math proofs, debugging, architecture, long analysis). ' +
  'Reply with only that one word.';

export interface ClassifyOpts {
  allowedProviders?: Provider[];
  docTopics?: { doc_id: string; topics: string }[];
  history?: Message[];
}
export interface ClassifyResult { model: string; docIds: string[] }

// ── Stopwords: common short words in English and Spanish that should not trigger keyword matching ──
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'shall', 'must', 'it', 'its', 'this', 'that',
  'he', 'she', 'his', 'her', 'him', 'they', 'them', 'their', 'we', 'our',
  'you', 'your', 'my', 'me', 'who', 'what', 'when', 'where', 'how', 'why',
  'which', 'if', 'or', 'and', 'but', 'not', 'no', 'so', 'too', 'very',
  'just', 'about', 'also', 'than', 'then', 'some', 'any', 'all', 'each',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as',
  'into', 'like', 'does', 'get', 'got',
  // Spanish
  'de', 'la', 'el', 'en', 'un', 'una', 'los', 'las', 'del', 'al',
  'es', 'son', 'fue', 'ser', 'está', 'esta', 'ese', 'esa', 'eso',
  'que', 'por', 'para', 'con', 'como', 'más', 'mas', 'pero', 'sin',
  'su', 'sus', 'se', 'le', 'lo', 'nos', 'ya', 'hay', 'entre',
  'muy', 'bien', 'aquí', 'ahora', 'donde', 'cuando', 'quien',
]);

/**
 * Normalize text for keyword matching: lowercase, strip diacritics, split on
 * whitespace/punctuation. Returns meaningful tokens (length > 2, not stopwords).
 */
function normalizeTokens(text: string): string[] {
  const stripped = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacritical marks
    .toLowerCase();
  const raw = stripped.split(/[\s,;.!?¿¡()\[\]{}"'`\-_/\\|:]+/);
  return raw.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Deterministic keyword pre-match: force-include docs when the message or recent
 * history shares a meaningful token with the doc's topics field.
 *
 * Pure function — no I/O, no model call, cannot throw under normal conditions.
 */
export function keywordPreMatch(
  message: string,
  history: Message[],
  docTopics: { doc_id: string; topics: string }[],
): string[] {
  if (docTopics.length === 0) return [];

  // Build the set of meaningful tokens from message + recent history
  const inputTokens = new Set<string>(normalizeTokens(message));
  for (const msg of history.slice(-HISTORY_WINDOW)) {
    for (const token of normalizeTokens(msg.content)) {
      inputTokens.add(token);
    }
  }

  if (inputTokens.size === 0) return [];

  // Check each doc's topics for overlap
  const matched: string[] = [];
  for (const doc of docTopics) {
    const topicTokens = normalizeTokens(doc.topics);
    if (topicTokens.some((t) => inputTokens.has(t))) {
      matched.push(doc.doc_id);
    }
  }
  return matched;
}

const JSON_CLASSIFY_PROMPT = (docs: { doc_id: string; topics: string }[], history?: Message[]) => {
  let prompt =
    'Classify the difficulty of answering the following user question as "simple" (greetings, trivia, short factual answers), ' +
    '"moderate" (summaries, translations, everyday coding, general explanations), or "complex" (multi-step reasoning, math ' +
    'proofs, debugging, architecture, long analysis). Also decide which of these reference documents about the site owner, ' +
    'if any, the question is about:\n' +
    docs.map((d) => `- ${d.doc_id}: ${d.topics}`).join('\n') +
    '\n\nWhen in doubt about whether a question relates to a document, include it — false positives are acceptable, false negatives are not.' +
    '\nReply with ONLY strict JSON: {"tier":"simple|moderate|complex","docs":["matching_doc_ids_or_empty"]}';

  if (history && history.length > 0) {
    const recentTurns = history.slice(-HISTORY_WINDOW).map((m) =>
      `${m.role}: ${m.content.slice(0, 300)}`
    ).join('\n');
    prompt += `\n\nRecent conversation for context (resolve pronouns like "he"/"she"/"they" using this):\n${recentTurns}`;
  }

  return prompt;
};

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
  const history = opts?.history ?? [];
  try {
    // Deterministic keyword pre-match (runs before model call, no I/O)
    const keywordIds = docTopics.length > 0 ? keywordPreMatch(message, history, docTopics) : [];

    const prompt = docTopics.length > 0 ? JSON_CLASSIFY_PROMPT(docTopics, history) : CLASSIFY_PROMPT;
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
      const modelDocIds = Array.isArray(parsed.docs) ? parsed.docs.filter((d): d is string => typeof d === 'string' && known.has(d)) : [];
      // Union: keyword pre-match + model classification (deduplicated)
      const docIds = [...new Set([...keywordIds, ...modelDocIds])];
      return { model: tier ? pickForTier(tier, opts?.allowedProviders) : AUTO_FALLBACK_MODEL, docIds };
    }

    const tier = content.trim().toLowerCase().match(/\b(simple|moderate|complex)\b/)?.[1] as Tier | undefined;
    return { model: tier ? pickForTier(tier, opts?.allowedProviders) : AUTO_FALLBACK_MODEL, docIds: [] };
  } catch {
    return { model: AUTO_FALLBACK_MODEL, docIds: [] };
  }
}
