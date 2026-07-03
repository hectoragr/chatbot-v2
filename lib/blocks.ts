import { GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './ddb.js';
import type { BlockDoc } from './ddb.js';

function isLive(b: BlockDoc): boolean {
  if (!b.ttl) return true; // permanent (manual)
  return b.ttl > Math.floor(Date.now() / 1000);
}

export async function findBlock(subjects: string[]): Promise<BlockDoc | null> {
  for (const subject of subjects) {
    const out = await ddb().send(new GetCommand({ TableName: TABLES.Blocks, Key: { subject } }));
    const b = out.Item as BlockDoc | undefined;
    if (b && isLive(b)) return b;
  }
  return null;
}

export async function addBlock(subject: string, reason: string, source: 'manual' | 'auto', ttlSeconds?: number): Promise<BlockDoc> {
  const doc: BlockDoc = {
    subject, reason, source,
    createdAt: new Date().toISOString(),
    ...(ttlSeconds ? { ttl: Math.floor(Date.now() / 1000) + ttlSeconds } : {}),
  };
  await ddb().send(new PutCommand({ TableName: TABLES.Blocks, Item: doc }));
  return doc;
}

export async function removeBlock(subject: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLES.Blocks, Key: { subject } }));
}

export async function listBlocks(limit = 200): Promise<BlockDoc[]> {
  const out = await ddb().send(new ScanCommand({ TableName: TABLES.Blocks, Limit: limit }));
  return (out.Items as BlockDoc[]) || [];
}

// Resolve the candidate block subjects for a request.
export function blockSubjects(opts: { ip: string; email?: string }): string[] {
  const subs = [`ip:${opts.ip}`];
  if (opts.email) subs.push(`user:${opts.email}`);
  return subs;
}

const PATTERN_PREFIX = 'emailpat:';
const PATTERN_CACHE_TTL_MS = 60_000;

// Same-process cache only (see lib/adminDocs.ts topicsCache): in prod, admin
// mutations run on the admin Lambda while this cache lives in the server
// Lambda — the 60s TTL is the real staleness bound there.
let patternCache: { at: number; items: BlockDoc[] } | null = null;
export function invalidatePatternBlockCache(): void { patternCache = null; }

/** `*` is the only wildcard; everything else is escaped. Case-insensitive. */
export function emailPatternToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Matches an email against live `emailpat:<glob>` blocks. Cached 60s.
 * Any error → null: pattern blocking must never take the service down.
 */
export async function findPatternBlock(email: string): Promise<BlockDoc | null> {
  try {
    if (!patternCache || Date.now() - patternCache.at >= PATTERN_CACHE_TTL_MS) {
      const all = await listBlocks();
      patternCache = { at: Date.now(), items: all.filter((b) => b.subject.startsWith(PATTERN_PREFIX)) };
    }
    for (const b of patternCache.items) {
      if (!isLive(b)) continue;
      if (emailPatternToRegex(b.subject.slice(PATTERN_PREFIX.length)).test(email)) return b;
    }
    return null;
  } catch {
    return null;
  }
}
