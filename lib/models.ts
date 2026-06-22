export type Provider = 'OPENAI' | 'DEEPSEEK';
export interface ModelOption { id: string; label: string; }
export interface UnifiedModel { id: string; provider: Provider; label: string; description: string; costPer1kTokens: number; }

// Sorted expensive → cheap (costPer1kTokens = approximate input price per 1K tokens USD)
export const ALL_MODELS: UnifiedModel[] = [
  { id: 'gpt-4o',            provider: 'OPENAI',   label: 'GPT-4o',         description: 'OpenAI · flagship · ~$2.5/1K',   costPer1kTokens: 2.50 },
  { id: 'gpt-4.1',           provider: 'OPENAI',   label: 'GPT-4.1',        description: 'OpenAI · capable · ~$2/1K',      costPer1kTokens: 2.00 },
  { id: 'o3-mini',           provider: 'OPENAI',   label: 'o3 Mini',        description: 'OpenAI · reasoning · ~$1.1/1K',  costPer1kTokens: 1.10 },
  { id: 'deepseek-reasoner', provider: 'DEEPSEEK', label: 'DeepSeek R1',    description: 'DeepSeek · reasoning · ~$0.55/1K', costPer1kTokens: 0.55 },
  { id: 'gpt-4.1-mini',      provider: 'OPENAI',   label: 'GPT-4.1 Mini',  description: 'OpenAI · balanced · ~$0.4/1K',   costPer1kTokens: 0.40 },
  { id: 'deepseek-chat',     provider: 'DEEPSEEK', label: 'DeepSeek V3',    description: 'DeepSeek · fast · ~$0.27/1K',    costPer1kTokens: 0.27 },
  { id: 'gpt-4o-mini',       provider: 'OPENAI',   label: 'GPT-4o Mini',   description: 'OpenAI · efficient · ~$0.15/1K', costPer1kTokens: 0.15 },
  { id: 'gpt-4.1-nano',      provider: 'OPENAI',   label: 'GPT-4.1 Nano',  description: 'OpenAI · cheapest · ~$0.1/1K',   costPer1kTokens: 0.10 },
];

// Per-provider list for backward compat
export const MODELS: Record<Provider, ModelOption[]> = {
  OPENAI: ALL_MODELS.filter((m) => m.provider === 'OPENAI').map(({ id, label }) => ({ id, label })),
  DEEPSEEK: ALL_MODELS.filter((m) => m.provider === 'DEEPSEEK').map(({ id, label }) => ({ id, label })),
};

export function modelsForProvider(p: Provider): ModelOption[] {
  return MODELS[p] ?? [];
}
export function isValidModel(p: Provider, id: string): boolean {
  return ALL_MODELS.some((m) => m.provider === p && m.id === id);
}
export function defaultModel(p: Provider): string {
  return modelsForProvider(p)[0].id;
}
export function providerForModel(id: string): Provider {
  return ALL_MODELS.find((m) => m.id === id)?.provider ?? 'OPENAI';
}
