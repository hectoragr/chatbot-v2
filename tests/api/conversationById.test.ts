// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
process.env.ADMIN_EMAIL = 'admin@test.local';

const sessionUser = vi.hoisted(() => ({ current: null as null | { email: string; name?: string } }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => sessionUser.current),
  isAdminEmail: (email: string | undefined) => !!email && email === process.env.ADMIN_EMAIL,
}));

const { GET } = await import('@/app/api/conversations/[id]/route');
const { ensureConversation } = await import('@/lib/conversations');

beforeEach(() => { sessionUser.current = null; });

describe('GET /api/conversations/[id]', () => {
  it('returns 401 when there is no session', async () => {
    const convo = await ensureConversation(undefined, 'tok', `owner-${Date.now()}@x.com`);
    const res = await GET(new Request(`http://x/api/conversations/${convo.conversation_id}`), { params: Promise.resolve({ id: convo.conversation_id }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the session user does not own the conversation and is not admin', async () => {
    const owner = `owner-${Date.now()}@x.com`;
    const convo = await ensureConversation(undefined, 'tok', owner);
    sessionUser.current = { email: `other-${Date.now()}@x.com` };
    const res = await GET(new Request(`http://x/api/conversations/${convo.conversation_id}`), { params: Promise.resolve({ id: convo.conversation_id }) });
    expect(res.status).toBe(403);
  });

  it('returns 200 with the conversation for its owner', async () => {
    const owner = `owner-${Date.now()}@x.com`;
    const convo = await ensureConversation(undefined, 'tok', owner);
    sessionUser.current = { email: owner };
    const res = await GET(new Request(`http://x/api/conversations/${convo.conversation_id}`), { params: Promise.resolve({ id: convo.conversation_id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.conversation_id).toBe(convo.conversation_id);
    expect(body.conversation.messages).toEqual([]);
  });

  it('returns 200 for an admin reading someone else\'s conversation', async () => {
    const owner = `owner-${Date.now()}@x.com`;
    const convo = await ensureConversation(undefined, 'tok', owner);
    sessionUser.current = { email: process.env.ADMIN_EMAIL as string };
    const res = await GET(new Request(`http://x/api/conversations/${convo.conversation_id}`), { params: Promise.resolve({ id: convo.conversation_id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.conversation_id).toBe(convo.conversation_id);
  });

  it('returns 404 when the conversation does not exist', async () => {
    sessionUser.current = { email: `someone-${Date.now()}@x.com` };
    const res = await GET(new Request('http://x/api/conversations/does-not-exist'), { params: Promise.resolve({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });
});
