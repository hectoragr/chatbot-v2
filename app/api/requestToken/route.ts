import { getSessionUser } from '@/lib/auth';
import { createTokenRequestMaxThreeTokens } from '@/lib/tokens';
import { createUserIfNotExists } from '@/lib/users';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, fail } from '@/lib/http';
import { notifyAdminTokenRequest } from '@/lib/email';
import { findPatternBlock } from '@/lib/blocks';
import { clientIp } from '@/lib/anon';
import type { Provider } from '@/lib/models';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'login_required' }, 401);

    const patternBlock = await findPatternBlock(user.email);
    if (patternBlock) return json({ error: 'blocked' }, 403);

    const { tokenLimit, company, provider, name, reason } = await req.json();
    const cleanReason = typeof reason === 'string' ? reason.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
    if (cleanReason.length > 100) return json({ error: 'reason too long (100 chars max)' }, 400);
    const limit = Number(tokenLimit);
    const prov = (provider ?? 'ANY') as Provider | 'ANY';
    if (!['ANY', 'OPENAI', 'DEEPSEEK'].includes(prov) || !Number.isFinite(limit) || limit <= 0) {
      return json({ error: 'positive tokenLimit required' }, 400);
    }
    await createUserIfNotExists(user.email, name ?? user.name ?? user.email, user.email, company ?? '');
    const reqDoc = await createTokenRequestMaxThreeTokens(
      user.email, name ?? user.name ?? user.email, prov as Provider, limit, company ?? '',
      { ...(cleanReason ? { reason: cleanReason } : {}), ip: clientIp(req) },
    );
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await notifyAdminTokenRequest({
        adminEmail,
        requesterEmail: user.email,
        requesterName: name ?? user.name ?? user.email,
        provider: prov,
        limit,
        reason: cleanReason || undefined,
      });
    }
    return json({ valid: true, token: reqDoc.token, message: 'Request submitted for admin approval.' });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
