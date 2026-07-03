import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { doc_id, title, topics, content } = await req.json();
    const doc = await adminInvoke({ op: 'putAdminDoc', payload: { doc_id, title, topics, content } });
    return json({ valid: true, doc });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { doc_id } = await req.json();
    await adminInvoke({ op: 'deleteAdminDoc', payload: { doc_id } });
    return json({ valid: true });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
