import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, type AdminDocDoc } from './ddb';

const MAX_CONTENT = 300 * 1024;
const INJECTION_CAP = 12 * 1024;
const CACHE_TTL_MS = 60_000;

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'doc';
}

export async function putAdminDoc(input: { doc_id?: string; title: string; topics: string; content: string }): Promise<AdminDocDoc> {
  if (!input.title?.trim() || !input.topics?.trim()) throw new Error('title and topics required');
  if (typeof input.content !== 'string' || input.content.length > MAX_CONTENT) throw new Error('content too large');
  const doc: AdminDocDoc = {
    doc_id: input.doc_id?.trim() || slugify(input.title),
    title: input.title.trim(),
    topics: input.topics.trim(),
    content: input.content,
    updatedAt: new Date().toISOString(),
  };
  await ddb().send(new PutCommand({ TableName: TABLES.AdminDocs, Item: doc }));
  return doc;
}

export async function deleteAdminDoc(doc_id: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLES.AdminDocs, Key: { doc_id } }));
}

export async function listAdminDocs(): Promise<AdminDocDoc[]> {
  const r = await ddb().send(new ScanCommand({ TableName: TABLES.AdminDocs }));
  return (r.Items as AdminDocDoc[]) ?? [];
}

let topicsCache: { at: number; items: { doc_id: string; topics: string }[] } | null = null;
export function invalidateDocTopicsCache(): void { topicsCache = null; }

/** Cheap warm-Lambda cache of {doc_id, topics}. Returns [] on any error — doc matching must never block completions. */
export async function listDocTopics(): Promise<{ doc_id: string; topics: string }[]> {
  if (topicsCache && Date.now() - topicsCache.at < CACHE_TTL_MS) return topicsCache.items;
  try {
    const r = await ddb().send(new ScanCommand({ TableName: TABLES.AdminDocs, ProjectionExpression: 'doc_id, topics' }));
    topicsCache = { at: Date.now(), items: (r.Items as { doc_id: string; topics: string }[]) ?? [] };
    return topicsCache.items;
  } catch {
    return [];
  }
}

export async function getDocsForInjection(ids: string[]): Promise<string> {
  let out = '';
  for (const id of ids) {
    try {
      const r = await ddb().send(new GetCommand({ TableName: TABLES.AdminDocs, Key: { doc_id: id } }));
      const doc = r.Item as AdminDocDoc | undefined;
      if (!doc) continue;
      const block = `## ${doc.title}\n${doc.content}\n\n`;
      out += block.slice(0, Math.max(0, INJECTION_CAP - out.length));
      if (out.length >= INJECTION_CAP) break;
    } catch { /* skip unreadable docs */ }
  }
  return out;
}
