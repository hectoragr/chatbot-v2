import { listTokens, deleteToken, updateToken, transformTokenRequestToToken, denyTokenRequest, listUnprocessedTokensRequest, deleteAllUserTokens, deleteAllUserTokenRequests } from '../lib/tokens.js';
import { listUsers, updateUser, deleteUserById, createUserIfNotExists } from '../lib/users.js';
import { listConversations, getConversationsByUser, deleteConversation } from '../lib/conversations.js';
import { listBlocks, addBlock, removeBlock } from '../lib/blocks.js';
import { putAdminDoc, deleteAdminDoc, listAdminDocs, invalidateDocTopicsCache } from '../lib/adminDocs.js';
import { deleteLocale } from '../lib/locales.js';
// Note: lib/locales.js also imports `@/i18n/resources` for generateLocale/validateLocaleBundle,
// which are unused here (deleteLocale is a plain DDB delete). NodejsFunction resolves the
// project-root tsconfig's `@/*` path alias when bundling admin-fn, same as the rest of lib/.

export type AdminOp =
  | { op: 'listTables'; payload: Record<string, never> }
  | { op: 'updateUser'; payload: { email: string; name?: string; company?: string; approved?: boolean } }
  | { op: 'deleteUser'; payload: { email: string } }
  | { op: 'addUser'; payload: { email: string; name?: string; company?: string } }
  | { op: 'updateToken'; payload: { token: string; limit?: number; isActive?: boolean; provider?: 'OPENAI' | 'DEEPSEEK' | 'ANY' } }
  | { op: 'deleteToken'; payload: { token: string } }
  | { op: 'approveToken'; payload: { tokenRequestId: string } }
  | { op: 'denyToken'; payload: { tokenRequestId: string } }
  | { op: 'addBlock'; payload: { subject: string; reason: string } }
  | { op: 'removeBlock'; payload: { subject: string } }
  | { op: 'listBlocks'; payload: Record<string, never> }
  | { op: 'purgeUser'; payload: { email: string } }
  | { op: 'putAdminDoc'; payload: { doc_id?: string; title: string; topics: string; content: string } }
  | { op: 'deleteAdminDoc'; payload: { doc_id: string } }
  | { op: 'deleteLocale'; payload: { lang: string } }
  | { op: 'deleteConversation'; payload: { conversation_id: string } };

export async function runAdminOp(cmd: AdminOp): Promise<unknown> {
  switch (cmd.op) {
    case 'listTables': {
      const [tokens, users, conversations, unprocessedTokens, blocks, adminDocs] = await Promise.all([
        listTokens(), listUsers(), listConversations(), listUnprocessedTokensRequest(), listBlocks(), listAdminDocs(),
      ]);
      return { tokens, users, conversations, unprocessedTokens, blocks, adminDocs };
    }
    case 'updateUser':
      // updateUser(user_id, name?, email?, company?, approved?) — user_id IS the email in this app
      return updateUser(cmd.payload.email, cmd.payload.name, cmd.payload.email, cmd.payload.company, cmd.payload.approved);
    case 'deleteUser':
      return { deleted: await deleteUserById(cmd.payload.email) };
    case 'purgeUser': {
      const { email } = cmd.payload;
      const convos = await getConversationsByUser(email);
      await Promise.all(convos.map((c) => deleteConversation(c.conversation_id)));
      await deleteAllUserTokens(email);
      await deleteAllUserTokenRequests(email);
      await deleteUserById(email);
      return { purged: true, email };
    }
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
    case 'denyToken':
      return denyTokenRequest(cmd.payload.tokenRequestId);
    case 'addBlock':
      // Admin-created blocks are permanent (no ttl) until removed.
      return addBlock(cmd.payload.subject, cmd.payload.reason, 'manual');
    case 'removeBlock':
      await removeBlock(cmd.payload.subject);
      return { removed: true };
    case 'listBlocks':
      return { blocks: await listBlocks() };
    case 'putAdminDoc': {
      const doc = await putAdminDoc(cmd.payload);
      invalidateDocTopicsCache();
      return doc;
    }
    case 'deleteAdminDoc':
      await deleteAdminDoc(cmd.payload.doc_id);
      invalidateDocTopicsCache();
      return { deleted: true };
    case 'deleteLocale':
      await deleteLocale(cmd.payload.lang);
      return { deleted: true };
    case 'deleteConversation':
      await deleteConversation(cmd.payload.conversation_id);
      return { deleted: true };
    default:
      throw new Error('UNKNOWN_ADMIN_OP');
  }
}
