// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test_secret';

const domain = `pat-${Date.now()}.test`;
const email = `bot@${domain}`;

vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn(async () => ({ email })), isAdminEmail: () => false }));
vi.mock('@/lib/providers', () => ({ runCompletion: vi.fn(async () => ({ content: 'hi', estimatedTokens: 10 })) }));
vi.mock('@/lib/adminDocs', () => ({ listDocTopics: vi.fn(async () => []), getDocsForInjection: vi.fn(async () => '') }));

const { POST } = await import('@/app/api/completions/route');
const { runCompletion } = await import('@/lib/providers');
const { addBlock, removeBlock, invalidatePatternBlockCache } = await import('@/lib/blocks');
const { generateCSRFToken } = await import('@/lib/csrf');

function makeReq() {
  const { token } = generateCSRFToken('http://x');
  const ip = `10.6.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  return new Request('http://x/api/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'x-forwarded-for': ip },
    body: JSON.stringify({ message: 'hello', provider: 'OPENAI', model: 'gpt-4o-mini' }),
  });
}

describe('completions email-pattern gate', () => {
  it('403s a pattern-blocked email without running a completion', async () => {
    await addBlock(`emailpat:*@${domain}`, 'spam', 'manual');
    invalidatePatternBlockCache();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('blocked');
    expect(vi.mocked(runCompletion)).not.toHaveBeenCalled();
    await removeBlock(`emailpat:*@${domain}`);
    invalidatePatternBlockCache();
  });
});
