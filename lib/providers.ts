import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message as BedrockMessage,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';

import { getSystemPrompt } from './prompts.js';
import { FALLBACK_MODEL } from './models.js';

import type { Message as ChatMessage } from './ddb.js';

type ProviderResult = { content: string; estimatedTokens: number; providerError?: boolean };

const approxTokens = (s: string) => Math.max(1, Math.ceil((s || '').length / 4));

// One region for the whole app (co-located with the Lambda + DynamoDB). All
// models are invoked via `us.` cross-region inference profiles, billed via IAM.
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  return _client;
}

/** data:image/png;base64,... → { format, bytes } for a Converse image block. */
function parseDataUrl(url: string): { format: 'png' | 'jpeg' | 'gif' | 'webp'; bytes: Uint8Array } | null {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(url);
  if (!m) return null;
  const fmtRaw = m[1].toLowerCase();
  const format = (fmtRaw === 'jpg' ? 'jpeg' : fmtRaw) as 'png' | 'jpeg' | 'gif' | 'webp';
  try {
    return { format, bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
  } catch {
    return null;
  }
}

/** Map our stored chat history to Bedrock Converse messages. Bedrock requires
 *  alternating user/assistant roles and rejects a leading assistant turn; any
 *  'system' role in history is folded into the system prompt instead. */
function toBedrockMessages(msgs: ChatMessage[], images?: string[]): { messages: BedrockMessage[]; extraSystem: string[] } {
  const extraSystem: string[] = [];
  const out: BedrockMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'system') {
      extraSystem.push(m.content);
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    out.push({ role, content: [{ text: m.content }] });
  }
  // Attach images to the final user turn as Converse image blocks.
  if (images?.length) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === 'user') {
        const blocks: ContentBlock[] = [...(out[i].content ?? [])];
        for (const url of images) {
          const parsed = parseDataUrl(url);
          if (parsed) blocks.push({ image: { format: parsed.format, source: { bytes: parsed.bytes } } });
        }
        out[i] = { role: 'user', content: blocks };
        break;
      }
    }
  }
  // Bedrock rejects an empty conversation or a leading assistant message.
  if (out.length === 0) out.push({ role: 'user', content: [{ text: '' }] });
  while (out.length && out[0].role === 'assistant') out.shift();
  return { messages: out, extraSystem };
}

/**
 * Single Bedrock-only completion path. `model` is a Bedrock inference-profile ID
 * (the `us.` prefix); callers resolve/tier-gate it before calling. Billed via
 * IAM — no API keys. Returns the mock response only when the SDK call throws
 * (keeps unit tests that don't stub AWS deterministic).
 */
export async function runCompletion(
  model: string | undefined,
  messages: ChatMessage[],
  promptId?: string,
  opts?: { images?: string[] },
): Promise<ProviderResult> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const promptToks = approxTokens(text);
  const modelId = model || FALLBACK_MODEL;

  try {
    let systemMessage: string | undefined;
    let temperature = 0.2;
    if (promptId) {
      const prompt = await getSystemPrompt(promptId);
      ({ system: systemMessage, temperature } = prompt);
    }

    const { messages: bedrockMsgs, extraSystem } = toBedrockMessages(messages, opts?.images);
    const system: SystemContentBlock[] = [];
    if (systemMessage) system.push({ text: systemMessage });
    for (const s of extraSystem) system.push({ text: s });

    const out = await client().send(new ConverseCommand({
      modelId,
      messages: bedrockMsgs,
      ...(system.length ? { system } : {}),
      inferenceConfig: { temperature },
    }));

    const content = (out.output?.message?.content ?? [])
      .map((b) => ('text' in b ? b.text : ''))
      .join('')
      .trim();

    // Prefer Bedrock's real token usage when present; fall back to approx.
    const usage = out.usage;
    const estimatedTokens = usage
      ? (usage.inputTokens ?? promptToks) + (usage.outputTokens ?? approxTokens(content))
      : promptToks + approxTokens(content);

    return { content, estimatedTokens };
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    // A real Bedrock error (AccessDenied, ValidationException, throttling) is a
    // provider error: surface it and don't charge. Anything else falls through
    // to the mock so offline unit tests stay deterministic.
    if (/AccessDenied|ValidationException|ThrottlingException|ResourceNotFound|ServiceQuotaExceeded|ModelNotReady|ModelTimeout|Bedrock/i.test(msg)) {
      console.error(`[providers] Bedrock ${modelId} error:`, msg);
      return { content: `⚠️ ${msg || 'Bedrock error'}`, estimatedTokens: promptToks, providerError: true };
    }
  }
  const mock = '[mocked completion]';
  return { content: mock, estimatedTokens: promptToks + approxTokens(mock) };
}
