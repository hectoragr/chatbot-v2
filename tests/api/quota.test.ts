// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));

const { GET } = await import('@/app/api/quota/route');

describe('GET /api/quota (anon)', () => {
  it('returns a fresh anon quota snapshot', async () => {
    const ip = `10.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*256)}.${Math.floor(Math.random()*256)}`;
    const req = new Request('http://x/api/quota', { headers: { 'x-forwarded-for': ip, cookie: `anon_id=${globalThis.crypto.randomUUID()}` } });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('anon');
    expect(body.blocked).toBe(false);
    expect(body.maxQuestions).toBe(3);
    expect(body.maxTokens).toBe(1000);
  });
});
