import { describe, it, expect } from 'vitest';
import { GET as csrf } from '@/app/api/csrf/route';
import { GET as models } from '@/app/api/models/route';

describe('simple routes', () => {
  it('csrf returns a token', async () => {
    const res = await csrf(new Request('http://x', { headers: { origin: 'http://x' } }));
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });
  it('models returns provider catalog', async () => {
    const res = await models();
    const body = await res.json();
    expect(body.models.BEDROCK.length).toBeGreaterThan(0);
    expect(body.allModels.length).toBeGreaterThan(0);
    expect(body.allModels[0].provider).toBe('BEDROCK');
  });
});
