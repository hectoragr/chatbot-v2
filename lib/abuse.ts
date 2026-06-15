import { loadRateLimit, updateRateLimit } from './rateLimits.js';
import { addBlock } from './blocks.js';

export const BURST_WINDOW_SEC = 60;
export const BURST_MAX = 20;        // >20 completions / 60s ip → auto-block
export const AUTO_BLOCK_TTL_SEC = 60 * 60; // 1 hour

// Increments a short burst window counter for the ip; if it exceeds BURST_MAX,
// writes a 1h auto-block and returns true (caller should deny with 403).
export async function recordHitAndMaybeBlock(ip: string): Promise<boolean> {
  const key = `burst:ip:${ip}:${Math.floor(Date.now() / 1000 / BURST_WINDOW_SEC)}`;
  const current = await loadRateLimit(key);
  const count = current.count > BURST_MAX ? current.count : await updateRateLimit(key, 1, BURST_WINDOW_SEC);
  if (count > BURST_MAX) {
    await addBlock(`ip:${ip}`, 'burst_auto', 'auto', AUTO_BLOCK_TTL_SEC);
    return true;
  }
  return false;
}
