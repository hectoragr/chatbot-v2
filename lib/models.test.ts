import { describe, it, expect } from 'vitest';
import {
  MODELS, ALL_MODELS, modelsForProvider, isValidModel, isModelAllowedForTier,
  isVisionModel, defaultModel, defaultModelForTier, visionModelForTier,
  TIER_MODELS, FALLBACK_MODEL,
} from './models.js';

describe('models (Bedrock-only)', () => {
  it('lists Bedrock models', () => {
    expect(modelsForProvider().length).toBeGreaterThan(0);
    expect(MODELS.BEDROCK.length).toBe(ALL_MODELS.length);
  });

  it('validates a model id', () => {
    const id = ALL_MODELS[0].id;
    expect(isValidModel(id)).toBe(true);
    expect(isValidModel('bogus')).toBe(false);
  });

  it('every model id is a us. inference profile', () => {
    for (const m of ALL_MODELS) expect(m.id.startsWith('us.')).toBe(true);
  });

  it('returns a valid, tier-allowed default per tier', () => {
    for (const tier of ['anon', 'unapproved', 'approved'] as const) {
      const def = defaultModelForTier(tier);
      expect(isValidModel(def)).toBe(true);
      expect(isModelAllowedForTier(tier, def)).toBe(true);
    }
    expect(isValidModel(defaultModel())).toBe(true);
  });

  it('anon tier excludes the flagship; approved includes it', () => {
    const sonnet = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
    expect(isModelAllowedForTier('anon', sonnet)).toBe(false);
    expect(isModelAllowedForTier('approved', sonnet)).toBe(true);
  });

  it('tier allowlists are supersets in the expected order', () => {
    expect(TIER_MODELS.anon.length).toBeLessThan(TIER_MODELS.unapproved.length);
    expect(TIER_MODELS.unapproved.length).toBeLessThanOrEqual(TIER_MODELS.approved.length);
  });

  it('vision helper reflects the registry', () => {
    expect(isVisionModel('us.amazon.nova-pro-v1:0')).toBe(true);
    expect(isVisionModel('us.meta.llama3-3-70b-instruct-v1:0')).toBe(false);
  });

  it('visionModelForTier returns a tier-allowed vision model or undefined', () => {
    const v = visionModelForTier('anon');
    if (v) { expect(isVisionModel(v)).toBe(true); expect(isModelAllowedForTier('anon', v)).toBe(true); }
    const approvedVision = visionModelForTier('approved');
    expect(approvedVision && isVisionModel(approvedVision)).toBe(true);
  });

  it('fallback model is the cheapest and universally valid', () => {
    expect(isValidModel(FALLBACK_MODEL)).toBe(true);
  });
});
