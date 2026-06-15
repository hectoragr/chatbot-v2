import { describe, it, expect } from 'vitest';
import { generateCSRFToken, verifyCSRFTokenValue, generateToken } from './csrf.js';

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
  it('generateToken yields 32-char url-safe string', () => {
    const t = generateToken('a@b.com');
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
