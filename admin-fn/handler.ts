import { runAdminOp, type AdminOp } from './ops.js';

export const handler = async (event: AdminOp) => {
  try {
    const result = await runAdminOp(event);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
