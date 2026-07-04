// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/adminDocs', () => ({ listDocTopics: vi.fn(async () => []), getDocsForInjection: vi.fn(async () => '') }));

const { POST } = await import('@/app/api/completions/route');
const { getConversation } = await import('@/lib/conversations');
const { generateCSRFToken } = await import('@/lib/csrf');

const anonId = `c-${globalThis.crypto.randomUUID()}`;
const ip = `10.5.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

function makeReq(body: Record<string, unknown>) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=${anonId}` },
    body: JSON.stringify({ message: 'hello there', provider: 'OPENAI', model: 'gpt-4o-mini', ...body }),
  });
}

function makeReqAs(otherAnonId: string, otherIp: string, body: Record<string, unknown>) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': otherIp, cookie: `anon_id=${otherAnonId}` },
    body: JSON.stringify({ message: 'hello there', provider: 'OPENAI', model: 'gpt-4o-mini', ...body }),
  });
}

describe('anonymous conversation persistence', () => {
  it('persists an anon conversation with anon user_id, ip, and ~30-day ttl, and threads turn 2', async () => {
    const res1 = await POST(makeReq({}));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.conversationId).toBeTruthy();

    const convo = await getConversation(body1.conversationId);
    expect(convo).not.toBeNull();
    expect(convo!.user_id).toBe(`anon:${anonId}`);
    expect(convo!.ip).toBe(ip);
    const thirtyDays = 30 * 24 * 3600;
    const now = Math.floor(Date.now() / 1000);
    expect(convo!.ttl).toBeGreaterThan(now + thirtyDays - 3600);
    expect(convo!.ttl).toBeLessThanOrEqual(now + thirtyDays + 3600);

    const res2 = await POST(makeReq({ conversationId: body1.conversationId }));
    expect(res2.status).toBe(200);
    const convo2 = await getConversation(body1.conversationId);
    expect(convo2!.messages.length).toBe(4); // 2 user + 2 assistant
  });

  it('refuses to let a different anon identity hijack another anon conversation', async () => {
    const resA = await POST(makeReq({}));
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    const convoAOriginal = await getConversation(bodyA.conversationId);
    expect(convoAOriginal).not.toBeNull();
    const originalMessageCount = convoAOriginal!.messages.length;

    const otherAnonId = `c-${globalThis.crypto.randomUUID()}`;
    const otherIp = `10.6.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

    const resB = await POST(makeReqAs(otherAnonId, otherIp, { conversationId: bodyA.conversationId }));
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();

    // The impostor must NOT be handed A's conversation id back.
    expect(bodyB.conversationId).not.toBe(bodyA.conversationId);

    // A's conversation must be untouched — no messages appended from B's turn.
    const convoAAfter = await getConversation(bodyA.conversationId);
    expect(convoAAfter!.messages.length).toBe(originalMessageCount);
    expect(convoAAfter!.user_id).toBe(`anon:${anonId}`);

    // The impostor got their own brand-new conversation instead.
    const convoB = await getConversation(bodyB.conversationId);
    expect(convoB).not.toBeNull();
    expect(convoB!.user_id).toBe(`anon:${otherAnonId}`);
  });
});
