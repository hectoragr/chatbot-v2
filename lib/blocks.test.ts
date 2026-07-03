// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { addBlock, removeBlock, emailPatternToRegex, findPatternBlock, invalidatePatternBlockCache } = await import('./blocks');
const { ddb, TABLES } = await import('./ddb');

beforeEach(() => invalidatePatternBlockCache());

describe('emailPatternToRegex', () => {
  it('matches suffix, prefix, and middle globs case-insensitively', () => {
    expect(emailPatternToRegex('*@spam.com').test('Bob@SPAM.com')).toBe(true);
    expect(emailPatternToRegex('bot-*@*').test('bot-42@anything.io')).toBe(true);
    expect(emailPatternToRegex('*@spam.com').test('bob@notspam.org')).toBe(false);
  });
  it('escapes regex metacharacters (no regex injection)', () => {
    expect(emailPatternToRegex('a.b@x.com').test('a.b@x.com')).toBe(true);
    expect(emailPatternToRegex('a.b@x.com').test('aXb@xYcom')).toBe(false);
    expect(emailPatternToRegex('(a|b)@x.com').test('a@x.com')).toBe(false);
  });
  it('collapses repeated wildcards to avoid ReDoS and completes quickly', () => {
    const evil = emailPatternToRegex('*'.repeat(30) + '@spam.com');
    const attackString = 'a'.repeat(40) + '@x.com';
    const t0 = Date.now();
    const result = evil.test(attackString);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(result).toBe(false);
  });
  it('treats collapsed wildcards as equivalent to a single wildcard', () => {
    expect(emailPatternToRegex('**@spam.com').test('bob@spam.com')).toBe(true);
  });
  it('never matches when the glob exceeds 200 characters', () => {
    const oversized = 'a'.repeat(201) + '@spam.com';
    const regex = emailPatternToRegex(oversized);
    expect(regex.test(oversized)).toBe(false);
    expect(regex.test('anything@anything.com')).toBe(false);
  });
});

describe('findPatternBlock', () => {
  const pat = `emailpat:*@blocked-${Date.now()}.test`;
  const domain = pat.slice('emailpat:*@'.length);

  it('finds a matching live pattern block and misses non-matches', async () => {
    await addBlock(pat, 'spam domain', 'manual');
    invalidatePatternBlockCache();
    expect((await findPatternBlock(`someone@${domain}`))?.subject).toBe(pat);
    expect(await findPatternBlock('innocent@example.com')).toBeNull();
    await removeBlock(pat);
  });

  it('caches the pattern list within the TTL window', async () => {
    await addBlock(pat, 'spam domain', 'manual');
    invalidatePatternBlockCache();
    expect(await findPatternBlock(`x@${domain}`)).not.toBeNull();
    // Remove the row directly via the DDB client (bypassing removeBlock's
    // invalidation) to prove the in-memory cache serves stale reads within TTL.
    await ddb().send(new DeleteCommand({ TableName: TABLES.Blocks, Key: { subject: pat } }));
    expect(await findPatternBlock(`x@${domain}`)).not.toBeNull();
    invalidatePatternBlockCache();
    expect(await findPatternBlock(`x@${domain}`)).toBeNull();
  });

  it('auto-invalidates the cache when addBlock/removeBlock mutate pattern blocks', async () => {
    await addBlock(pat, 'spam domain', 'manual');
    expect(await findPatternBlock(`x@${domain}`)).not.toBeNull();
    await removeBlock(pat);
    // No manual invalidatePatternBlockCache() call here — removeBlock must
    // invalidate the cache itself for this to return null immediately.
    expect(await findPatternBlock(`x@${domain}`)).toBeNull();
  });
});
