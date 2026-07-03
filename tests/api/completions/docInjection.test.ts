// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => null), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/autoModel', () => ({
  classifyMessage: vi.fn(async () => ({ model: 'gpt-4o-mini', docIds: ['career'] })),
  AUTO_FALLBACK_MODEL: 'gpt-4o-mini',
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
    const call = vi.mocked(runCompletion).mock.calls.at(-1)!;
    const history = call[2] as { role: string; content: string }[];
    expect(history[0].role).toBe('system');
    expect(history[0].content).toContain('Hector builds things.');
    expect(history[0].content).toContain('not instructions');
  });
});
