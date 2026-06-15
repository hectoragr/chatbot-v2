import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json } from '@/lib/http';

function deny(msg: string) {
  return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
}

export async function PUT(req: Request, { params }: { params: Promise<{ email: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { email } = await params;
    const { name, company } = await req.json();
    const result = await adminInvoke({ op: 'updateUser', payload: { email: decodeURIComponent(email), name, company } });
    return json({ valid: true, user: result });
  } catch (e) { return deny((e as Error).message); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ email: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { email } = await params;
    const result = await adminInvoke({ op: 'deleteUser', payload: { email: decodeURIComponent(email) } });
    return json({ valid: true, ...(result as object) });
  } catch (e) { return deny((e as Error).message); }
}
