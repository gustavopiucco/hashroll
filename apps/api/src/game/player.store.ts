import { Injectable } from '@nestjs/common';
import { generateSeed, hashServerSeed } from '@hashroll/fair';

export interface SeedPair {
  serverSeed: string; // SECRET until rotation
  commitment: string; // SHA256(serverSeed), public
  clientSeed: string;
  nonce: number;
}

export interface BetRecord {
  id: number;
  nonce: number;
  commitment: string;
  clientSeed: string;
  amount: string;
  target: number;
  direction: 'under' | 'over';
  roll: number;
  win: boolean;
  payout: string;
  createdAt: string;
}

export interface Player {
  address: string;
  balance: bigint; // HROLL wei, off-chain balance
  seeds: SeedPair;
  bets: BetRecord[];
}

/**
 * IN-MEMORY storage (MVP). Restarting the API wipes everything.
 * Roadmap phase 2: Postgres (balances, bets, seeds, sessions; locks via row locks / advisory locks).
 * When migrating, the nonce increment + balance debit MUST happen in the same
 * transaction with a row lock (SELECT ... FOR UPDATE).
 */
@Injectable()
export class PlayerStore {
  private players = new Map<string, Player>();
  private seq = 0;

  get(address: string): Player {
    const key = address.toLowerCase();
    let p = this.players.get(key);
    if (!p) {
      p = { address: key, balance: 0n, seeds: PlayerStore.newSeeds(generateSeed(16)), bets: [] };
      this.players.set(key, p);
    }
    return p;
  }

  nextBetId(): number {
    return ++this.seq;
  }

  static newSeeds(clientSeed: string): SeedPair {
    const serverSeed = generateSeed(32);
    return { serverSeed, commitment: hashServerSeed(serverSeed), clientSeed, nonce: 0 };
  }
}
