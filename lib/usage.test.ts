// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { getUsage, addUsage, todayPeriod } = await import('./usage.js');

describe('usage', () => {
  const subject = `anon:test-${Date.now()}`;
  it('starts at zero', async () => {
    const u = await getUsage(subject, todayPeriod());
    expect(u.questions).toBe(0);
    expect(u.tokens).toBe(0);
  });
  it('accumulates questions and tokens', async () => {
    await addUsage(subject, todayPeriod(), 1, 120);
    await addUsage(subject, todayPeriod(), 1, 80);
    const u = await getUsage(subject, todayPeriod());
    expect(u.questions).toBe(2);
    expect(u.tokens).toBe(200);
  });
});
