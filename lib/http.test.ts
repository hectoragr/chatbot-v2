import { describe, it, expect } from 'vitest';
import { errorStatus } from './http.js';

describe('errorStatus', () => {
  it('maps token errors to http codes', () => {
    expect(errorStatus('TOKEN_NOT_FOUND')).toBe(404);
    expect(errorStatus('TOKEN_INACTIVE')).toBe(403);
    expect(errorStatus('TOKEN_EXPIRED')).toBe(403);
    expect(errorStatus('TOKEN_REQUEST_NOT_PROCESSED')).toBe(403);
    expect(errorStatus('quota_exceeded')).toBe(402);
    expect(errorStatus('rate_limited')).toBe(429);
    expect(errorStatus('anything_else')).toBe(500);
  });
});
