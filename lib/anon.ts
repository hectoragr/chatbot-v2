export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function anonIdFrom(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const ANON_COOKIE = 'anon_id';
