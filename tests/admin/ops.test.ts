// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { runAdminOp } = await import('@/admin-fn/ops');

describe('admin ops', () => {
  it('lists tables', async () => {
    const res = await runAdminOp({ op: 'listTables', payload: {} }) as Record<string, unknown>;
    expect(res).toHaveProperty('users');
    expect(res).toHaveProperty('tokens');
    expect(res).toHaveProperty('conversations');
    expect(res).toHaveProperty('unprocessedTokens');
    expect(res).toHaveProperty('blocks');
  });
  it('adds and removes a manual block', async () => {
    const subject = `ip:7.7.7.${Math.floor(Math.random() * 256)}`;
    await runAdminOp({ op: 'addBlock', payload: { subject, reason: 'manual-test' } });
    // Confirm the block actually persisted (manual = permanent, no ttl).
    const { findBlock } = await import('@/lib/blocks');
    const hit = await findBlock([subject]);
    expect(hit?.subject).toBe(subject);
    expect(hit?.ttl).toBeUndefined();
    const after = await runAdminOp({ op: 'removeBlock', payload: { subject } }) as { removed: boolean };
    expect(after.removed).toBe(true);
    expect(await findBlock([subject])).toBeNull();
  });
  it('rejects unknown op', async () => {
    await expect(runAdminOp({ op: 'nuke' as never, payload: {} as never })).rejects.toThrow();
  });
  it('deleteLocale removes a poisoned/stored locale row', async () => {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { ddb, TABLES } = await import('@/lib/ddb');
    const lang = `xx-adminop-${Math.floor(Math.random() * 100000)}`;
    await ddb().send(new PutCommand({
      TableName: TABLES.Locales,
      Item: { lang, name: 'Test', rtl: false, translations: {}, usageCount: 0, createdAt: '', lastUsedAt: '' },
    }));
    const { getLocale } = await import('@/lib/locales');
    expect(await getLocale(lang)).not.toBeNull();
    const res = await runAdminOp({ op: 'deleteLocale', payload: { lang } }) as { deleted: boolean };
    expect(res.deleted).toBe(true);
    expect(await getLocale(lang)).toBeNull();
  });
});
