import { issueCaptcha } from '@/lib/captcha';
import { json } from '@/lib/http';

export async function GET() {
  return json(issueCaptcha());
}
