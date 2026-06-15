import { describe, it, expect } from 'vitest';
import { MODELS, modelsForProvider, isValidModel, defaultModel } from './models.js';

describe('models', () => {
  it('lists models per provider', () => {
    expect(modelsForProvider('OPENAI').length).toBeGreaterThan(0);
    expect(modelsForProvider('DEEPSEEK').length).toBeGreaterThan(0);
  });
  it('validates a model id against a provider', () => {
    const id = MODELS.OPENAI[0].id;
    expect(isValidModel('OPENAI', id)).toBe(true);
    expect(isValidModel('OPENAI', 'bogus')).toBe(false);
  });
  it('returns a default model per provider', () => {
    expect(isValidModel('DEEPSEEK', defaultModel('DEEPSEEK'))).toBe(true);
  });
});
