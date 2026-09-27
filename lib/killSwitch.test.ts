// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { checkGlobalKillSwitch, recordGlobalSpend } = await import('./killSwitch.js');

afterEach(() => { delete process.env.GLOBAL_DAILY_TOKENS; });

describe('global daily kill-switch', () => {
  it('does not trip while spend is below budget', async () => {
    process.env.GLOBAL_DAILY_TOKENS = '1000000000'; // huge — never trip today
    const { tripped, budget } = await checkGlobalKillSwitch();
    expect(tripped).toBe(false);
    expect(budget).toBe(1000000000);
  });

  it('trips once recorded spend reaches the (tiny) budget', async () => {
    // Budget is read live; set it very low so a single record() crosses it.
    // The global day counter is shared across the process, so seed enough spend
    // to exceed whatever a prior test left, then assert with a budget at/under it.
    await recordGlobalSpend(500);
    const after = await checkGlobalKillSwitch(); // uses default huge budget → not tripped
    expect(after.used).toBeGreaterThanOrEqual(500);

    process.env.GLOBAL_DAILY_TOKENS = String(after.used); // budget == used → tripped (>=)
    const trippedCheck = await checkGlobalKillSwitch();
    expect(trippedCheck.tripped).toBe(true);
  });

  it('ignores non-positive spend', async () => {
    const before = (await checkGlobalKillSwitch()).used;
    await recordGlobalSpend(0);
    await recordGlobalSpend(-50);
    const after = (await checkGlobalKillSwitch()).used;
    expect(after).toBe(before);
  });
});
