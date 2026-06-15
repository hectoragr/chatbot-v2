// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { recordHitAndMaybeBlock, BURST_MAX } = await import('./abuse.js');
const { findBlock } = await import('./blocks.js');

describe('abuse burst auto-block', () => {
  it(`auto-blocks an ip after exceeding BURST_MAX (${BURST_MAX}) hits`, async () => {
    const ip = `7.1.1.${Date.now() % 255}`;
    let blocked = false;
    for (let i = 0; i < BURST_MAX + 2; i++) {
      blocked = await recordHitAndMaybeBlock(ip);
    }
    expect(blocked).toBe(true);
    expect(await findBlock([`ip:${ip}`])).not.toBeNull();
  });
});
