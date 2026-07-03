// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { putAdminDoc, deleteAdminDoc, listAdminDocs, listDocTopics, getDocsForInjection, invalidateDocTopicsCache } =
  await import('./adminDocs');

beforeEach(() => invalidateDocTopicsCache());

describe('adminDocs', () => {
  it('puts, lists, and deletes a doc; slugs the id from the title', async () => {
    const doc = await putAdminDoc({ title: 'My Career!', topics: 'career, jobs', content: '# md' });
    expect(doc.doc_id).toBe('my-career');
    expect((await listAdminDocs()).some((d) => d.doc_id === 'my-career')).toBe(true);
    await deleteAdminDoc('my-career');
    invalidateDocTopicsCache();
    expect((await listAdminDocs()).some((d) => d.doc_id === 'my-career')).toBe(false);
  });

  it('rejects content over 300KB', async () => {
    await expect(putAdminDoc({ title: 'big', topics: 't', content: 'x'.repeat(300 * 1024 + 1) })).rejects.toThrow();
  });

  it('caches topic listings and respects invalidation', async () => {
    await putAdminDoc({ doc_id: 'cache-probe', title: 'p', topics: 'alpha', content: 'c' });
    invalidateDocTopicsCache();
    expect((await listDocTopics()).some((d) => d.doc_id === 'cache-probe')).toBe(true);
    await deleteAdminDoc('cache-probe');
    // still cached
    expect((await listDocTopics()).some((d) => d.doc_id === 'cache-probe')).toBe(true);
    invalidateDocTopicsCache();
    expect((await listDocTopics()).some((d) => d.doc_id === 'cache-probe')).toBe(false);
  });

  it('caps injection payload at 12KB', async () => {
    await putAdminDoc({ doc_id: 'inj-a', title: 'A', topics: 't', content: 'a'.repeat(10 * 1024) });
    await putAdminDoc({ doc_id: 'inj-b', title: 'B', topics: 't', content: 'b'.repeat(10 * 1024) });
    const out = await getDocsForInjection(['inj-a', 'inj-b']);
    expect(out.length).toBeLessThanOrEqual(12 * 1024);
    expect(out).toContain('## A');
    await deleteAdminDoc('inj-a'); await deleteAdminDoc('inj-b');
  });
});
