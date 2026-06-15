import { requireAdmin } from '@/lib/auth';
import { adminInvoke } from '@/lib/adminInvoke';
import { json } from '@/lib/http';

export async function GET() {
  try {
    await requireAdmin();
    const tables = await adminInvoke({ op: 'listTables', payload: {} });
    return json({ valid: true, tables });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg }, msg === 'ADMIN_REQUIRED' ? 401 : 500);
  }
}
