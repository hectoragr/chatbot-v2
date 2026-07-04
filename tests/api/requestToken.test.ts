// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';

const sessionUser = vi.hoisted(() => ({ current: null as null | { email: string; name?: string } }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => sessionUser.current) }));

const notifySpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/email', () => ({ notifyAdminTokenRequest: notifySpy }));

const createTokenRequestSpy = vi.hoisted(() => vi.fn(
  async (_email: string, _name: string, _provider: string, _limit: number, _company?: string, _extras?: { reason?: string; ip?: string }) => ({ token: 't-1', provider: 'ANY' }),
));
vi.mock('@/lib/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tokens')>()),
  createTokenRequestMaxThreeTokens: createTokenRequestSpy,
}));

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { POST } = await import('@/app/api/requestToken/route');
const { generateCSRFToken } = await import('@/lib/csrf');

function makeReq(body: Record<string, unknown>, ip?: string) {
  const { token } = generateCSRFToken('http://x');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-csrf-token': token };
  if (ip) headers['x-forwarded-for'] = ip;
  return new Request('http://x/api/requestToken', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

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
    const res = await POST(makeReq({ tokenLimit: 100, company: 'c' }));
    expect(res.status).toBe(200);
    expect(createTokenRequestSpy).toHaveBeenCalledWith(
      email, expect.anything(), 'ANY', 100, 'c', expect.anything(),
    );
  });

  it('returns 400 for an invalid provider', async () => {
    sessionUser.current = { email: `bogus-${Date.now()}@x.com` };
    const res = await POST(makeReq({ tokenLimit: 100, provider: 'BOGUS' }));
    expect(res.status).toBe(400);
  });

  it('stores a sanitized reason and the requester ip', async () => {
    sessionUser.current = { email: `reason-${Date.now()}@x.com` };
    const res = await POST(makeReq({ tokenLimit: 100, company: 'c', reason: ' need it for demos ' }, '10.1.2.3'));
    expect(res.status).toBe(200);
    const call = vi.mocked(createTokenRequestSpy).mock.calls.at(-1)!;
    expect(call[5]).toEqual({ reason: 'need it for demos', ip: '10.1.2.3' });
  });

  it('rejects reasons over 100 chars', async () => {
    sessionUser.current = { email: `long-${Date.now()}@x.com` };
    const res = await POST(makeReq({ tokenLimit: 100, reason: 'x'.repeat(101) }));
    expect(res.status).toBe(400);
  });

  it('403s pattern-blocked emails before creating a request', async () => {
    const domain = `evil-${Date.now()}.test`;
    const { addBlock, removeBlock, invalidatePatternBlockCache } = await import('@/lib/blocks');
    await addBlock(`emailpat:*@${domain}`, 'spam', 'manual');
    invalidatePatternBlockCache();
    sessionUser.current = { email: `bot@${domain}` };
    const before = vi.mocked(createTokenRequestSpy).mock.calls.length;
    const res = await POST(makeReq({ tokenLimit: 100 }));
    expect(res.status).toBe(403);
    expect(vi.mocked(createTokenRequestSpy).mock.calls.length).toBe(before);
    await removeBlock(`emailpat:*@${domain}`);
  });
});
