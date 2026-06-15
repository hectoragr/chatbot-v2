import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus } from '@/lib/quota';
import { json, fail } from '@/lib/http';

export async function GET(req: Request) {
  try {
    const subject = await resolveSubject(req);
    return json(await getQuotaStatus(subject));
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
