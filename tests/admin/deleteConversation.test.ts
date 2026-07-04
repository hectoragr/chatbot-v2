// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { runAdminOp } = await import('@/admin-fn/ops');
const { ensureConversation, getConversation } = await import('@/lib/conversations');

describe('deleteConversation op', () => {
  it('hard-deletes a conversation', async () => {
    const convo = await ensureConversation(undefined, 'tok-x', `anon:del-${Date.now()}`, 'ANY');
    expect(await getConversation(convo.conversation_id)).not.toBeUndefined();
    await runAdminOp({ op: 'deleteConversation', payload: { conversation_id: convo.conversation_id } });
    expect(await getConversation(convo.conversation_id)).toBeUndefined();
  });
});
