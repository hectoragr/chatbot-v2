import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';
import { loadTokenRequest } from '@/lib/tokens';
import { notifyRequesterDenied } from '@/lib/email';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { id } = await params;
    const tokenReq = await loadTokenRequest(id);
    const result = await adminInvoke({ op: 'denyToken', payload: { tokenRequestId: id } });
    if (tokenReq) {
      await notifyRequesterDenied({ requesterEmail: tokenReq.user_id, requesterName: tokenReq.name });
    }
    return json({ valid: true, result });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
