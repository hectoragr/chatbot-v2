import { getSessionUser } from '@/lib/auth';
import { getConversationsByUserAndToken, getLatestConversationByTokenUser } from '@/lib/conversations';
import { listTokens } from '@/lib/tokens';
import { json, fail } from '@/lib/http';
import type { TokenDoc } from '@/lib/ddb';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ valid: true, conversations: [] }); // anon: no persisted history
    const url = new URL(req.url);
    const all = url.searchParams.get('all') === 'true';
    const tokens = (await listTokens(user.email, 10)) as TokenDoc[];
    const token = tokens[0]?.token ?? '';
    if (!token) return json({ valid: true, conversations: [] });
    if (all) {
      return json({ valid: true, conversations: await getConversationsByUserAndToken(user.email, token) });
    }
    const latest = await getLatestConversationByTokenUser(token, user.email);
    return json({ valid: true, conversations: latest ? [latest] : [] });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
