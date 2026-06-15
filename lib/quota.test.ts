// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { getQuotaStatus, consumeQuota } = await import('./quota.js');

describe('quota: anonymous', () => {
  it('blocks after 3 questions even under token cap', async () => {
    const anonId = `q-${Date.now()}`;
    const subject = { kind: 'anon' as const, anonId, ip: `1.2.3.${Date.now() % 255}` };
    for (let i = 0; i < 3; i++) {
      const s = await getQuotaStatus(subject);
      expect(s.blocked).toBe(false);
      await consumeQuota(subject, 10); // 10 tokens each, well under 1000
    }
    const s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(true);
    expect(s.reason).toBe('questions_exhausted');
  });

  it('blocks when token cap hit before question cap', async () => {
    const anonId = `tk-${Date.now()}`;
    const subject = { kind: 'anon' as const, anonId, ip: `9.9.9.${Date.now() % 255}` };
    await consumeQuota(subject, 999);
    let s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(false);
    await consumeQuota(subject, 2); // now 1001 > 1000
    s = await getQuotaStatus(subject);
    expect(s.blocked).toBe(true);
    expect(s.reason).toBe('tokens_exhausted');
  });
});

describe('quota: unapproved logged-in', () => {
  it('grants 1000 daily tokens (resets daily), no question cap', async () => {
    const subject = { kind: 'user' as const, email: `u-${Date.now()}@x.com`, approved: false, token: undefined };
    const s = await getQuotaStatus(subject);
    expect(s.tier).toBe('unapproved');
    expect(s.maxTokens).toBe(1000);
    expect(s.maxQuestions).toBeNull();
    expect(s.resetsDaily).toBe(true);
  });
});
