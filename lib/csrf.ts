import crypto from 'crypto';

const SEC = process.env.CSRF_SECRET || 'change_this_secret';
export const CSRF_TTL_MS = 2 * 60 * 1000;

export function hmac(data: string) {
  return crypto.createHmac('sha256', SEC).update(data).digest('hex');
}
export function randNonce() {
  return crypto.randomBytes(16).toString('hex');
}
export function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function generateToken(user_id: string): string {
  const randomBytes = crypto.randomBytes(16);
  const timestamp = Date.now().toString(36);
  return crypto.createHash('sha256')
    .update(user_id + timestamp + randomBytes.toString('hex'))
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    .slice(0, 32);
}
export function generateCSRFToken(origin: string) {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({ origin, ts, nonce });
  const sig = hmac(payload);
  const token = Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
  return { token, expiresIn: CSRF_TTL_MS };
}
export function verifyCSRFTokenValue(token: string | null): boolean {
  if (!token) return false;
  let parsed: { payload: string; sig: string };
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  } catch { return false; }
  if (!parsed?.payload || !parsed?.sig) return false;
  if (!safeCompare(hmac(parsed.payload), parsed.sig)) return false;
  // Enforce TTL: payload carries a millisecond `ts`. The client mints a fresh
  // token immediately before each mutating request, so a 2-minute window is
  // ample and bounds the replay surface of a leaked token.
  try {
    const { ts } = JSON.parse(parsed.payload) as { ts?: string };
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Date.now() - tsNum > CSRF_TTL_MS) return false;
  } catch { return false; }
  return true;
}
