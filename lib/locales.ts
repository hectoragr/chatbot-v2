import { GetCommand, PutCommand, ScanCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, type LocaleDoc } from './ddb';
import { runCompletion } from './providers';
import { resources } from '@/i18n/resources';

const CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const FORBIDDEN = /[<>{}`*_#\[\]\\/"']/;
const BUILTIN = new Set(['en', 'es', 'fr', 'de']);

/** True when `code` (or its base subtag, e.g. "en" from "en-GB") is one of the app's shipped locales. */
export function isBuiltinLocale(code: string): boolean {
  return BUILTIN.has(code) || BUILTIN.has(code.split('-')[0]);
}

export function sanitizeLanguageInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (!s || s.length > 40 || FORBIDDEN.test(s)) return null;
  return s;
}

export function validateLocaleBundle(out: unknown): Pick<LocaleDoc, 'lang' | 'name' | 'rtl' | 'translations'> | null {
  if (!out || typeof out !== 'object') return null;
  const o = out as Record<string, unknown>;
  if (typeof o.code !== 'string' || !CODE_RE.test(o.code)) return null;
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 60) return null;
  if (typeof o.rtl !== 'boolean') return null;
  if (!o.translations || typeof o.translations !== 'object') return null;

  const enKeys = Object.keys(resources.en.translation);
  const t = o.translations as Record<string, unknown>;
  const keys = Object.keys(t);
  if (keys.length !== enKeys.length || enKeys.some((k) => !(k in t))) return null;

  const translations: Record<string, string> = {};
  for (const k of enKeys) {
    if (typeof t[k] !== 'string') return null;
    translations[k] = (t[k] as string).replace(/[<>]/g, '');
  }
  return { lang: o.code, name: o.name.replace(/[<>]/g, '').trim(), rtl: o.rtl, translations };
}

export async function getLocale(lang: string): Promise<LocaleDoc | null> {
  const r = await ddb().send(new GetCommand({ TableName: TABLES.Locales, Key: { lang } }));
  return (r.Item as LocaleDoc) ?? null;
}

export async function listLocales(): Promise<Pick<LocaleDoc, 'lang' | 'name' | 'rtl'>[]> {
  const r = await ddb().send(new ScanCommand({
    TableName: TABLES.Locales,
    ProjectionExpression: 'lang, #n, rtl',
    ExpressionAttributeNames: { '#n': 'name' },
  }));
  return (r.Items as Pick<LocaleDoc, 'lang' | 'name' | 'rtl'>[]) ?? [];
}

export async function touchLocaleUsage(lang: string): Promise<void> {
  try {
    await ddb().send(new UpdateCommand({
      TableName: TABLES.Locales,
      Key: { lang },
      UpdateExpression: 'ADD usageCount :one SET lastUsedAt = :now',
      ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
    }));
  } catch { /* usage tracking must never fail a read */ }
}

export async function deleteLocale(lang: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: TABLES.Locales, Key: { lang } }));
}

/** Asks gpt-4o-mini to validate + translate the full en bundle. Never throws. */
export async function generateLocale(language: string): Promise<LocaleDoc | { error: 'not_a_language' | 'generation_failed' }> {
  const en = resources.en.translation;
  const prompt =
    'You are a localization engine for a chat web app. The user asked for the UI in this language: ' +
    `${JSON.stringify(language)}. If that does not clearly name a real human language, reply with exactly {"error":"not_a_language"}. ` +
    'Otherwise reply with ONLY strict JSON, no markdown fences, of the shape ' +
    '{"code":"<BCP-47 like zh-CN or ar>","name":"<native language name>","rtl":<true if right-to-left script>,"translations":{...}} ' +
    'where "translations" contains EXACTLY the same keys as the following English bundle, every value translated ' +
    '(keep {{placeholders}} untouched, keep them meaningful for a chat UI):\n' +
    JSON.stringify(en);
  try {
    const { content } = await runCompletion('OPENAI', 'gpt-4o-mini', [
      { role: 'user', content: prompt, createdAt: new Date().toISOString() },
    ]);
    const jsonText = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText);
    if (parsed?.error === 'not_a_language') return { error: 'not_a_language' };
    const valid = validateLocaleBundle(parsed);
    if (!valid) return { error: 'generation_failed' };
    if (isBuiltinLocale(valid.lang)) return { error: 'not_a_language' };
    const now = new Date().toISOString();
    const doc: LocaleDoc = { ...valid, usageCount: 0, createdAt: now, lastUsedAt: now };
    await ddb().send(new PutCommand({ TableName: TABLES.Locales, Item: doc }));
    return doc;
  } catch {
    return { error: 'generation_failed' };
  }
}
