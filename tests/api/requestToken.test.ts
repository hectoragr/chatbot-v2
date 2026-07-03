// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';

const sessionUser = vi.hoisted(() => ({ current: null as null | { email: string; name?: string } }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => sessionUser.current) }));

const notifySpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/email', () => ({ notifyAdminTokenRequest: notifySpy }));

const createTokenRequestSpy = vi.hoisted(() => vi.fn(async () => ({ token: 't-1', provider: 'ANY' })));
vi.mock('@/lib/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tokens')>()),
  createTokenRequestMaxThreeTokens: createTokenRequestSpy,
}));

const { POST } = await import('@/app/api/requestToken/route');
const { generateCSRFToken } = await import('@/lib/csrf');

beforeEach(() => {
  sessionUser.current = null;
  notifySpy.mockClear();
  createTokenRequestSpy.mockClear();
});

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
    const email = `req-${Date.now()}@x.com`;
    sessionUser.current = { email };
    const { token } = generateCSRFToken('http://x');
    const res = await POST(new Request('http://x/api/requestToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ tokenLimit: 100, company: 'c' }),
    }));
    expect(res.status).toBe(200);
    expect(createTokenRequestSpy).toHaveBeenCalledWith(
      email, expect.anything(), 'ANY', 100, 'c',
    );
  });

  it('returns 400 for an invalid provider', async () => {
    sessionUser.current = { email: `bogus-${Date.now()}@x.com` };
    const { token } = generateCSRFToken('http://x');
    const res = await POST(new Request('http://x/api/requestToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ tokenLimit: 100, provider: 'BOGUS' }),
    }));
    expect(res.status).toBe(400);
  });
});
