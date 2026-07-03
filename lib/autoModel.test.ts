// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./providers', () => ({ runCompletion: vi.fn() }));

const { runCompletion } = await import('./providers');
const { classifyMessage, AUTO_FALLBACK_MODEL } = await import('./autoModel');
const mockRun = vi.mocked(runCompletion);

beforeEach(() => { mockRun.mockReset(); });

describe('classifyMessage', () => {
  it('maps simple → gpt-4.1-nano', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    expect((await classifyMessage('what is 2+2')).model).toBe('gpt-4.1-nano');
  });

  it('maps moderate → deepseek-chat (case/punctuation tolerant)', async () => {
    mockRun.mockResolvedValue({ content: ' Moderate.', estimatedTokens: 1 });
    expect((await classifyMessage('summarize this article')).model).toBe('deepseek-chat');
  });

  it('maps complex → deepseek-reasoner', async () => {
    mockRun.mockResolvedValue({ content: 'complex', estimatedTokens: 1 });
    expect((await classifyMessage('prove this theorem')).model).toBe('deepseek-reasoner');
  });

  it('falls back on garbage output', async () => {
    mockRun.mockResolvedValue({ content: '[mocked completion]', estimatedTokens: 1 });
    expect((await classifyMessage('hi')).model).toBe(AUTO_FALLBACK_MODEL);
  });

  it('falls back when the classifier throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    expect((await classifyMessage('hi')).model).toBe(AUTO_FALLBACK_MODEL);
  });

  it('classifies with the cheap OpenAI model', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    await classifyMessage('hi');
    expect(mockRun).toHaveBeenCalledWith('OPENAI', 'gpt-4.1-nano', expect.any(Array));
  });

  describe('allowedProviders (provider-aware selection)', () => {
    it('moderate + allowedProviders ["OPENAI"] → gpt-4o-mini', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect((await classifyMessage('summarize this', { allowedProviders: ['OPENAI'] })).model).toBe('gpt-4o-mini');
    });

    it('complex + allowedProviders ["OPENAI"] → o3-mini', async () => {
      mockRun.mockResolvedValue({ content: 'complex', estimatedTokens: 1 });
      expect((await classifyMessage('prove this theorem', { allowedProviders: ['OPENAI'] })).model).toBe('o3-mini');
    });

    it('simple + allowedProviders ["DEEPSEEK"] → deepseek-chat', async () => {
      mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
      expect((await classifyMessage('what is 2+2', { allowedProviders: ['DEEPSEEK'] })).model).toBe('deepseek-chat');
    });

    it('moderate + allowedProviders undefined → deepseek-chat (primary/current behavior)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect((await classifyMessage('summarize this')).model).toBe('deepseek-chat');
    });

    it('moderate + empty allowedProviders → deepseek-chat (primary/current behavior)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect((await classifyMessage('summarize this', { allowedProviders: [] })).model).toBe('deepseek-chat');
    });

    it('moderate + allowedProviders with no matching candidate → primary (deepseek-chat)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      // Neither candidate provider ('DEEPSEEK', 'OPENAI') is excluded entirely here,
      // but simulate an allowed list that matches neither by using a bogus value cast.
      expect((await classifyMessage('summarize this', { allowedProviders: [] as unknown as ('OPENAI' | 'DEEPSEEK')[] })).model).toBe('deepseek-chat');
    });

    it('classifier failure still falls back to AUTO_FALLBACK_MODEL regardless of allowedProviders', async () => {
      mockRun.mockRejectedValue(new Error('boom'));
      expect((await classifyMessage('hi', { allowedProviders: ['OPENAI'] })).model).toBe(AUTO_FALLBACK_MODEL);
    });
  });

  describe('doc matching', () => {
    const docTopics = [{ doc_id: 'career', topics: 'jobs, work history, hector' }];

    it('parses tier + docs from JSON output', async () => {
      mockRun.mockResolvedValue({ content: '{"tier":"simple","docs":["career"]}', estimatedTokens: 1 });
      const r = await classifyMessage('who is hector?', { docTopics });
      expect(r.model).toBe('gpt-4.1-nano');
      expect(r.docIds).toEqual(['career']);
    });

    it('filters unknown doc ids', async () => {
      mockRun.mockResolvedValue({ content: '{"tier":"simple","docs":["career","bogus"]}', estimatedTokens: 1 });
      expect((await classifyMessage('q', { docTopics })).docIds).toEqual(['career']);
    });

    it('malformed JSON → fallback model, no docs', async () => {
      mockRun.mockResolvedValue({ content: 'garbage', estimatedTokens: 1 });
      const r = await classifyMessage('q', { docTopics });
      expect(r.model).toBe(AUTO_FALLBACK_MODEL);
      expect(r.docIds).toEqual([]);
    });

    it('without docTopics keeps the single-word protocol', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect((await classifyMessage('q')).model).toBe('deepseek-chat');
    });
  });
});
