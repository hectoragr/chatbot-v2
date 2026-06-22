import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function DELETE(req: Request, { params }: { params: Promise<{ email: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { email } = await params;
    const result = await adminInvoke({ op: 'purgeUser', payload: { email: decodeURIComponent(email) } });
    return json({ valid: true, ...(result as object) });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
