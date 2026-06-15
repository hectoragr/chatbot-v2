export type Provider = 'OPENAI' | 'DEEPSEEK';
export interface ModelOption { id: string; label: string; }

export const MODELS: Record<Provider, ModelOption[]> = {
  OPENAI: [
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
  DEEPSEEK: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

export function modelsForProvider(p: Provider): ModelOption[] {
  return MODELS[p] ?? [];
}
export function isValidModel(p: Provider, id: string): boolean {
  return modelsForProvider(p).some((m) => m.id === id);
}
export function defaultModel(p: Provider): string {
  return modelsForProvider(p)[0].id;
}
