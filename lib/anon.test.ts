import { describe, it, expect } from 'vitest';
import { clientIp, anonIdFrom } from './anon.js';

function req(headers: Record<string, string>) {
  return new Request('http://x', { headers });
}

describe('anon', () => {
  describe('clientIp', () => {
    it('prefers CloudFront-Viewer-Address (IPv4) and strips the port', () => {
      expect(clientIp(req({ 'cloudfront-viewer-address': '203.0.113.7:52310' }))).toBe('203.0.113.7');
    });
    it('prefers CloudFront-Viewer-Address (IPv6) and strips the port', () => {
      // CloudFront sends bracketed IPv6 with a port: [addr]:port
      expect(clientIp(req({ 'cloudfront-viewer-address': '[2001:db8::1]:52310' }))).toBe('2001:db8::1');
    });
    it('CloudFront-Viewer-Address wins over a spoofed X-Forwarded-For', () => {
      expect(clientIp(req({
        'cloudfront-viewer-address': '203.0.113.7:443',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      }))).toBe('203.0.113.7');
    });
    it('falls back to the RIGHT-MOST X-Forwarded-For hop (trusted proxy)', () => {
      expect(clientIp(req({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }))).toBe('10.0.0.1');
    });
    it('ignores a spoofed left-most X-Forwarded-For hop', () => {
      // Client prepends a fake IP; only the last (proxy-appended) hop is trusted.
      expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7');
    });
    it('handles a single X-Forwarded-For hop', () => {
      expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    });
    it('falls back to x-real-ip when no CF header or XFF', () => {
      expect(clientIp(req({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    });
    it('returns "unknown" when no source header is present', () => {
      expect(clientIp(req({}))).toBe('unknown');
    });
  });

  it('reads anon id from cookie header', () => {
    expect(anonIdFrom(req({ cookie: 'anon_id=abc123; other=1' }))).toBe('abc123');
    expect(anonIdFrom(req({}))).toBeNull();
  });
});
