import { loadRateLimit, updateRateLimit } from './rateLimits.js';
import { limits, IP_DAILY_WINDOW_SEC } from './limitsConfig.js';

// One rolling UTC-day bucket. We reuse the RateLimits table (loadRateLimit /
// updateRateLimit already give us an atomic counter with a self-expiring TTL),
// so no new table or infra is needed. The key rolls over each day; the old
// row expires via DynamoDB TTL.
const DAY_SEC = IP_DAILY_WINDOW_SEC; // 86400
function globalKey(now = Math.floor(Date.now() / 1000)): string {
  return `killswitch:global:d:${Math.floor(now / DAY_SEC)}`;
}

/**
 * Global daily token-spend kill-switch.
 *
 * A last-resort brake against a runaway bill: if the SUM of charged token cost
 * across ALL users in the current UTC day has already reached
 * GLOBAL_DAILY_TOKENS, the completions route must NOT call the model provider.
 *
 * `check()` is exactly ONE GetItem (loadRateLimit) — cheap enough to run on the
 * hot path before every completion. It reads the running total and compares it
 * to the (env-tunable) budget; it never writes. Charging happens separately
 * via `record()` AFTER a completion, so the switch reflects real spend.
 *
 * Fail-open: loadRateLimit already swallows DDB errors and returns count 0, so
 * a transient DDB outage does not wedge the whole service closed. The budget is
 * a safety ceiling, not a precise accountant — a small overshoot from
 * concurrent in-flight requests is acceptable.
 */
export async function checkGlobalKillSwitch(): Promise<{ tripped: boolean; used: number; budget: number }> {
  const budget = limits().GLOBAL_DAILY_TOKENS;
  const doc = await loadRateLimit(globalKey());
  const used = doc.count ?? 0;
  return { tripped: used >= budget, used, budget };
}

/**
 * Add `tokens` of charged spend to the current day's global counter. Called
 * AFTER a completion, alongside the per-subject charge. Reuses updateRateLimit
 * so the row gets a fresh day-length TTL. A zero/negative charge is a no-op
 * (e.g. a provider error that isn't billed).
 */
export async function recordGlobalSpend(tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await updateRateLimit(globalKey(), tokens, DAY_SEC);
}
