// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
process.env.CSRF_SECRET = 'test_secret';

const sessionUser = vi.hoisted(() => ({ current: null as null | { email: string } }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => sessionUser.current), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn() }));

const { runCompletion } = await import('@/lib/providers');
const { resources } = await import('@/i18n/resources');
const { GET, POST } = await import('@/app/api/locales/route');
const { GET: GET_ONE } = await import('@/app/api/locales/[lang]/route');
const { generateCSRFToken } = await import('@/lib/csrf');

const fullTranslations = Object.fromEntries(Object.keys(resources.en.translation).map((k) => [k, `pt:${k}`]));

function postReq(body: Record<string, unknown>) {
  const { token } = generateCSRFToken('http://x');
  return new Request('http://x/api/locales', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { sessionUser.current = null; vi.mocked(runCompletion).mockReset(); });

describe('locales routes', () => {
  it('POST requires authentication', async () => {
    expect((await POST(postReq({ language: 'Portuguese' }))).status).toBe(401);
  });

  it('POST rejects injection-looking input', async () => {
    sessionUser.current = { email: `injection-${Date.now()}@x.com` };
    expect((await POST(postReq({ language: '<script>alert(1)</script>' }))).status).toBe(400);
  });

  it('POST generates, stores, then GET lists and serves it', async () => {
    sessionUser.current = { email: `gen-${Date.now()}@x.com` };
    vi.mocked(runCompletion).mockResolvedValue({
      content: JSON.stringify({ code: 'pt-BR', name: 'Português', rtl: false, translations: fullTranslations }),
      estimatedTokens: 1,
    });
    const res = await POST(postReq({ language: 'Brazilian Portuguese' }));
    expect(res.status).toBe(200);
    expect((await res.json()).locale.lang).toBe('pt-BR');

    const list = await (await GET()).json();
    expect(list.locales.some((l: { lang: string }) => l.lang === 'pt-BR')).toBe(true);

    const one = await GET_ONE(new Request('http://x/api/locales/pt-BR'), { params: Promise.resolve({ lang: 'pt-BR' }) });
    expect(one.status).toBe(200);
    expect((await one.json()).locale.translations).toBeTruthy();
  });

  it('GET of an unknown locale is 404', async () => {
    const res = await GET_ONE(new Request('http://x/api/locales/xx-XX'), { params: Promise.resolve({ lang: 'xx-XX' }) });
    expect(res.status).toBe(404);
  });

  it('POST returns 400 when the LLM says not a language', async () => {
    sessionUser.current = { email: `notlang-${Date.now()}@x.com` };
    vi.mocked(runCompletion).mockResolvedValue({ content: '{"error":"not_a_language"}', estimatedTokens: 1 });
    expect((await POST(postReq({ language: 'blorptalk' }))).status).toBe(400);
  });
});
