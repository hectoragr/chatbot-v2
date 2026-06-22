import { getSessionUser } from '@/lib/auth';
import { getConversationsByUser } from '@/lib/conversations';
import { json, fail } from '@/lib/http';

export async function GET(_req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ valid: true, conversations: [] }); // anon: no persisted history
    const conversations = await getConversationsByUser(user.email);
    return json({ valid: true, conversations });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
