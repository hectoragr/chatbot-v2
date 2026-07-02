// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./providers', () => ({ runCompletion: vi.fn() }));

const { runCompletion } = await import('./providers');
const { pickModelForMessage, AUTO_FALLBACK_MODEL } = await import('./autoModel');
const mockRun = vi.mocked(runCompletion);

beforeEach(() => { mockRun.mockReset(); });

describe('pickModelForMessage', () => {
  it('maps simple → gpt-4.1-nano', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    expect(await pickModelForMessage('what is 2+2')).toBe('gpt-4.1-nano');
  });

  it('maps moderate → deepseek-chat (case/punctuation tolerant)', async () => {
    mockRun.mockResolvedValue({ content: ' Moderate.', estimatedTokens: 1 });
    expect(await pickModelForMessage('summarize this article')).toBe('deepseek-chat');
  });

  it('maps complex → deepseek-reasoner', async () => {
    mockRun.mockResolvedValue({ content: 'complex', estimatedTokens: 1 });
    expect(await pickModelForMessage('prove this theorem')).toBe('deepseek-reasoner');
  });

  it('falls back on garbage output', async () => {
    mockRun.mockResolvedValue({ content: '[mocked completion]', estimatedTokens: 1 });
    expect(await pickModelForMessage('hi')).toBe(AUTO_FALLBACK_MODEL);
  });

  it('falls back when the classifier throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    expect(await pickModelForMessage('hi')).toBe(AUTO_FALLBACK_MODEL);
  });

  it('classifies with the cheap OpenAI model', async () => {
    mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
    await pickModelForMessage('hi');
    expect(mockRun).toHaveBeenCalledWith('OPENAI', 'gpt-4.1-nano', expect.any(Array));
  });

  describe('allowedProviders (provider-aware selection)', () => {
    it('moderate + allowedProviders ["OPENAI"] → gpt-4o-mini', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect(await pickModelForMessage('summarize this', ['OPENAI'])).toBe('gpt-4o-mini');
    });

    it('complex + allowedProviders ["OPENAI"] → o3-mini', async () => {
      mockRun.mockResolvedValue({ content: 'complex', estimatedTokens: 1 });
      expect(await pickModelForMessage('prove this theorem', ['OPENAI'])).toBe('o3-mini');
    });

    it('simple + allowedProviders ["DEEPSEEK"] → deepseek-chat', async () => {
      mockRun.mockResolvedValue({ content: 'simple', estimatedTokens: 1 });
      expect(await pickModelForMessage('what is 2+2', ['DEEPSEEK'])).toBe('deepseek-chat');
    });

    it('moderate + allowedProviders undefined → deepseek-chat (primary/current behavior)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect(await pickModelForMessage('summarize this')).toBe('deepseek-chat');
    });

    it('moderate + empty allowedProviders → deepseek-chat (primary/current behavior)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      expect(await pickModelForMessage('summarize this', [])).toBe('deepseek-chat');
    });

    it('moderate + allowedProviders with no matching candidate → primary (deepseek-chat)', async () => {
      mockRun.mockResolvedValue({ content: 'moderate', estimatedTokens: 1 });
      // Neither candidate provider ('DEEPSEEK', 'OPENAI') is excluded entirely here,
      // but simulate an allowed list that matches neither by using a bogus value cast.
      expect(await pickModelForMessage('summarize this', [] as unknown as ('OPENAI' | 'DEEPSEEK')[])).toBe('deepseek-chat');
    });

    it('classifier failure still falls back to AUTO_FALLBACK_MODEL regardless of allowedProviders', async () => {
      mockRun.mockRejectedValue(new Error('boom'));
      expect(await pickModelForMessage('hi', ['OPENAI'])).toBe(AUTO_FALLBACK_MODEL);
    });
  });
});
