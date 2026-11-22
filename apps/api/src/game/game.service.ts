import { BadRequestException, Injectable } from '@nestjs/common';
import { MAX_TARGET, MIN_TARGET, payoutFor, resolveDice, type Direction } from '@hashroll/fair';
import { PlayerStore, type BetRecord } from './player.store.js';

const HOUSE_EDGE_BPS = Number(process.env.HOUSE_EDGE_BPS ?? 100);
// TODO(phase 3): read HouseBankroll.maxPayout() on-chain via viem instead of fixed config.
const MAX_PROFIT = BigInt(process.env.MAX_PROFIT_WEI ?? 1_000n * 10n ** 18n);

export interface BetInput {
  amount: string; // wei, as a string to avoid losing precision
  target: number;
  direction: Direction;
}

@Injectable()
export class GameService {
  constructor(private readonly store: PlayerStore) {}

  publicState(address: string) {
    const p = this.store.get(address);
    return {
      address: p.address,
      balance: p.balance.toString(),
      commitment: p.seeds.commitment,
      clientSeed: p.seeds.clientSeed,
      nonce: p.seeds.nonce,
      houseEdgeBps: HOUSE_EDGE_BPS,
      maxProfit: MAX_PROFIT.toString(),
    };
  }

  /** Reveals the current server seed and starts a new pair. Only after this can the player audit previous bets. */
  rotateSeeds(address: string, newClientSeed?: string) {
    const p = this.store.get(address);
    const clientSeed = newClientSeed?.trim() || p.seeds.clientSeed;
    if (clientSeed.includes(':') || clientSeed.length > 64) {
      throw new BadRequestException('invalid clientSeed (max 64 characters, no ":")');
    }
    const revealed = { serverSeed: p.seeds.serverSeed, commitment: p.seeds.commitment, clientSeed: p.seeds.clientSeed, lastNonce: p.seeds.nonce - 1 };
    p.seeds = PlayerStore.newSeeds(clientSeed);
    return { revealed, next: this.publicState(address) };
  }

  bet(address: string, input: BetInput) {
    let amount: bigint;
    try {
      amount = BigInt(input.amount);
    } catch {
      throw new BadRequestException('amount must be an integer in wei');
    }
    const { target, direction } = input;
    if (amount <= 0n) throw new BadRequestException('amount must be > 0');
    if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) {
      throw new BadRequestException(`target must be between ${MIN_TARGET} and ${MAX_TARGET}`);
    }
    if (direction !== 'under' && direction !== 'over') throw new BadRequestException('invalid direction');

    const p = this.store.get(address);
    if (p.balance < amount) throw new BadRequestException('insufficient balance');
    if (payoutFor(amount, target, HOUSE_EDGE_BPS) - amount > MAX_PROFIT) {
      throw new BadRequestException('potential profit exceeds the bankroll limit');
    }

    // Critical section: synchronous in Node (no await), therefore atomic within this process.
    const nonce = p.seeds.nonce++;
    const result = resolveDice({ amount, target, direction }, { ...p.seeds, nonce }, HOUSE_EDGE_BPS);
    p.balance = p.balance - amount + result.payout;

    const record: BetRecord = {
      id: this.store.nextBetId(),
      nonce,
      commitment: p.seeds.commitment,
      clientSeed: p.seeds.clientSeed,
      amount: amount.toString(),
      target,
      direction,
      roll: result.roll,
      win: result.win,
      payout: result.payout.toString(),
      createdAt: new Date().toISOString(),
    };
    p.bets.unshift(record);
    p.bets.length = Math.min(p.bets.length, 100);
    return { bet: record, balance: p.balance.toString() };
  }

  history(address: string) {
    return this.store.get(address).bets;
  }

  /** Development only: stands in for crediting via the Deposited event (phase 3). */
  devFaucet(address: string, amount: bigint) {
    const p = this.store.get(address);
    p.balance += amount;
    return this.publicState(address);
  }
}
