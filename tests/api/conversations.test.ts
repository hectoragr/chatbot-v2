import { describe, it, expect, vi } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null) }));

const { GET } = await import('@/app/api/conversations/route');
const { DELETE } = await import('@/app/api/conversations/[id]/route');
const { generateCSRFToken } = await import('@/lib/csrf');

describe('conversations routes (anon)', () => {
  it('GET returns empty list for anon', async () => {
    const res = await GET(new Request('http://x/api/conversations?all=true'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toEqual([]);
  });
  it('DELETE returns 403 when CSRF token is missing', async () => {
    const res = await DELETE(new Request('http://x/api/conversations/abc', { method: 'DELETE' }), { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(403);
  });
  it('DELETE is unauthorized for anon (valid CSRF, no session)', async () => {
    const { token } = generateCSRFToken('http://x');
    const res = await DELETE(
      new Request('http://x/api/conversations/abc', { method: 'DELETE', headers: { 'x-csrf-token': token } }),
      { params: Promise.resolve({ id: 'abc' }) },
    );
    expect(res.status).toBe(401);
  });
});
