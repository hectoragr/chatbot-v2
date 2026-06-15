import { getSessionUser } from './auth.js';
import { getUserById } from './users.js';
import { listTokens } from './tokens.js';
import { clientIp, anonIdFrom } from './anon.js';
import type { QuotaSubject } from './quota.js';
import type { TokenDoc } from './ddb.js';

export async function resolveSubject(req: Request): Promise<QuotaSubject> {
  const user = await getSessionUser();
  if (!user) {
    return { kind: 'anon', anonId: anonIdFrom(req) ?? 'none', ip: clientIp(req) };
  }
  const userDoc = await getUserById(user.email);
  const approved = !!userDoc?.approved;
  // pick the user's active token with the most remaining, if any
  const tokens = (await listTokens(user.email, 10)) as TokenDoc[];
  const active = tokens
    .filter((t) => t.isActive)
    .sort((a, b) => (b.limit - b.used) - (a.limit - a.used))[0];
  return { kind: 'user', email: user.email, approved, token: active };
}
