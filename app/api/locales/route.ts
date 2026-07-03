import { getSessionUser } from '@/lib/auth';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { sanitizeLanguageInput, generateLocale, getLocale, listLocales } from '@/lib/locales';
import { updateRateLimit } from '@/lib/rateLimits';
import { json, fail } from '@/lib/http';

export async function GET() {
  try {
    return json({ locales: await listLocales() });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: 'login_required' }, 401);

    const { language } = await req.json();
    const clean = sanitizeLanguageInput(language);
    if (!clean) return json({ error: 'invalid language request' }, 400);

    const all = await listLocales();
    const hit = all.find((l) => l.lang.toLowerCase() === clean.toLowerCase() || l.name.toLowerCase() === clean.toLowerCase());
    if (hit) {
      const doc = await getLocale(hit.lang);
      if (doc) return json({ locale: { lang: doc.lang, name: doc.name, rtl: doc.rtl, translations: doc.translations } });
    }

    const count = await updateRateLimit(`locale:${user.email}`, 1, 24 * 3600);
    if (count > 3) return json({ error: 'rate_limited' }, 429);

    const result = await generateLocale(clean);
    if ('error' in result) {
      return result.error === 'not_a_language'
        ? json({ error: 'not_a_language' }, 400)
        : json({ error: 'generation_failed' }, 502);
    }
    return json({ locale: { lang: result.lang, name: result.name, rtl: result.rtl, translations: result.translations } });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
