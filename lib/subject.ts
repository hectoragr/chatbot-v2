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
  const allTokens = (await listTokens(user.email, 20)) as TokenDoc[];
  const activeTokens = allTokens.filter((t) => t.isActive);
  // Pick the token with most remaining quota as the "best" token.
  // NOTE: subject.token is the default/fallback for charging, but the actual
  // token charged may differ based on provider-aware selection in
  // selectTokenForProvider() (exact provider match > 'ANY' > best fallback).
  const best = [...activeTokens].sort((a, b) => (b.limit - b.used) - (a.limit - a.used))[0];
  return { kind: 'user', email: user.email, approved, token: best, tokens: activeTokens };
}
