// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { getQuotaStatus, consumeQuota } = await import('./quota.js');
const { getUsage, todayPeriod } = await import('./usage.js');

// Unique-per-run subject so persistent Usage rows from prior runs never pre-pollute
// a test (anon quota blocks on max(cookie, ip), so BOTH must be fresh).
const uid = () => globalThis.crypto.randomUUID();
const randIp = () =>
  `${10 + Math.floor(Math.random() * 240)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

describe('quota: anonymous', () => {
  it('blocks after 3 questions even under token cap', async () => {
    const anonId = `q-${uid()}`;
    const subject = { kind: 'anon' as const, anonId, ip: randIp() };
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
    const anonId = `tk-${uid()}`;
    const subject = { kind: 'anon' as const, anonId, ip: randIp() };
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

describe('quota: approved logged-in', () => {
  const baseToken = (email: string, limit: number, used: number) => ({
    token: `tok-${email}`, user_id: email, provider: 'OPENAI' as const,
    limit, used, isActive: true, createdAt: '', updatedAt: '',
  });

  it('uses the token allowance while it has room', async () => {
    const email = `ap-${Date.now()}@x.com`;
    const subject = { kind: 'user' as const, email, approved: true, token: baseToken(email, 500, 100) };
    const s = await getQuotaStatus(subject);
    expect(s.tier).toBe('approved');
    expect(s.blocked).toBe(false);
    expect(s.resetsDaily).toBe(false);
    expect(s.maxTokens).toBe(500);
    expect(s.remainingTokens).toBe(400);
  });

  it('does NOT write a Usage row while the token has room (no double-charge)', async () => {
    const email = `apnoop-${Date.now()}@x.com`;
    const subject = { kind: 'user' as const, email, approved: true, token: baseToken(email, 500, 100) };
    await consumeQuota(subject, 50);
    const ledger = await getUsage(`user:${email}`, todayPeriod());
    expect(ledger.tokens).toBe(0);
    expect(ledger.questions).toBe(0);
  });

  it('falls back to a daily 1000-token allowance once the token is exhausted', async () => {
    const email = `apdaily-${Date.now()}@x.com`;
    const subject = { kind: 'user' as const, email, approved: true, token: baseToken(email, 500, 500) };
    const s = await getQuotaStatus(subject);
    expect(s.tier).toBe('approved');
    expect(s.maxTokens).toBe(1000);
    expect(s.resetsDaily).toBe(true);
    expect(s.blocked).toBe(false);
    // Token exhausted → consumption now writes to the daily ledger.
    await consumeQuota(subject, 30);
    const ledger = await getUsage(`user:${email}`, todayPeriod());
    expect(ledger.tokens).toBe(30);
  });
});
