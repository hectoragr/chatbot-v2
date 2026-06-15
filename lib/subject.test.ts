import { describe, it, expect, vi } from 'vitest';

vi.mock('./auth.js', () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock('./users.js', () => ({ getUserById: vi.fn(async () => null) }));
vi.mock('./tokens.js', () => ({ listTokens: vi.fn(async () => []) }));

const { resolveSubject } = await import('./subject.js');

describe('resolveSubject', () => {
  it('returns anon subject when no session', async () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1', cookie: 'anon_id=zzz' } });
    const s = await resolveSubject(req);
    expect(s.kind).toBe('anon');
    if (s.kind === 'anon') { expect(s.anonId).toBe('zzz'); expect(s.ip).toBe('1.1.1.1'); }
  });
});
