import { describe, it, expect, vi } from 'vitest';
import { generateCSRFToken, verifyCSRFTokenValue, generateToken, CSRF_TTL_MS } from './csrf.js';

describe('csrf', () => {
  it('round-trips a valid token', () => {
    const { token } = generateCSRFToken('https://chat.hectoragomez.com');
    expect(verifyCSRFTokenValue(token)).toBe(true);
  });
  it('rejects tampered token', () => {
    const { token } = generateCSRFToken('x');
    expect(verifyCSRFTokenValue(token + 'AAAA')).toBe(false);
    expect(verifyCSRFTokenValue(null)).toBe(false);
  });
  it('rejects a token past its TTL', () => {
    const { token } = generateCSRFToken('x');
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CSRF_TTL_MS + 1000);
    expect(verifyCSRFTokenValue(token)).toBe(false);
    spy.mockRestore();
  });
  it('generateToken yields 32-char url-safe string', () => {
    const t = generateToken('a@b.com');
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
