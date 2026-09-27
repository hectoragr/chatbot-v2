// Bedrock-only model registry. Every model is invoked via a cross-region
// inference profile (the `us.` prefix) in us-east-1, billed through IAM — no API
// keys. IDs confirmed against `aws bedrock list-inference-profiles` for the
// account; only dated/GA profiles are used (preview profiles excluded).
export type Provider = 'BEDROCK';
export type Tier = 'anon' | 'unapproved' | 'approved';

export interface ModelOption { id: string; label: string; }
export interface UnifiedModel {
  id: string;
  provider: Provider;
  label: string;
  description: string;
  costPer1kTokens: number; // approx input price per 1K tokens, USD
  vision: boolean;
}

// Sorted expensive → cheap.
export const ALL_MODELS: UnifiedModel[] = [
  { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', provider: 'BEDROCK', label: 'Claude Sonnet 4.5', description: 'Bedrock · flagship · vision', costPer1kTokens: 3.00, vision: true },
  { id: 'us.mistral.pixtral-large-2502-v1:0',           provider: 'BEDROCK', label: 'Pixtral Large',      description: 'Bedrock · Mistral · vision',  costPer1kTokens: 2.00, vision: true },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',  provider: 'BEDROCK', label: 'Claude Haiku 4.5',   description: 'Bedrock · fast · vision',      costPer1kTokens: 0.80, vision: true },
  { id: 'us.amazon.nova-pro-v1:0',                      provider: 'BEDROCK', label: 'Nova Pro',           description: 'Bedrock · balanced · vision',  costPer1kTokens: 0.80, vision: true },
  { id: 'us.meta.llama3-3-70b-instruct-v1:0',           provider: 'BEDROCK', label: 'Llama 3.3 70B',      description: 'Bedrock · open-weight',        costPer1kTokens: 0.72, vision: false },
  { id: 'us.amazon.nova-lite-v1:0',                     provider: 'BEDROCK', label: 'Nova Lite',          description: 'Bedrock · cheap · vision',     costPer1kTokens: 0.06, vision: true },
  { id: 'us.amazon.nova-micro-v1:0',                    provider: 'BEDROCK', label: 'Nova Micro',         description: 'Bedrock · cheapest · text',    costPer1kTokens: 0.035, vision: false },
];

// Cheapest model — used for the internal classifier + title-summary calls and as
// the universal fallback.
export const FALLBACK_MODEL = 'us.amazon.nova-micro-v1:0';

// Per-tier model allowlists. A tier can only invoke models in its set; the auto
// router picks only from the caller's set. Higher tiers are supersets in spirit
// but each is listed explicitly so the gate is unambiguous.
export const TIER_MODELS: Record<Tier, string[]> = {
  anon: [
    'us.amazon.nova-micro-v1:0',
    'us.amazon.nova-lite-v1:0',
  ],
  unapproved: [
    'us.amazon.nova-micro-v1:0',
    'us.amazon.nova-lite-v1:0',
    'us.amazon.nova-pro-v1:0',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  ],
  approved: ALL_MODELS.map((m) => m.id), // full set
};

// Default model per tier (used when a requested model is not allowed for the tier).
export const TIER_DEFAULT: Record<Tier, string> = {
  anon: 'us.amazon.nova-lite-v1:0',
  unapproved: 'us.amazon.nova-pro-v1:0',
  approved: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
};

const MODEL_IDS = new Set(ALL_MODELS.map((m) => m.id));
const VISION_IDS = new Set(ALL_MODELS.filter((m) => m.vision).map((m) => m.id));

export function isValidModel(id: string): boolean {
  return MODEL_IDS.has(id);
}
export function isVisionModel(id: string): boolean {
  return VISION_IDS.has(id);
}
export function isModelAllowedForTier(tier: Tier, id: string): boolean {
  return (TIER_MODELS[tier] ?? []).includes(id);
}
export function defaultModelForTier(tier: Tier): string {
  return TIER_DEFAULT[tier] ?? FALLBACK_MODEL;
}
/** A vision-capable model the given tier is allowed to use, or undefined. */
export function visionModelForTier(tier: Tier): string | undefined {
  return (TIER_MODELS[tier] ?? []).find((id) => VISION_IDS.has(id));
}

// Models grouped for the picker UI (single provider now, but keep the shape the
// client already consumes).
export const MODELS: Record<Provider, ModelOption[]> = {
  BEDROCK: ALL_MODELS.map(({ id, label }) => ({ id, label })),
};

export function modelsForProvider(_p?: Provider): ModelOption[] {
  return MODELS.BEDROCK;
}
export function defaultModel(): string {
  return TIER_DEFAULT.anon;
}
// Everything is Bedrock now; kept for call sites that still ask.
export function providerForModel(_id: string): Provider {
  return 'BEDROCK';
}
