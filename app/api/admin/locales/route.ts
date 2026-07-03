import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function DELETE(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { lang } = await req.json();
    await adminInvoke({ op: 'deleteLocale', payload: { lang } });
    return json({ valid: true });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
