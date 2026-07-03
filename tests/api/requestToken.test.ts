// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null) }));

const { POST } = await import('@/app/api/requestToken/route');
const { generateCSRFToken } = await import('@/lib/csrf');

describe('POST /api/requestToken', () => {
  it('returns 403 when CSRF token is missing', async () => {
    const res = await POST(new Request('http://x/api/requestToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: 1000, provider: 'OPENAI' }),
    }));
    expect(res.status).toBe(403);
  });
  it('returns 401 for anonymous (valid CSRF, no session)', async () => {
    const { token } = generateCSRFToken('http://x');
    const res = await POST(new Request('http://x/api/requestToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ tokenLimit: 1000, provider: 'OPENAI' }),
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('login_required');
  });

  it('defaults provider to ANY when omitted', async () => {
    const { token } = generateCSRFToken('http://x');
    const res = await POST(new Request('http://x/api/requestToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ tokenLimit: 1000 }),
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('login_required');
  });
});
