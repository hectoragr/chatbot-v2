import { describe, it, expect } from 'vitest';
import { clientIp, anonIdFrom } from './anon.js';

function req(headers: Record<string, string>) {
  return new Request('http://x', { headers });
}

describe('anon', () => {
  it('extracts first x-forwarded-for ip', () => {
    expect(clientIp(req({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }))).toBe('5.5.5.5');
    expect(clientIp(req({}))).toBe('unknown');
  });
  it('reads anon id from cookie header', () => {
    expect(anonIdFrom(req({ cookie: 'anon_id=abc123; other=1' }))).toBe('abc123');
    expect(anonIdFrom(req({}))).toBeNull();
  });
});
