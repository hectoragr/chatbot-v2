// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { recordHitAndMaybeBlock, BURST_MAX, BURST_WINDOW_SEC, AUTO_BLOCK_TTL_SEC } = await import('./abuse.js');
const { findBlock, removeBlock } = await import('./blocks.js');
const cfg = await import('./limitsConfig.js');

// Fresh ip per test so a persisted RateLimits window / auto-block from a prior
// run can't pre-trip a fresh case.
const rip = () => `7.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

// abuse.ts reads limits() live, so we can override caps via process.env within
// a test and restore afterwards.
const OVERRIDES = ['BURST_WINDOW_SEC', 'BURST_MAX', 'IP_HOURLY_MAX', 'IP_HOURLY_WINDOW_SEC', 'IP_DAILY_MAX', 'IP_DAILY_WINDOW_SEC'] as const;
afterEach(() => { for (const k of OVERRIDES) delete process.env[k]; });

describe('abuse config wiring', () => {
  it('re-exports the tunables under their original names, defaulting unchanged', () => {
    expect(BURST_MAX).toBe(cfg.BURST_MAX);
    expect(BURST_WINDOW_SEC).toBe(cfg.BURST_WINDOW_SEC);
    expect(AUTO_BLOCK_TTL_SEC).toBe(cfg.AUTO_BLOCK_TTL_SEC);
    expect(BURST_MAX).toBe(20); // unchanged default
  });
});

describe('abuse burst auto-block', () => {
  it(`auto-blocks an ip after exceeding BURST_MAX (${BURST_MAX}) hits`, async () => {
    const ip = rip();
    let blocked = false;
    for (let i = 0; i < BURST_MAX + 2; i++) {
      blocked = await recordHitAndMaybeBlock(ip);
    }
    expect(blocked).toBe(true);
    const b = await findBlock([`ip:${ip}`]);
    expect(b).not.toBeNull();
    expect(b?.reason).toBe('burst_auto');
    await removeBlock(`ip:${ip}`);
  });
});

describe('abuse multi-window ceilings', () => {
  it('hourly ceiling trips when only the hourly cap is low', async () => {
    const ip = rip();
    // Keep burst effectively unreachable so ONLY the hourly window can trip.
    process.env.BURST_WINDOW_SEC = '86400';
    process.env.BURST_MAX = '100000';
    process.env.IP_HOURLY_MAX = '5';
    process.env.IP_DAILY_MAX = '100000';
    let blocked = false;
    for (let i = 0; i < 7; i++) blocked = await recordHitAndMaybeBlock(ip);
    expect(blocked).toBe(true);
    const b = await findBlock([`ip:${ip}`]);
    expect(b?.reason).toBe('hourly_auto');
    await removeBlock(`ip:${ip}`);
  });

  it('daily ceiling trips when only the daily cap is low', async () => {
    const ip = rip();
    process.env.BURST_WINDOW_SEC = '86400';
    process.env.BURST_MAX = '100000';
    process.env.IP_HOURLY_MAX = '100000';
    process.env.IP_DAILY_MAX = '5';
    let blocked = false;
    for (let i = 0; i < 7; i++) blocked = await recordHitAndMaybeBlock(ip);
    expect(blocked).toBe(true);
    const b = await findBlock([`ip:${ip}`]);
    expect(b?.reason).toBe('daily_auto');
    await removeBlock(`ip:${ip}`);
  });

  it('does NOT block an ip that stays under every ceiling', async () => {
    const ip = rip();
    process.env.IP_HOURLY_MAX = '1000';
    process.env.IP_DAILY_MAX = '1000';
    let blocked = false;
    for (let i = 0; i < 5; i++) blocked = await recordHitAndMaybeBlock(ip);
    expect(blocked).toBe(false);
    expect(await findBlock([`ip:${ip}`])).toBeNull();
  });
});
