import { listPrompts } from '@/lib/prompts';
import { json, fail } from '@/lib/http';

export async function GET() {
  try {
    return json(await listPrompts());
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
