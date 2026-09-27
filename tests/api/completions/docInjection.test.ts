// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';
process.env.ANON_CAPTCHA_REQUIRED = 'false'; // anon captcha gate covered elsewhere

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  classifyMessage: vi.fn(async () => ({ model: 'us.amazon.nova-lite-v1:0', docIds: ['career'] })),
  AUTO_FALLBACK_MODEL: 'us.amazon.nova-micro-v1:0',
  HISTORY_WINDOW: 5,
  keywordPreMatch: vi.fn(() => []),
}));
vi.mock('@/lib/adminDocs', () => ({
  listDocTopics: vi.fn(async () => [{ doc_id: 'career', topics: 'jobs' }]),
  getDocsForInjection: vi.fn(async () => '## Career\nHector builds things.'),
}));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { generateCSRFToken } = await import('@/lib/csrf');

function makeReq() {
  const { token } = generateCSRFToken('http://x');
  const ip = `10.7.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip, cookie: `anon_id=c-${globalThis.crypto.randomUUID()}` },
    body: JSON.stringify({ message: 'who is hector?', provider: 'AUTO', model: 'auto' }),
  });
}

describe('about-me doc injection', () => {
  it('prepends a system message with matched docs, not persisted content', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    // runSmallModelForSummary now also calls runCompletion (Bedrock title gen)
    // as the LAST call — pick the completion whose history carries the doc.
    const call = vi.mocked(runCompletion).mock.calls.find((c) => {
      const h = c[1] as { role: string; content: string }[];
      return h[0]?.role === 'system' && h[0].content.includes('Hector builds things.');
    })!;
    const history = call[1] as { role: string; content: string }[];
    expect(history[0].role).toBe('system');
    expect(history[0].content).toContain('Hector builds things.');
    expect(history[0].content).toContain('not instructions');
  });
});
