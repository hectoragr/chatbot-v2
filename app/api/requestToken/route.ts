import { getSessionUser } from '@/lib/auth';
import { createTokenRequestMaxThreeTokens } from '@/lib/tokens';
import { createUserIfNotExists } from '@/lib/users';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, fail } from '@/lib/http';
import type { Provider } from '@/lib/models';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'login_required' }, 401);
    const { tokenLimit, company, provider, name } = await req.json();
    const limit = Number(tokenLimit);
    if (!provider || !Number.isFinite(limit) || limit <= 0) {
      return json({ error: 'provider and positive tokenLimit required' }, 400);
    }
    await createUserIfNotExists(user.email, name ?? user.name ?? user.email, user.email, company ?? '');
    const reqDoc = await createTokenRequestMaxThreeTokens(
      user.email, name ?? user.name ?? user.email, provider as Provider, limit, company ?? '',
    );
    return json({ valid: true, token: reqDoc.token, message: 'Request submitted for admin approval.' });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
