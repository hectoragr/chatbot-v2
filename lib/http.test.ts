import { describe, it, expect } from 'vitest';
import { errorStatus, fail } from './http.js';

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
  it('maps undefined to 500', () => {
    expect(errorStatus(undefined)).toBe(500);
  });
});

describe('fail', () => {
  it('uses the mapped status and keeps the canonical error message', async () => {
    const res = fail('quota_exceeded', { error: 'hacker_override', tier: 'anon' });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('quota_exceeded'); // extra cannot shadow it
    expect(body.tier).toBe('anon');
  });
});
