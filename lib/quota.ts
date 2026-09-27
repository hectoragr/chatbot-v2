import { getUsage, addUsage, todayPeriod } from './usage.js';
import type { TokenDoc } from './ddb.js';
import {
  ANON_QUESTIONS as CFG_ANON_QUESTIONS,
  ANON_TOKENS as CFG_ANON_TOKENS,
  UNAPPROVED_TOKENS as CFG_UNAPPROVED_TOKENS,
  DAILY_TOKENS as CFG_DAILY_TOKENS,
} from './limitsConfig.js';

// Keep the ORIGINAL exported constant names so existing imports/tests continue
// to work. Values now come from lib/limitsConfig.ts (env-overridable) and
// default to the same numbers, so behaviour is unchanged until overridden.
export const ANON_QUESTIONS = CFG_ANON_QUESTIONS;
export const ANON_TOKENS = CFG_ANON_TOKENS;
export const UNAPPROVED_TOKENS = CFG_UNAPPROVED_TOKENS;
export const DAILY_TOKENS = CFG_DAILY_TOKENS;

export type QuotaSubject =
  | { kind: 'anon'; anonId: string; ip: string }
  | { kind: 'user'; email: string; approved: boolean; token?: TokenDoc; tokens?: TokenDoc[] };

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
  // approved if any active token has remaining room
  const u = s as Extract<QuotaSubject, { kind: 'user' }>;
  const allTokens = u.tokens ?? (u.token ? [u.token] : []);
  const hasRoom = allTokens.some((t) => t.isActive && (t.limit - t.used) > 0);
  if (u.approved && hasRoom) return 'approved';
  return u.approved ? 'approved' : 'unapproved';
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

  // approved: accumulate ALL active tokens first; fall back to DAILY_TOKENS/day when all exhausted
  const allTokens = u.tokens ?? (u.token ? [u.token] : []);
  const activeTokens = allTokens.filter((t) => t.isActive);
  const totalRemaining = activeTokens.reduce((sum, t) => sum + Math.max(0, t.limit - t.used), 0);
  const totalLimit = activeTokens.reduce((sum, t) => sum + t.limit, 0);
  const totalUsed = activeTokens.reduce((sum, t) => sum + t.used, 0);

  if (activeTokens.length > 0 && totalRemaining > 0) {
    return {
      tier, questionsUsed: 0, tokensUsed: totalUsed,
      maxQuestions: null, maxTokens: totalLimit,
      remainingTokens: totalRemaining, remainingQuestions: null,
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
  // approved with token room → charged on Token by caller; only ledger daily once all tokens empty
  const allTokens = s.tokens ?? (s.token ? [s.token] : []);
  const totalRemaining = allTokens.filter(t => t.isActive).reduce((sum, t) => sum + Math.max(0, t.limit - t.used), 0);
  if (totalRemaining <= 0) {
    await addUsage(`user:${s.email}`, todayPeriod(), 1, tokens);
  }
}
