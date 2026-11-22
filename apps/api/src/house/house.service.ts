import { Injectable, Logger } from '@nestjs/common';
import { AnchorProvider, type Program, type Wallet } from '@coral-xyz/anchor';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from '@solana/spl-token';
import {
  HROLL_DECIMALS,
  HROLL_UNIT,
  configPda,
  fetchPlayer,
  formatHroll,
  getProgram,
  isZeroCommitment,
  fromHex,
  playerPda,
  playerTokenAccount,
  vaultPda,
  type Hashroll,
  type PlayerView,
} from '@hashroll/program';
import { config, loadKeypair } from '../config.js';
import { SeedDeriver } from './seeds.js';
import { isUsableTokenAccount } from './token-account.js';

function keypairWallet(kp: Keypair): Wallet {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  };
}

/** The house: owns the settler key, derives server seeds and talks to the program. */
@Injectable()
export class HouseService {
  private readonly log = new Logger(HouseService.name);
  readonly connection = new Connection(config.rpcUrl, 'confirmed');
  readonly house = loadKeypair(config.houseKeypairPath);
  private seedDeriver: Promise<SeedDeriver> | null = null;
  readonly program: Program<Hashroll> = getProgram(
    new AnchorProvider(this.connection, keypairWallet(this.house), { commitment: 'confirmed' }),
  );
  private mint: PublicKey | null = null;

  /** Seeds are bound to this cluster (genesis hash) and this deployment (program ID). */
  seeds(): Promise<SeedDeriver> {
    this.seedDeriver ??= this.connection
      .getGenesisHash()
      .then((genesis) => new SeedDeriver(config.houseSeedSecret, `${genesis}:${this.program.programId.toBase58()}`))
      .catch((e: unknown) => {
        this.seedDeriver = null; // retry on the next call
        throw e;
      });
    return this.seedDeriver;
  }

  async getConfig() {
    const cfg = await this.program.account.config.fetch(configPda());
    this.mint = cfg.mint;
    return cfg;
  }

  private async getMint(): Promise<PublicKey> {
    return this.mint ?? (await this.getConfig()).mint;
  }

  async houseInfo() {
    const cfg = await this.getConfig();
    const vault = await this.connection.getTokenAccountBalance(vaultPda());
    const bankroll = BigInt(vault.value.amount);
    const reserved = BigInt(cfg.reserved.toString());
    const free = bankroll > reserved ? bankroll - reserved : 0n;
    return {
      programId: this.program.programId.toBase58(),
      house: cfg.house.toBase58(),
      mint: cfg.mint.toBase58(),
      houseEdgeBps: cfg.houseEdgeBps,
      maxPayoutBps: cfg.maxPayoutBps,
      settleTimeoutSecs: cfg.settleTimeoutSecs.toNumber(),
      paused: cfg.paused,
      bankroll: bankroll.toString(),
      reserved: reserved.toString(),
      maxProfit: ((free * BigInt(cfg.maxPayoutBps)) / 10_000n).toString(),
    };
  }

  /** Makes sure the player has an account and a commitment to bet against. Idempotent. */
  async ensurePlayer(player: PublicKey): Promise<PlayerView> {
    const key = player.toBase58();
    const seeds = await this.seeds();
    let view = await fetchPlayer(this.program, player);
    if (!view) {
      await this.program.methods
        .openPlayer(seeds.commitment(key, 0))
        .accountsPartial({ house: this.house.publicKey, config: configPda(), player, playerState: playerPda(player) })
        .rpc();
      this.log.log(`opened player ${key}`);
    } else if (!view.pending && isZeroCommitment(fromHex(view.commitment))) {
      await this.commitSeed(player, view.nonce);
    } else {
      return view;
    }
    view = await fetchPlayer(this.program, player);
    if (!view) throw new Error('player account not found after opening it');
    return view;
  }

  async commitSeed(player: PublicKey, nonce: number) {
    const seeds = await this.seeds();
    await this.program.methods
      .commitSeed(seeds.commitment(player.toBase58(), nonce))
      .accountsPartial({ house: this.house.publicKey, config: configPda(), playerState: playerPda(player) })
      .rpc();
    this.log.log(`committed seed for ${player.toBase58()} nonce ${nonce}`);
  }

  /** Reveals the seed of the player's pending bet and commits the next one. */
  async settle(player: PublicKey, nonce: number, commitmentHex: string): Promise<string> {
    const key = player.toBase58();
    const seeds = await this.seeds();
    const serverSeed = seeds.serverSeed(key, nonce);
    const expected = Buffer.from(seeds.commitment(key, nonce)).toString('hex');
    if (expected !== commitmentHex) {
      // The seed secret changed since this commitment was made: the bet can only expire.
      throw new Error(`commitment mismatch for ${key} nonce ${nonce}; the player can claim after the timeout`);
    }
    const mint = await this.getMint();
    // The token account is optional: without it the program credits the payout to the player's
    // `owed` balance (withdrawable later), so nothing the player does to it can block a settlement.
    const ata = playerTokenAccount(mint, player);
    const usable = isUsableTokenAccount(await this.connection.getAccountInfo(ata), mint, player);
    const send = (playerToken: PublicKey | null) =>
      this.program.methods
        .settleBet(serverSeed, seeds.commitment(key, nonce + 1))
        .accountsPartial({
          house: this.house.publicKey,
          config: configPda(),
          playerState: playerPda(player),
          mint,
          vault: vaultPda(),
          playerToken,
        })
        .rpc();
    if (!usable) return send(null);
    try {
      return await send(ata);
    } catch (e) {
      // The account may have changed between the check and the transaction. Retry without it, so
      // the bet still settles (a wrong seed would fail again, which is what we want to see).
      this.log.warn(`settle with token account failed for ${key} nonce ${nonce}, retrying without it: ${String(e)}`);
      return send(null);
    }
  }

  /** Development only: 2 SOL for fees + 1000 HROLL from the dev treasury. */
  async devFaucet(player: PublicKey) {
    const treasury = loadKeypair(config.faucetKeypairPath);
    const mint = await this.getMint();
    const sig = await this.connection.requestAirdrop(player, 2 * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction({ signature: sig, ...(await this.connection.getLatestBlockhash()) });

    const amount = 1_000n * HROLL_UNIT;
    const to = playerTokenAccount(mint, player);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, to, player, mint),
      createTransferCheckedInstruction(playerTokenAccount(mint, treasury.publicKey), mint, to, treasury.publicKey, amount, HROLL_DECIMALS),
    );
    await this.program.provider.sendAndConfirm!(tx, [treasury]);
    this.log.log(`faucet: ${formatHroll(amount)} HROLL + 2 SOL to ${player.toBase58()}`);
    return { sol: 2, hroll: amount.toString() };
  }

  /** Pending bets (memcmp on `pending` = 1; base58 of [1] is "2"). */
  async pendingBets() {
    return this.program.account.playerState.all([{ memcmp: { offset: 80, bytes: '2' } }]);
  }

  /** Players whose commitment was cleared by an expiry claim (32 zero bytes at offset 48). */
  async playersWithoutCommitment() {
    return this.program.account.playerState.all([{ memcmp: { offset: 48, bytes: '1'.repeat(32) } }]);
  }
}
