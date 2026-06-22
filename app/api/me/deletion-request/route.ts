import { getSessionUser } from '@/lib/auth';
import { markPendingDelete } from '@/lib/users';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, fail } from '@/lib/http';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    await markPendingDelete(user.email);
    return json({ valid: true });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
