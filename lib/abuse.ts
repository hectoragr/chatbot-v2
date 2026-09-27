import { loadRateLimit, updateRateLimit } from './rateLimits.js';
import { addBlock } from './blocks.js';
import {
  BURST_WINDOW_SEC as CFG_BURST_WINDOW_SEC,
  BURST_MAX as CFG_BURST_MAX,
  AUTO_BLOCK_TTL_SEC as CFG_AUTO_BLOCK_TTL_SEC,
  limits,
} from './limitsConfig.js';

// Re-export the tunables under their ORIGINAL names so existing imports/tests
// (e.g. `import { BURST_MAX } from './abuse.js'`) keep working. The values now
// come from lib/limitsConfig.ts (env-overridable) but default to the same
// numbers, so behaviour is unchanged until an operator overrides them.
export const BURST_WINDOW_SEC = CFG_BURST_WINDOW_SEC;
export const BURST_MAX = CFG_BURST_MAX;          // >BURST_MAX completions / window ip → auto-block
export const AUTO_BLOCK_TTL_SEC = CFG_AUTO_BLOCK_TTL_SEC; // auto-block duration

/**
 * Increment a fixed-window counter for `key` and return whether `cap` is now
 * exceeded. Mirrors the original burst logic: once the stored count is already
 * over the cap we skip the write (the ip is being blocked anyway), otherwise we
 * increment and compare. `cap` is the INCLUSIVE ceiling — the (cap+1)-th hit
 * within the window trips it.
 */
async function bumpAndCheck(key: string, cap: number, windowSec: number): Promise<boolean> {
  const current = await loadRateLimit(key);
  const count = current.count > cap ? current.count : await updateRateLimit(key, 1, windowSec);
  return count > cap;
}

/**
 * Record one request from `ip` against THREE rolling windows — burst (seconds),
 * hourly, and daily — and auto-block the ip if ANY ceiling is exceeded.
 *
 * The three windows catch different abuse shapes the single 60s burst cap
 * missed: a burst catches a hammering script; the hourly/daily ceilings catch a
 * "low and slow" attacker who stays just under the burst cap but still racks up
 * thousands of requests. All three reuse loadRateLimit/updateRateLimit with
 * distinct keys + TTLs, so they cost one GetItem + one UpdateItem each and
 * expire themselves via DynamoDB TTL.
 *
 * Exceeding any window writes an auto-block (same as the original burst) and
 * returns true; the caller denies with 403.
 */
export async function recordHitAndMaybeBlock(ip: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  // Read limits live so a runtime env override (or a warm Lambda whose env was
  // retuned) takes effect without a redeploy.
  const L = limits();

  // Distinct keys per window so the counters never collide. The bucket epoch
  // (floor(now / window)) makes each key a discrete fixed window.
  const burstKey = `burst:ip:${ip}:${Math.floor(now / L.BURST_WINDOW_SEC)}`;
  const hourKey = `rate:ip:${ip}:h:${Math.floor(now / L.IP_HOURLY_WINDOW_SEC)}`;
  const dayKey = `rate:ip:${ip}:d:${Math.floor(now / L.IP_DAILY_WINDOW_SEC)}`;

  // Evaluate all three (sequential to keep memory/connection pressure low).
  const burstTripped = await bumpAndCheck(burstKey, L.BURST_MAX, L.BURST_WINDOW_SEC);
  const hourTripped = await bumpAndCheck(hourKey, L.IP_HOURLY_MAX, L.IP_HOURLY_WINDOW_SEC);
  const dayTripped = await bumpAndCheck(dayKey, L.IP_DAILY_MAX, L.IP_DAILY_WINDOW_SEC);

  if (burstTripped || hourTripped || dayTripped) {
    const reason = burstTripped ? 'burst_auto' : hourTripped ? 'hourly_auto' : 'daily_auto';
    await addBlock(`ip:${ip}`, reason, 'auto', L.AUTO_BLOCK_TTL_SEC);
    return true;
  }
  return false;
}
