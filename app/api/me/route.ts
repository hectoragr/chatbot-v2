import { getSessionUser, isAdminEmail } from '@/lib/auth';
import { getUserById, createUserIfNotExists } from '@/lib/users';
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus } from '@/lib/quota';
import { listTokens, createTokenRequestMaxThreeTokens } from '@/lib/tokens';
import { notifyAdminTokenRequest } from '@/lib/email';
import { json, fail } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    const subject = await resolveSubject(req);
    const quota = await getQuotaStatus(subject);
    if (!user) return json({ authenticated: false, quota });

    let doc = await getUserById(user.email);

    // First-time login: auto-create user + auto-request 1000 ANY tokens + notify admin
    if (!doc) {
      await createUserIfNotExists(user.email, user.name ?? user.email, user.email, '');
      doc = await getUserById(user.email);
      try {
        await createTokenRequestMaxThreeTokens(user.email, user.name ?? user.email, 'ANY', 1000, '');
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          await notifyAdminTokenRequest({
            adminEmail,
            requesterEmail: user.email,
            requesterName: user.name ?? user.email,
            provider: 'ANY',
            limit: 1000,
          });
        }
      } catch {
        // Token request may fail if user already has requests — safe to ignore
      }
    }

    // Check if user has pending (unprocessed) token requests
    const tokens = await listTokens(user.email, 10);
    const pendingApproval = !doc?.approved && tokens.length === 0;

    // Compute per-provider remaining tokens
    const providerRemaining: Record<string, number> = {};
    if (subject.kind === 'user' && subject.tokens) {
      for (const t of subject.tokens) {
        if (t.isActive && (t.limit - t.used) > 0) {
          const key = t.provider; // 'OPENAI', 'DEEPSEEK', 'ANY'
          providerRemaining[key] = (providerRemaining[key] ?? 0) + (t.limit - t.used);
        }
      }
    }

    return json({
      authenticated: true,
      email: user.email,
      name: user.name ?? doc?.name,
      company: doc?.company,
      approved: !!doc?.approved,
      pendingApproval,
      isAdmin: isAdminEmail(user.email),
      quota,
      providerRemaining,
    });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
