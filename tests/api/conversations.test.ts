import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null) }));

const { GET } = await import('@/app/api/conversations/route');
const { DELETE } = await import('@/app/api/conversations/[id]/route');

describe('conversations routes (anon)', () => {
  it('GET returns empty list for anon', async () => {
    const res = await GET(new Request('http://x/api/conversations?all=true'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toEqual([]);
  });
  it('DELETE is unauthorized for anon', async () => {
    const res = await DELETE(new Request('http://x/api/conversations/abc', { method: 'DELETE' }), { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(401);
  });
});
