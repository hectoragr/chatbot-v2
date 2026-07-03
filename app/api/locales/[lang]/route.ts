import { getLocale, touchLocaleUsage } from '@/lib/locales';
import { json, fail } from '@/lib/http';

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string }> }) {
  try {
    const { lang } = await params;
    const doc = await getLocale(lang);
    if (!doc) return json({ error: 'not_found' }, 404);
    await touchLocaleUsage(lang);
    return json({ locale: { lang: doc.lang, name: doc.name, rtl: doc.rtl, translations: doc.translations } });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
