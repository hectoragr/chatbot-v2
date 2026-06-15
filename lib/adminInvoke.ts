import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { AdminOp } from '@/admin-fn/ops';

let client: LambdaClient | null = null;

export async function adminInvoke(cmd: AdminOp): Promise<unknown> {
  const fnName = process.env.ADMIN_FN_NAME;
  if (!fnName || process.env.LOCAL_DDB === 'true') {
    const { runAdminOp } = await import('@/admin-fn/ops');
    return runAdminOp(cmd);
  }
  if (!client) client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const out = await client.send(new InvokeCommand({
    FunctionName: fnName,
    Payload: Buffer.from(JSON.stringify(cmd)),
  }));
  const parsed = JSON.parse(Buffer.from(out.Payload!).toString('utf-8'));
  if (!parsed.ok) throw new Error(parsed.error || 'admin_invoke_failed');
  return parsed.result;
}
