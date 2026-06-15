import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { json, adminDeny } from '@/lib/http';

export async function GET() {
  try {
    await requireAdmin();
    const result = await adminInvoke({ op: 'listBlocks', payload: {} }) as { blocks: unknown };
    return json({ valid: true, blocks: result.blocks });
  } catch (e) { return adminDeny((e as Error).message); }
}

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const { subject, reason } = await req.json();
    if (!subject) return json({ error: 'subject required (user:<email> or ip:<ip>)' }, 400);
    const block = await adminInvoke({ op: 'addBlock', payload: { subject, reason: reason ?? 'manual' } });
    return json({ valid: true, block });
  } catch (e) { return adminDeny((e as Error).message); }
}

export async function DELETE(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  try {
    await requireAdmin();
    const subject = new URL(req.url).searchParams.get('subject');
    if (!subject) return json({ error: 'subject required' }, 400);
    await adminInvoke({ op: 'removeBlock', payload: { subject } });
    return json({ valid: true });
  } catch (e) { return adminDeny((e as Error).message); }
}
