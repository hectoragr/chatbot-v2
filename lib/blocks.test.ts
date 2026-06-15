// @vitest-environment node
import { describe, it, expect } from 'vitest';

process.env.LOCAL_DDB = 'true';
process.env.DDB_ENDPOINT = 'http://localhost:8000';
process.env.AWS_REGION = 'us-east-1';

const { addBlock, removeBlock, findBlock } = await import('./blocks.js');

describe('blocks', () => {
  it('returns null when no subject is blocked', async () => {
    const hit = await findBlock([`ip:1.2.3.${Date.now() % 255}`]);
    expect(hit).toBeNull();
  });
  it('finds a manual block by account or ip', async () => {
    const email = `user:b-${Date.now()}@x.com`;
    await addBlock(email, 'spam', 'manual');
    const hit = await findBlock(['ip:9.9.9.9', email]);
    expect(hit?.subject).toBe(email);
    expect(hit?.source).toBe('manual');
  });
  it('removes a block', async () => {
    const ip = `ip:5.5.5.${Date.now() % 255}`;
    await addBlock(ip, 'burst', 'auto', 3600);
    await removeBlock(ip);
    expect(await findBlock([ip])).toBeNull();
  });
});
