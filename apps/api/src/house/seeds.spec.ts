import { computeRoll, hashServerSeed, verifyCommitment } from '@hashroll/fair';
import { parsePublicKey } from '@hashroll/program';
import { SeedDeriver } from './seeds.js';

const PLAYER = '7PfAs5Wj24SqkEenKrN6kA8eF69QwAZpVY4mvkx5MoXp';

describe('SeedDeriver', () => {
  const DOMAIN = 'genesis-a:program-a';
  const seeds = new SeedDeriver('x'.repeat(32), DOMAIN);

  it('is deterministic per (player, nonce) and unique across them', () => {
    expect(seeds.serverSeed(PLAYER, 0)).toBe(seeds.serverSeed(PLAYER, 0));
    expect(seeds.serverSeed(PLAYER, 0)).not.toBe(seeds.serverSeed(PLAYER, 1));
    expect(seeds.serverSeed(PLAYER, 0)).not.toBe(new SeedDeriver('y'.repeat(32), DOMAIN).serverSeed(PLAYER, 0));
  });

  it('never re-issues a seed on another cluster or deployment with the same secret', () => {
    const otherCluster = new SeedDeriver('x'.repeat(32), 'genesis-b:program-a');
    const otherProgram = new SeedDeriver('x'.repeat(32), 'genesis-a:program-b');
    expect(otherCluster.serverSeed(PLAYER, 0)).not.toBe(seeds.serverSeed(PLAYER, 0));
    expect(otherProgram.serverSeed(PLAYER, 0)).not.toBe(seeds.serverSeed(PLAYER, 0));
  });

  it('produces 64-hex seeds whose commitment the public verifier accepts', () => {
    const seed = seeds.serverSeed(PLAYER, 3);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    const commitment = Buffer.from(seeds.commitment(PLAYER, 3)).toString('hex');
    expect(commitment).toBe(hashServerSeed(seed));
    expect(verifyCommitment(seed, commitment)).toBe(true);
    expect(computeRoll(seed, 'client', 3)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a short secret', () => {
    expect(() => new SeedDeriver('short', DOMAIN)).toThrow();
    expect(() => new SeedDeriver('x'.repeat(32), '')).toThrow();
  });
});

describe('parsePublicKey', () => {
  it('accepts base58 keys and is case-sensitive', () => {
    expect(parsePublicKey(PLAYER)?.toBase58()).toBe(PLAYER);
    // Lowercasing yields a *different* valid key, which is why addresses must never be normalized.
    expect(parsePublicKey(PLAYER.toLowerCase())?.toBase58()).not.toBe(PLAYER);
    expect(parsePublicKey('not-base58-0OIl')).toBeNull();
    expect(parsePublicKey('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBeNull();
  });
});
