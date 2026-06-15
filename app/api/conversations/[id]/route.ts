import { getSessionUser } from '@/lib/auth';
import { getConversation, deleteConversation } from '@/lib/conversations';
import { json, fail } from '@/lib/http';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) return json({ error: 'conversation not found' }, 404);
    return json({ valid: true, conversation: convo });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) return json({ error: 'conversation not found' }, 404);
    if (convo.user_id !== user.email) return json({ error: 'forbidden' }, 403);
    await deleteConversation(id);
    return json({ valid: true, conversationId: id });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
