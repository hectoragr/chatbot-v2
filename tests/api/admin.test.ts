// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(async () => { throw new Error('ADMIN_REQUIRED'); }),
  isAdminEmail: () => false,
  getSessionUser: vi.fn(async () => null),
}));

const { GET: tables } = await import('@/app/api/admin/tables/route');
const { POST: blocksPost } = await import('@/app/api/admin/blocks/route');

describe('admin routes', () => {
  it('tables returns 401 when not admin', async () => {
    const res = await tables();
    expect(res.status).toBe(401);
  });
  it('blocks POST returns 403 when CSRF missing (checked before admin)', async () => {
    const res = await blocksPost(new Request('http://x/api/admin/blocks', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
  });
  it('users PUT returns 403 when CSRF missing', async () => {
    const { PUT } = await import('@/app/api/admin/users/[email]/route');
    const res = await PUT(new Request('http://x', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ email: 'a@b.com' }) });
    expect(res.status).toBe(403);
  });
  it('tokens PUT returns 403 when CSRF missing', async () => {
    const { PUT } = await import('@/app/api/admin/tokens/[token]/route');
    const res = await PUT(new Request('http://x', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(403);
  });
  it('blocks DELETE returns 403 when CSRF missing', async () => {
    const { DELETE } = await import('@/app/api/admin/blocks/route');
    const res = await DELETE(new Request('http://x?subject=ip:1.2.3.4', { method: 'DELETE' }));
    expect(res.status).toBe(403);
  });
  it('locales DELETE returns 403 when CSRF missing', async () => {
    const { DELETE } = await import('@/app/api/admin/locales/route');
    const res = await DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify({ lang: 'xx' }) }));
    expect(res.status).toBe(403);
  });
  it('locales DELETE returns 401 when CSRF valid but not admin', async () => {
    const { generateCSRFToken } = await import('@/lib/csrf');
    const { DELETE } = await import('@/app/api/admin/locales/route');
    const { token } = generateCSRFToken('http://x');
    const res = await DELETE(new Request('http://x', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ lang: 'xx' }),
    }));
    expect(res.status).toBe(401);
  });
});
