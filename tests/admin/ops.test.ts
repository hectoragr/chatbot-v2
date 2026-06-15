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
    const subject = `ip:7.7.7.${Math.floor(Math.random()*256)}`;
    await runAdminOp({ op: 'addBlock', payload: { subject, reason: 'manual-test' } });
    const after = await runAdminOp({ op: 'removeBlock', payload: { subject } }) as { removed: boolean };
    expect(after.removed).toBe(true);
  });
  it('rejects unknown op', async () => {
    await expect(runAdminOp({ op: 'nuke' as never, payload: {} as never })).rejects.toThrow();
  });
});
