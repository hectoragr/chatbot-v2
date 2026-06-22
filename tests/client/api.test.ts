import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModels, sendCompletion, deleteConversation } from '@/lib/client/api';

beforeEach(() => { vi.restoreAllMocks(); });

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = impl(url, init);
    return { status: 200, json: async () => body } as Response;
  }));
}

describe('client api', () => {
  it('fetchModels hits /api/models and returns the catalog', async () => {
    mockFetch(() => ({ models: { OPENAI: [{ id: 'gpt-4o', label: 'GPT-4o' }] } }));
    const m = await fetchModels();
    expect(m.models.OPENAI[0].id).toBe('gpt-4o');
  });

  it('sendCompletion fetches a CSRF token then POSTs to /api/completions with the header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url === '/api/csrf' ? { token: 'CSRF123' } : { valid: true };
      return { status: 200, json: async () => body } as Response;
    }));
    const res = await sendCompletion({ message: 'hi', provider: 'OPENAI', model: 'gpt-4o', conversationId: null });
    expect(res.status).toBe(200);
    const post = calls.find((c) => c.url === '/api/completions')!;
    expect((post.init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('CSRF123');
    expect(post.init!.method).toBe('POST');
  });

  it('deleteConversation DELETEs the encoded id', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return { status: 200, json: async () => ({ valid: true, token: 'CSRF123' }) } as Response; }));
    await deleteConversation('a b/c');
    // First fetches a CSRF token, then DELETEs the encoded id.
    expect(calls).toContain('/api/csrf');
    expect(calls).toContain('/api/conversations/a%20b%2Fc');
  });
});
