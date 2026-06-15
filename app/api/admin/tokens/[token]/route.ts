import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json } from '@/lib/http';

function deny(msg: string) {
  return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
}

export async function PUT(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { token } = await params;
    const { limit, isActive, provider } = await req.json();
    const result = await adminInvoke({ op: 'updateToken', payload: { token: decodeURIComponent(token), limit, isActive, provider } });
    return json({ valid: true, ...(result as object) });
  } catch (e) { return deny((e as Error).message); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { token } = await params;
    const result = await adminInvoke({ op: 'deleteToken', payload: { token: decodeURIComponent(token) } });
    return json({ valid: true, ...(result as object) });
  } catch (e) { return deny((e as Error).message); }
}
