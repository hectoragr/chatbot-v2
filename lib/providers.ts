import { getSystemPrompt } from './prompts.js';

import type { Message as ChatMessage } from './ddb.js';

type ProviderResult = { content: string; estimatedTokens: number; providerError?: boolean };

const approxTokens = (s: string) => Math.max(1, Math.ceil((s || '').length / 4));

/** OpenAI reasoning models (o1*, o3*) use 'developer' instead of 'system' and don't support temperature. */
const isReasoningModel = (model: string) => model.startsWith('o1') || model.startsWith('o3');

const mapMsgs = (msgs: ChatMessage[], systemMessage?: string, useDevRole = false) => {
  const messages: { role: string; content: string }[] = msgs.map((m) => ({ role: m.role, content: m.content }));
  if (systemMessage) {
    messages.unshift({ role: useDevRole ? 'developer' : 'system', content: systemMessage });
  }
  return messages;
};

export async function runCompletion(
  provider: 'OPENAI' | 'DEEPSEEK',
  model: string | undefined,
  messages: ChatMessage[],
  promptId?: string,
  opts?: { images?: string[] },
): Promise<ProviderResult> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const promptToks = approxTokens(text);

  try {
    if (provider === 'OPENAI' && process.env.OPENAI_API_KEY) {
      const mdl = model || process.env.OPENAI_MODEL || 'gpt-4.1-nano';
      const reasoning = isReasoningModel(mdl);
      let systemMessage: string | undefined;
      let temperature = 0.2;

      if (promptId) {
        const prompt = await getSystemPrompt(promptId);
        ({ system: systemMessage, temperature } = prompt);
      }

      const body: Record<string, unknown> = {
        model: mdl,
        messages: mapMsgs(messages, systemMessage, reasoning),
      };

      // Attach images to the final user message as multimodal parts.
      if (opts?.images?.length) {
        const msgs = body.messages as { role: string; content: unknown }[];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            msgs[i].content = [
              { type: 'text', text: String(msgs[i].content) },
              ...opts.images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ];
            break;
          }
        }
      }

      // Reasoning models don't support temperature
      if (!reasoning) {
        body.temperature = temperature;
      }

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || data?.error) {
        console.error(`[providers] OpenAI ${mdl} error:`, JSON.stringify(data?.error ?? data));
        const errMsg = data?.error?.message ?? 'OpenAI API error';
        return { content: `⚠️ ${errMsg}`, estimatedTokens: promptToks, providerError: true };
      }
      const content = data?.choices?.[0]?.message?.content ?? '';
      return { content, estimatedTokens: promptToks + approxTokens(content) };
    }
    if (provider === 'DEEPSEEK' && process.env.DEEPSEEK_API_KEY) {
      const mdl = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: mdl, messages: mapMsgs(messages), temperature: 0.2 }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) {
        console.error(`[providers] DeepSeek ${mdl} error:`, JSON.stringify(data?.error ?? data));
        const errMsg = data?.error?.message ?? 'DeepSeek API error';
        return { content: `⚠️ ${errMsg}`, estimatedTokens: promptToks, providerError: true };
      }
      const content = data?.choices?.[0]?.message?.content ?? '';
      return { content, estimatedTokens: promptToks + approxTokens(content) };
    }
  } catch {
    // Fall through to mock response
  }
  const mock = '[mocked completion]';
  return { content: mock, estimatedTokens: promptToks + approxTokens(mock) };
}
