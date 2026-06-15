import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { json, adminDeny } from '@/lib/http';

export async function GET() {
  try {
    await requireAdmin();
    const tables = await adminInvoke({ op: 'listTables', payload: {} });
    return json({ valid: true, tables });
  } catch (e) {
    return adminDeny((e as Error).message);
  }
}
