import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function DELETE(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { conversation_id } = await req.json();
    if (!conversation_id) return json({ error: 'conversation_id required' }, 400);
    await adminInvoke({ op: 'deleteConversation', payload: { conversation_id } });
    return json({ valid: true });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
