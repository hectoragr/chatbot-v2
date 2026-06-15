import { listTokens, deleteToken, updateToken, transformTokenRequestToToken, listUnprocessedTokensRequest } from '../lib/tokens.js';
import { listUsers, updateUser, deleteUserById, createUserIfNotExists } from '../lib/users.js';
import { listConversations } from '../lib/conversations.js';
import { listBlocks, addBlock, removeBlock } from '../lib/blocks.js';

export type AdminOp =
  | { op: 'listTables'; payload: Record<string, never> }
  | { op: 'updateUser'; payload: { email: string; name?: string; company?: string } }
  | { op: 'deleteUser'; payload: { email: string } }
  | { op: 'addUser'; payload: { email: string; name?: string; company?: string } }
  | { op: 'updateToken'; payload: { token: string; limit?: number; isActive?: boolean; provider?: 'OPENAI' | 'DEEPSEEK' | 'ANY' } }
  | { op: 'deleteToken'; payload: { token: string } }
  | { op: 'approveToken'; payload: { tokenRequestId: string } }
  | { op: 'addBlock'; payload: { subject: string; reason: string } }
  | { op: 'removeBlock'; payload: { subject: string } }
  | { op: 'listBlocks'; payload: Record<string, never> };

export async function runAdminOp(cmd: AdminOp): Promise<unknown> {
  switch (cmd.op) {
    case 'listTables': {
      const [tokens, users, conversations, unprocessedTokens, blocks] = await Promise.all([
        listTokens(), listUsers(), listConversations(), listUnprocessedTokensRequest(), listBlocks(),
      ]);
      return { tokens, users, conversations, unprocessedTokens, blocks };
    }
    case 'updateUser':
      // updateUser(user_id, name?, email?, company?) — user_id IS the email in this app
      return updateUser(cmd.payload.email, cmd.payload.name, cmd.payload.email, cmd.payload.company);
    case 'deleteUser':
      return { deleted: await deleteUserById(cmd.payload.email) };
    case 'addUser':
      return { created: await createUserIfNotExists(cmd.payload.email, cmd.payload.name ?? cmd.payload.email, cmd.payload.email, cmd.payload.company ?? '') };
    case 'updateToken': {
      const { token, ...updates } = cmd.payload;
      return { updated: await updateToken(token, updates) };
    }
    case 'deleteToken':
      return { deleted: await deleteToken(cmd.payload.token) };
    case 'approveToken':
      return transformTokenRequestToToken(cmd.payload.tokenRequestId);
    case 'addBlock':
      // Admin-created blocks are permanent (no ttl) until removed.
      return addBlock(cmd.payload.subject, cmd.payload.reason, 'manual');
    case 'removeBlock':
      await removeBlock(cmd.payload.subject);
      return { removed: true };
    case 'listBlocks':
      return { blocks: await listBlocks() };
    default:
      throw new Error('UNKNOWN_ADMIN_OP');
  }
}
