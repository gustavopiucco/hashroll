import { createHash, createHmac } from 'node:crypto';

/**
 * Deterministic server seeds:
 *   serverSeed = hex(HMAC_SHA256(secret, `${domain}:${player}:${nonce}`))
 *   domain     = `${genesisHash}:${programId}`
 *
 * The API stores nothing: after a restart it re-derives the seed behind any on-chain commitment.
 * Each seed is used for exactly one bet and revealed on-chain when that bet settles.
 * The domain keeps seeds unique per cluster and deployment: without it, a reset localnet or a move
 * from devnet to mainnet with the same secret would re-issue seeds that were already revealed.
 * TODO(phase 3): keep the secret in a KMS/HSM; anyone holding it can predict every future roll.
 */
export class SeedDeriver {
  constructor(
    private readonly secret: string,
    private readonly domain: string,
  ) {
    if (secret.length < 32) throw new Error('HOUSE_SEED_SECRET must have at least 32 characters');
    if (!domain) throw new Error('seed domain is required');
  }

  serverSeed(player: string, nonce: number): string {
    return createHmac('sha256', this.secret).update(`${this.domain}:${player}:${nonce}`).digest('hex');
  }

  commitment(player: string, nonce: number): number[] {
    return Array.from(createHash('sha256').update(this.serverSeed(player, nonce)).digest());
  }
}
