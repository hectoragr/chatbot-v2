import { createHmac, randomBytes } from 'crypto';

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

export function verifyCaptcha(id: string, answer: string): boolean {
  try {
    const { nonce, exp, sig } = JSON.parse(Buffer.from(String(id), 'base64url').toString());
    if (typeof exp !== 'number' || typeof nonce !== 'string' || typeof sig !== 'string') return false;
    if (Date.now() > exp) return false;
    return sign(String(answer).trim(), nonce, exp) === sig;
  } catch {
    return false;
  }
}
