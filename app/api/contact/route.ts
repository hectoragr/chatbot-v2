import { getSessionUser } from '@/lib/auth';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { issueCaptcha, verifyCaptcha } from '@/lib/captcha';
import { notifyAdminContact } from '@/lib/email';
import { updateRateLimit } from '@/lib/rateLimits';
import { recordHitAndMaybeBlock } from '@/lib/abuse';
import { findBlock, blockSubjects } from '@/lib/blocks';
import { clientIp } from '@/lib/anon';
import { json, fail } from '@/lib/http';

const MAX_LEN = 2000;
const DAILY_CAP = 10;

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const { message, captchaId, captchaAnswer } = await req.json();
    const clean = typeof message === 'string' ? message.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim() : '';
    if (!clean || clean.length > MAX_LEN) return json({ error: 'message required, max 2000 chars' }, 400);

    const ip = clientIp(req);
    const user = await getSessionUser();

    // Same abuse gates as completions.
    const burstTripped = await recordHitAndMaybeBlock(ip);
    const block = await findBlock(blockSubjects({ ip, email: user?.email }));
    if (burstTripped || block) return json({ error: 'blocked' }, 403);

    if (!user && !verifyCaptcha(String(captchaId ?? ''), String(captchaAnswer ?? ''))) {
      return json({ error: 'captcha_failed', captcha: issueCaptcha() }, 403);
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return json({ error: 'contact not configured' }, 500);

    const subjectKey = `contact:${user?.email ?? `anon:${ip}`}`;
    const count = await updateRateLimit(subjectKey, 1, 24 * 3600);
    if (count > DAILY_CAP) return json({ error: 'rate_limited' }, 429);

    const sent = await notifyAdminContact({ adminEmail, fromLabel: user?.email ?? 'anonymous visitor', message: clean });
    if (!sent) return json({ error: 'send_failed' }, 502);
    return json({ valid: true });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
