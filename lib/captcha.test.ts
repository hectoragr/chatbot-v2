// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.CSRF_SECRET = 'test_secret';
const { issueCaptcha, verifyCaptcha } = await import('./captcha');

afterEach(() => vi.useRealTimers());

describe('captcha', () => {
  it('verifies the correct arithmetic answer', () => {
    const { id, question } = issueCaptcha();
    const [a, b] = question.match(/\d+/g)!.map(Number);
    expect(verifyCaptcha(id, String(a + b))).toBe(true);
  });

  it('rejects a wrong answer', () => {
    const { id } = issueCaptcha();
    expect(verifyCaptcha(id, '99999')).toBe(false);
  });

  it('rejects an expired challenge', () => {
    vi.useFakeTimers();
    const { id, question } = issueCaptcha();
    const [a, b] = question.match(/\d+/g)!.map(Number);
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(verifyCaptcha(id, String(a + b))).toBe(false);
  });

  it('rejects garbage ids without throwing', () => {
    expect(verifyCaptcha('not-base64!!!', '4')).toBe(false);
  });
});
