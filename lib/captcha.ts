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

/**
 * Error code the completions route returns when an anonymous request is missing
 * a valid captcha. The client maps this to "show the captcha challenge" (fetch
 * a fresh one from /api/captcha, prompt the user, resubmit with captchaId +
 * captchaAnswer). Distinct from quota/abuse errors so the UI reacts correctly.
 */
export const CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED';

/**
 * Gate for the ANONYMOUS tier only.
 *
 * TRIGGER CHOICE: we require a valid captcha on EVERY anonymous completion,
 * not just the first. Rationale: the app is stateless per-request (Lambda), the
 * captcha is a cheap stateless HMAC check (no DDB round-trip), and "after the
 * first" would need a per-anon server-side "has-solved" marker (extra
 * persistence) that a fresh cookie/IP trivially resets anyway. Requiring it
 * every time is the simpler, strictly-stronger option and the client already
 * caches a solved challenge within its TTL, so the UX cost is one solve per
 * ~10-minute window. Logged-in users never hit this path.
 *
 * Returns true when the anon request carries a valid captcha and may proceed.
 * `captchaId` / `captchaAnswer` come straight from the completions JSON body.
 */
export function anonCaptchaOk(captchaId: unknown, captchaAnswer: unknown): boolean {
  if (typeof captchaId !== 'string' || captchaId.length === 0) return false;
  if (captchaAnswer === undefined || captchaAnswer === null) return false;
  return verifyCaptcha(captchaId, String(captchaAnswer));
}
