import { generateCSRFToken } from '@/lib/csrf';
import { json } from '@/lib/http';

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return json(generateCSRFToken(origin));
}
