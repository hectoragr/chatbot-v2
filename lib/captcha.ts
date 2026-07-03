import { createHmac, randomBytes } from 'crypto';
import { safeCompare } from './csrf';

const TTL_MS = 10 * 60 * 1000;
const secret = () => process.env.CSRF_SECRET || 'dev_secret';

function sign(answer: string, nonce: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${answer}|${nonce}|${exp}`).digest('hex');
}

/** Stateless arithmetic captcha: the id carries an HMAC of the answer + expiry. */
export function issueCaptcha(): { id: string; question: string } {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const nonce = randomBytes(8).toString('hex');
  const exp = Date.now() + TTL_MS;
  const sig = sign(String(a + b), nonce, exp);
  const id = Buffer.from(JSON.stringify({ nonce, exp, sig })).toString('base64url');
  return { id, question: `${a} + ${b}` };
}

// This is stateless: the same captcha id is replayable any number of times
// within its TTL_MS window, since there's no server-side store marking it
// "used". That's by design — adding a used-ids store would need persistence
// (DDB or in-memory-per-Lambda, neither free) just to block a low-value
// replay. The contact route's 5/day rate cap per subject already bounds how
// much abuse a replayed captcha can enable.
export function verifyCaptcha(id: string, answer: string): boolean {
  try {
    const { nonce, exp, sig } = JSON.parse(Buffer.from(String(id), 'base64url').toString());
    if (typeof exp !== 'number' || typeof nonce !== 'string' || typeof sig !== 'string') return false;
    if (Date.now() > exp) return false;
    return safeCompare(sign(String(answer).trim(), nonce, exp), sig);
  } catch {
    return false;
  }
}
