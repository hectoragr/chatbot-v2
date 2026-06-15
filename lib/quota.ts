import { getUsage, addUsage, todayPeriod } from './usage.js';
import type { TokenDoc } from './ddb.js';

export const ANON_QUESTIONS = 3;
export const ANON_TOKENS = 1000;
export const UNAPPROVED_TOKENS = 1000;
export const DAILY_TOKENS = 1000;

export type QuotaSubject =
  | { kind: 'anon'; anonId: string; ip: string }
  | { kind: 'user'; email: string; approved: boolean; token?: TokenDoc };

export type Tier = 'anon' | 'unapproved' | 'approved';
export type BlockReason = 'questions_exhausted' | 'tokens_exhausted';

export interface QuotaStatus {
  tier: Tier;
  questionsUsed: number;
  tokensUsed: number;
  maxQuestions: number | null;
  maxTokens: number;
  remainingTokens: number;
  remainingQuestions: number | null;
  blocked: boolean;
  reason?: BlockReason;
  resetsDaily: boolean;
}

function tierOf(s: QuotaSubject): Tier {
  if (s.kind === 'anon') return 'anon';
  if (s.approved && s.token && (s.token.limit - s.token.used) > 0) return 'approved';
  return s.approved ? 'approved' : 'unapproved';
}

// Anonymous: block if EITHER the cookie subject OR the ip subject is exhausted.
async function anonUsage(anonId: string, ip: string) {
  const period = todayPeriod();
  const [byCookie, byIp] = await Promise.all([
    getUsage(`anon:${anonId}`, period),
    getUsage(`ip:${ip}`, period),
  ]);
  return {
    questions: Math.max(byCookie.questions, byIp.questions),
    tokens: Math.max(byCookie.tokens, byIp.tokens),
  };
}

export async function getQuotaStatus(s: QuotaSubject): Promise<QuotaStatus> {
  const tier = tierOf(s);

  if (tier === 'anon') {
    const a = s as Extract<QuotaSubject, { kind: 'anon' }>;
    const used = await anonUsage(a.anonId, a.ip);
    const blockedByQ = used.questions >= ANON_QUESTIONS;
    const blockedByT = used.tokens >= ANON_TOKENS;
    return {
      tier, questionsUsed: used.questions, tokensUsed: used.tokens,
      maxQuestions: ANON_QUESTIONS, maxTokens: ANON_TOKENS,
      remainingTokens: Math.max(0, ANON_TOKENS - used.tokens),
      remainingQuestions: Math.max(0, ANON_QUESTIONS - used.questions),
      blocked: blockedByQ || blockedByT,
      reason: blockedByT ? 'tokens_exhausted' : (blockedByQ ? 'questions_exhausted' : undefined),
      resetsDaily: true,
    };
  }

  const u = s as Extract<QuotaSubject, { kind: 'user' }>;

  if (tier === 'unapproved') {
    // 1000 tokens/day; resets daily once exhausted. Keyed by today's period.
    const used = await getUsage(`user:${u.email}`, todayPeriod());
    return {
      tier, questionsUsed: used.questions, tokensUsed: used.tokens,
      maxQuestions: null, maxTokens: UNAPPROVED_TOKENS,
      remainingTokens: Math.max(0, UNAPPROVED_TOKENS - used.tokens),
      remainingQuestions: null,
      blocked: used.tokens >= UNAPPROVED_TOKENS,
      reason: used.tokens >= UNAPPROVED_TOKENS ? 'tokens_exhausted' : undefined,
      resetsDaily: true,
    };
  }

  // approved: consume Token.limit first; when exhausted fall back to DAILY_TOKENS/day
  const tokenRemaining = u.token ? Math.max(0, u.token.limit - u.token.used) : 0;
  if (tokenRemaining > 0) {
    return {
      tier, questionsUsed: 0, tokensUsed: u.token!.used,
      maxQuestions: null, maxTokens: u.token!.limit,
      remainingTokens: tokenRemaining, remainingQuestions: null,
      blocked: false, resetsDaily: false,
    };
  }
  const daily = await getUsage(`user:${u.email}`, todayPeriod());
  return {
    tier, questionsUsed: daily.questions, tokensUsed: daily.tokens,
    maxQuestions: null, maxTokens: DAILY_TOKENS,
    remainingTokens: Math.max(0, DAILY_TOKENS - daily.tokens),
    remainingQuestions: null,
    blocked: daily.tokens >= DAILY_TOKENS,
    reason: daily.tokens >= DAILY_TOKENS ? 'tokens_exhausted' : undefined,
    resetsDaily: true,
  };
}

// Record consumption of one question + `tokens` against the right ledger.
// Approved users whose Token still has room are charged on the Token by the
// caller (incrementTokenUsed); this only writes the Usage ledger for the
// anon / unapproved / approved-daily ledgers.
export async function consumeQuota(s: QuotaSubject, tokens: number): Promise<void> {
  if (s.kind === 'anon') {
    const period = todayPeriod();
    await Promise.all([
      addUsage(`anon:${s.anonId}`, period, 1, tokens),
      addUsage(`ip:${s.ip}`, period, 1, tokens),
    ]);
    return;
  }
  const tier = tierOf(s);
  if (tier === 'unapproved') {
    await addUsage(`user:${s.email}`, todayPeriod(), 1, tokens);
    return;
  }
  // approved with token room → charged on Token elsewhere; only ledger daily once token empty
  const tokenRemaining = s.token ? Math.max(0, s.token.limit - s.token.used) : 0;
  if (tokenRemaining <= 0) {
    await addUsage(`user:${s.email}`, todayPeriod(), 1, tokens);
  }
}
