import { MODELS } from '@/lib/models';
import { json } from '@/lib/http';

export async function GET() {
  return json({ models: MODELS });
}
