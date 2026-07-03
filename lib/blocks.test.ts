// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { addBlock, removeBlock, emailPatternToRegex, findPatternBlock, invalidatePatternBlockCache } = await import('./blocks');

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

  it('caches the pattern list until invalidated', async () => {
    await addBlock(pat, 'spam domain', 'manual');
    invalidatePatternBlockCache();
    expect(await findPatternBlock(`x@${domain}`)).not.toBeNull();
    await removeBlock(pat);
    // still cached
    expect(await findPatternBlock(`x@${domain}`)).not.toBeNull();
    invalidatePatternBlockCache();
    expect(await findPatternBlock(`x@${domain}`)).toBeNull();
  });
});
