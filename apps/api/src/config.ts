import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';

/** Monorepo root (works from both src/ and dist/, which sit at the same depth). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export function loadKeypair(path: string): Keypair {
  const full = isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(full, 'utf8')) as number[]));
}

export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? 'http://localhost:8899',
  houseKeypairPath: process.env.HOUSE_KEYPAIR ?? 'solana/keys/dev/house.json',
  faucetKeypairPath: process.env.FAUCET_KEYPAIR ?? 'solana/keys/dev/admin.json',
  /** Root secret from which every server seed is derived. Leaking it reveals all future rolls. */
  houseSeedSecret: process.env.HOUSE_SEED_SECRET ?? '',
  settlerEnabled: process.env.SETTLER_ENABLED !== 'false',
  isProduction: process.env.NODE_ENV === 'production',
};
