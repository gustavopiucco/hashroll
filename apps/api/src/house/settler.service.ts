import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROGRAM_ID, toHex } from '@hashroll/program';
import { config } from '../config.js';
import { HouseService } from './house.service.js';

/**
 * Settles pending bets as soon as they land. A log subscription gives the fast path;
 * a periodic sweep catches anything missed (API restart, dropped websocket, failed tx).
 * Every bet that is not settled within the on-chain timeout pays the player its maximum payout,
 * so this loop must stay up.
 */
@Injectable()
export class SettlerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SettlerService.name);
  private timer: NodeJS.Timeout | null = null;
  private subscription: number | null = null;
  private sweeping = false;
  private again = false;

  constructor(private readonly house: HouseService) {}

  onModuleInit() {
    if (!config.settlerEnabled) return;
    this.subscription = this.house.connection.onLogs(PROGRAM_ID, (l) => {
      if (l.logs.some((line) => line.includes('Instruction: Place') || line.includes('Instruction: ClaimExpired'))) {
        void this.sweep();
      }
    });
    this.timer = setInterval(() => void this.sweep(), 3_000);
    void this.sweep();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.subscription !== null) await this.house.connection.removeOnLogsListener(this.subscription);
  }

  async sweep(): Promise<void> {
    if (this.sweeping) {
      this.again = true;
      return;
    }
    this.sweeping = true;
    try {
      for (const { account } of await this.house.pendingBets()) {
        const nonce = account.nonce.toNumber();
        try {
          const sig = await this.house.settle(account.player, nonce, toHex(account.commitment));
          this.log.log(`settled ${account.player.toBase58()} nonce ${nonce} (${sig})`);
        } catch (e) {
          this.log.error(`settle failed for ${account.player.toBase58()} nonce ${nonce}: ${String(e)}`);
        }
      }
      for (const { account } of await this.house.playersWithoutCommitment()) {
        if (account.pending) continue;
        try {
          await this.house.commitSeed(account.player, account.nonce.toNumber());
        } catch (e) {
          this.log.error(`commit failed for ${account.player.toBase58()}: ${String(e)}`);
        }
      }
    } catch (e) {
      this.log.warn(`sweep failed (is the validator up and the program deployed?): ${String(e)}`);
    } finally {
      this.sweeping = false;
      if (this.again) {
        this.again = false;
        void this.sweep();
      }
    }
  }
}
