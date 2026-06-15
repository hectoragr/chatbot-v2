import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await adminInvoke({ op: 'approveToken', payload: { tokenRequestId: id } });
    return json({ valid: true, token: result });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
