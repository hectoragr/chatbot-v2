import { getSessionUser, isAdminEmail } from '@/lib/auth';
import { getUserById } from '@/lib/users';
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus } from '@/lib/quota';
import { json, fail } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    const subject = await resolveSubject(req);
    const quota = await getQuotaStatus(subject);
    if (!user) return json({ authenticated: false, quota });
    const doc = await getUserById(user.email);
    return json({
      authenticated: true,
      email: user.email,
      name: user.name ?? doc?.name,
      company: doc?.company,
      approved: !!doc?.approved,
      isAdmin: isAdminEmail(user.email),
      quota,
    });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
