/**
 * Strip the trailing port from an `IP:PORT` or `[IPv6]:PORT` authority,
 * returning the bare IP. Used for CloudFront-Viewer-Address, which is always
 * `ip:port`.
 *
 * IPv4:            "1.2.3.4:5678"        -> "1.2.3.4"
 * IPv6 bracketed:  "[2001:db8::1]:5678"  -> "2001:db8::1"
 * IPv6 bare:       "2001:db8::1"         -> "2001:db8::1"   (no port to strip)
 *
 * We must NOT naively split on ':' because a bare IPv6 address contains many
 * colons — that would mangle it. So we only strip a port when the value is
 * bracketed, or when there is exactly ONE colon (an IPv4:port).
 */
function stripPort(value: string): string {
  const v = value.trim();
  // Bracketed IPv6 with optional :port  ->  "[addr]:port" | "[addr]"
  const bracket = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return bracket[1];
  // Exactly one colon => IPv4:port (a bare IPv6 has 2+ colons, no port).
  if ((v.match(/:/g)?.length ?? 0) === 1) return v.split(':')[0];
  return v;
}

/**
 * Resolve the client IP for rate-limiting / abuse controls.
 *
 * SECURITY: the previous implementation trusted the FIRST X-Forwarded-For hop,
 * which is fully client-controlled — a caller could send any XFF and bypass
 * every per-IP control (burst, hourly/daily ceilings, IP blocks). We now trust
 * only edge-added headers:
 *
 *   1. `CloudFront-Viewer-Address` — added BY CloudFront from the real TCP
 *      peer, so it cannot be spoofed by the client. Format is `ip:port`
 *      (may be IPv6); strip the port. This is our source of truth in prod.
 *   2. Right-MOST X-Forwarded-For hop — the entry appended by our own trusted
 *      proxy is the last one; anything the client prepended sits to the left
 *      and is ignored. (Fallback if the CF header isn't forwarded.)
 *   3. `x-real-ip` — single-value fallback for other proxy setups / local dev.
 *   4. 'unknown' — never throw; abuse controls degrade to a shared bucket.
 *
 * NOTE: forwarding CloudFront-Viewer-Address to the origin requires a custom
 * OriginRequestPolicy — ALL_VIEWER_EXCEPT_HOST_HEADER does NOT include
 * CloudFront-managed headers. See infra/lib/chatbot-v2-stack.ts.
 */
export function clientIp(req: Request): string {
  const cfViewer = req.headers.get('cloudfront-viewer-address');
  if (cfViewer && cfViewer.trim()) return stripPort(cfViewer);

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]; // right-most = trusted proxy's view
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  return 'unknown';
}

export function anonIdFrom(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const ANON_COOKIE = 'anon_id';
