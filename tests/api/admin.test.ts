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
});
