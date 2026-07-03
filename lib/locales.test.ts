// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

vi.mock('./providers', () => ({ runCompletion: vi.fn() }));
const { runCompletion } = await import('./providers');
const { sanitizeLanguageInput, validateLocaleBundle, generateLocale, getLocale, deleteLocale, isBuiltinLocale } = await import('./locales');
const { resources } = await import('@/i18n/resources');
const mockRun = vi.mocked(runCompletion);

const enKeys = Object.keys(resources.en.translation);
const fullTranslations = Object.fromEntries(enKeys.map((k) => [k, `zh:${k}`]));

beforeEach(() => { mockRun.mockReset(); });

describe('sanitizeLanguageInput', () => {
  it('accepts plain language names', () => {
    expect(sanitizeLanguageInput('Chinese (Simplified)')).toBe('Chinese (Simplified)');
    expect(sanitizeLanguageInput('  العربية ')).toBe('العربية');
  });
  it('rejects markdown/code injection characters', () => {
    for (const bad of ['<script>', 'a`b', '# heading', 'x[y]', 'a\\b', 'a/b', '{"j":1}', 'a*b', 'a_b']) {
      expect(sanitizeLanguageInput(bad)).toBeNull();
    }
  });
  it('rejects quote characters (prompt-breakout via JSON/string termination)', () => {
    expect(sanitizeLanguageInput('Engl"ish')).toBeNull();
    expect(sanitizeLanguageInput("Engl'ish")).toBeNull();
  });
  it('rejects empties, control chars only, and >40 chars', () => {
    expect(sanitizeLanguageInput('')).toBeNull();
    expect(sanitizeLanguageInput('\x07')).toBeNull();
    expect(sanitizeLanguageInput('x'.repeat(41))).toBeNull();
  });
});

describe('validateLocaleBundle', () => {
  const good = { code: 'zh-CN', name: '中文', rtl: false, translations: fullTranslations };
  it('accepts a complete bundle', () => {
    expect(validateLocaleBundle(good)).toMatchObject({ lang: 'zh-CN', name: '中文', rtl: false });
  });
  it('rejects missing keys, bad code, non-string values, and strips angle brackets', () => {
    expect(validateLocaleBundle({ ...good, translations: { a: 'b' } })).toBeNull();
    expect(validateLocaleBundle({ ...good, code: 'ZH_CN!!' })).toBeNull();
    expect(validateLocaleBundle({ ...good, translations: { ...fullTranslations, [enKeys[0]]: 42 } })).toBeNull();
    const withHtml = { ...good, translations: { ...fullTranslations, [enKeys[0]]: '<b>hi</b>' } };
    expect(validateLocaleBundle(withHtml)!.translations[enKeys[0]]).toBe('bhi/b');
  });
});

describe('isBuiltinLocale', () => {
  it('matches exact and base-subtag built-in codes', () => {
    expect(isBuiltinLocale('en')).toBe(true);
    expect(isBuiltinLocale('es')).toBe(true);
    expect(isBuiltinLocale('fr')).toBe(true);
    expect(isBuiltinLocale('de')).toBe(true);
    expect(isBuiltinLocale('en-GB')).toBe(true);
    expect(isBuiltinLocale('zh-CN')).toBe(false);
    expect(isBuiltinLocale('ar')).toBe(false);
  });
});

describe('generateLocale', () => {
  it('stores and returns a valid generated locale', async () => {
    mockRun.mockResolvedValue({ content: JSON.stringify({ code: 'zh-CN', name: '中文', rtl: false, translations: fullTranslations }), estimatedTokens: 1 });
    const doc = await generateLocale('Chinese');
    expect(doc).toMatchObject({ lang: 'zh-CN', name: '中文', rtl: false });
    expect(await getLocale('zh-CN')).not.toBeNull();
  });
  it('propagates the LLM not-a-language verdict', async () => {
    mockRun.mockResolvedValue({ content: '{"error":"not_a_language"}', estimatedTokens: 1 });
    expect(await generateLocale('asdfghjkl')).toEqual({ error: 'not_a_language' });
  });
  it('returns generation_failed on malformed output or throw', async () => {
    mockRun.mockResolvedValue({ content: 'not json at all', estimatedTokens: 1 });
    expect(await generateLocale('Klingonish')).toEqual({ error: 'generation_failed' });
    mockRun.mockRejectedValue(new Error('boom'));
    expect(await generateLocale('Chinese')).toEqual({ error: 'generation_failed' });
  });
  it('rejects and never stores a built-in code override (e.g. "en")', async () => {
    mockRun.mockResolvedValue({
      content: JSON.stringify({ code: 'en', name: 'English', rtl: true, translations: fullTranslations }),
      estimatedTokens: 1,
    });
    const result = await generateLocale('English but make it RTL');
    expect(result).toEqual({ error: 'not_a_language' });
    expect(await getLocale('en')).toBeNull();
  });
});

describe('deleteLocale', () => {
  it('removes a stored row', async () => {
    mockRun.mockResolvedValue({ content: JSON.stringify({ code: 'xx-testdel', name: 'Test', rtl: false, translations: fullTranslations }), estimatedTokens: 1 });
    const doc = await generateLocale('Testlang');
    expect('lang' in doc && doc.lang).toBe('xx-testdel');
    expect(await getLocale('xx-testdel')).not.toBeNull();
    await deleteLocale('xx-testdel');
    expect(await getLocale('xx-testdel')).toBeNull();
  });
});
