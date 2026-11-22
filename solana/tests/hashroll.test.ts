/**
 * Integration tests for the `hashroll` program, run in-process with LiteSVM against the
 * compiled program (target/deploy/hashroll.so; build it first with `npm run build:program`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata, Clock } from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { computeRoll, payoutFor } from "@hashroll/fair";
import {
  BN,
  BPF_LOADER_UPGRADEABLE_ID,
  HROLL_UNIT,
  PROGRAM_ID,
  configPda,
  eventsToHistory,
  fromHex,
  playerPda,
  readOnlyProgram,
  toAnchorDirection,
  toHex,
  toPlayerView,
  vaultPda,
} from "../client/src/index.js";

const SO_PATH = new URL("../target/deploy/hashroll.so", import.meta.url).pathname;
const program = readOnlyProgram({} as never); // instruction building and decoding only

const sha256 = (s: string) => Array.from(createHash("sha256").update(s).digest());
const seedFor = (label: string) => createHash("sha256").update(label).digest("hex"); // 64 hex chars

const PARAMS = { houseEdgeBps: 100, maxPayoutBps: 100, settleTimeoutSecs: new BN(60) };
const BANKROLL = 1_000_000n * HROLL_UNIT;

class Env {
  svm = new LiteSVM();
  admin = Keypair.generate();
  house = Keypair.generate();
  player = Keypair.generate();
  mint = Keypair.generate();
  config = configPda();
  vault = vaultPda();

  constructor() {
    for (const k of [this.admin, this.house, this.player]) this.svm.airdrop(k.publicKey, 100n * 10n ** 9n);
    this.deployUpgradeable(this.admin.publicKey);
  }

  /** Installs the program behind the upgradeable loader so `initialize` can check the upgrade authority. */
  deployUpgradeable(authority: PublicKey) {
    const elf = readFileSync(SO_PATH);
    const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);
    const pdData = Buffer.alloc(45 + elf.length);
    pdData.writeUInt32LE(3, 0); // UpgradeableLoaderState::ProgramData
    pdData.writeBigUInt64LE(0n, 4); // slot
    pdData.writeUInt8(1, 12); // Some(authority)
    authority.toBuffer().copy(pdData, 13);
    elf.copy(pdData, 45);
    this.svm.setAccount(programData, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(pdData.length))),
      data: pdData, owner: BPF_LOADER_UPGRADEABLE_ID, executable: false,
    });
    const progData = Buffer.alloc(36);
    progData.writeUInt32LE(2, 0); // UpgradeableLoaderState::Program
    programData.toBuffer().copy(progData, 4);
    this.svm.setAccount(PROGRAM_ID, {
      lamports: Number(this.svm.minimumBalanceForRentExemption(36n)),
      data: progData, owner: BPF_LOADER_UPGRADEABLE_ID, executable: true,
    });
    return programData;
  }

  get programData() {
    return PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_ID)[0];
  }

  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`tx failed: ${res.toString()}\n${res.meta().logs().join("\n")}`);
    }
    return res;
  }

  ata(owner: PublicKey) {
    return getAssociatedTokenAddressSync(this.mint.publicKey, owner);
  }

  balance(account: PublicKey): bigint {
    const a = this.svm.getAccount(account);
    return a ? AccountLayout.decode(a.data.slice(0, ACCOUNT_SIZE)).amount : 0n;
  }

  configAccount() {
    return program.coder.accounts.decode("config", Buffer.from(this.svm.getAccount(this.config)!.data));
  }

  playerState(player = this.player.publicKey) {
    const raw = this.svm.getAccount(playerPda(player));
    return raw ? toPlayerView(program.coder.accounts.decode("playerState", Buffer.from(raw.data))) : null;
  }

  async createMintAndFund() {
    const rent = Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
    const a = this.admin.publicKey;
    this.send(
      [
        SystemProgram.createAccount({ fromPubkey: a, newAccountPubkey: this.mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(this.mint.publicKey, 9, a, null),
        createAssociatedTokenAccountIdempotentInstruction(a, this.ata(a), a, this.mint.publicKey),
        createAssociatedTokenAccountIdempotentInstruction(a, this.ata(this.player.publicKey), this.player.publicKey, this.mint.publicKey),
        createMintToInstruction(this.mint.publicKey, this.ata(a), a, 10n * BANKROLL),
        createMintToInstruction(this.mint.publicKey, this.ata(this.player.publicKey), a, 1_000n * HROLL_UNIT),
      ],
      [this.admin, this.mint],
    );
  }

  async initialize(signer = this.admin) {
    const ix = await program.methods
      .initialize(this.house.publicKey, PARAMS)
      .accountsPartial({
        admin: signer.publicKey, config: this.config, mint: this.mint.publicKey, vault: this.vault,
        program: PROGRAM_ID, programData: this.programData,
      })
      .instruction();
    return this.send([ix], [signer]);
  }

  async fundHouse(amount = BANKROLL) {
    const ix = await program.methods
      .fundHouse(new BN(amount.toString()))
      .accountsPartial({ funder: this.admin.publicKey, config: this.config, mint: this.mint.publicKey, vault: this.vault, funderToken: this.ata(this.admin.publicKey) })
      .instruction();
    return this.send([ix], [this.admin]);
  }

  async openPlayer(seed: string, player = this.player.publicKey) {
    const ix = await program.methods
      .openPlayer(sha256(seed))
      .accountsPartial({ house: this.house.publicKey, config: this.config, player, playerState: playerPda(player) })
      .instruction();
    return this.send([ix], [this.house]);
  }

  async commitSeed(seed: string, signer = this.house) {
    const ix = await program.methods
      .commitSeed(sha256(seed))
      .accountsPartial({ house: signer.publicKey, config: this.config, playerState: playerPda(this.player.publicKey) })
      .instruction();
    return this.send([ix], [signer]);
  }

  async placeBet(opts: { amount: bigint; target: number; direction: "under" | "over"; clientSeed: string; expected?: number[] }) {
    const expected = opts.expected ?? fromHex(this.playerState()!.commitment);
    const p = this.player.publicKey;
    const ix = await program.methods
      .placeBet(new BN(opts.amount.toString()), opts.target, toAnchorDirection(opts.direction), opts.clientSeed, expected)
      .accountsPartial({ player: p, config: this.config, playerState: playerPda(p), mint: this.mint.publicKey, vault: this.vault, playerToken: this.ata(p) })
      .instruction();
    return this.send([ix], [this.player]);
  }

  async settle(serverSeed: string, nextSeed: string, signer = this.house, withPlayerToken = true) {
    const p = this.player.publicKey;
    const ix = await program.methods
      .settleBet(serverSeed, sha256(nextSeed))
      .accountsPartial({ house: signer.publicKey, config: this.config, playerState: playerPda(p), mint: this.mint.publicKey, vault: this.vault, playerToken: withPlayerToken ? this.ata(p) : null })
      .instruction();
    return this.send([ix], [signer]);
  }

  async claimExpired() {
    const p = this.player.publicKey;
    const ix = await program.methods
      .claimExpired()
      .accountsPartial({ player: p, config: this.config, playerState: playerPda(p), mint: this.mint.publicKey, vault: this.vault, playerToken: this.ata(p) })
      .instruction();
    return this.send([ix], [this.player]);
  }

  async defund(amount: bigint) {
    const ix = await program.methods
      .defundHouse(new BN(amount.toString()))
      .accountsPartial({ admin: this.admin.publicKey, config: this.config, mint: this.mint.publicKey, vault: this.vault, to: this.ata(this.admin.publicKey) })
      .instruction();
    return this.send([ix], [this.admin]);
  }

  warp(seconds: number) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + BigInt(seconds)));
  }
}

async function ready(): Promise<Env> {
  const env = new Env();
  await env.createMintAndFund();
  await env.initialize();
  await env.fundHouse();
  return env;
}

const expectFail = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toThrow(code);
};

describe("initialize", () => {
  it("only the program upgrade authority can initialize", async () => {
    const env = new Env();
    await env.createMintAndFund();
    const intruder = Keypair.generate();
    env.svm.airdrop(intruder.publicKey, 10n ** 9n);
    await expectFail(env.initialize(intruder), "Unauthorized");
    await env.initialize();
    const cfg = env.configAccount();
    expect(cfg.admin.equals(env.admin.publicKey)).toBe(true);
    expect(cfg.house.equals(env.house.publicKey)).toBe(true);
    expect(cfg.houseEdgeBps).toBe(100);
  });
});

describe("betting round", () => {
  it("reproduces the packages/fair fixed vectors on-chain (nonce 0 → 7338)", async () => {
    const env = await ready();
    await env.openPlayer("hashroll-test-server-seed");
    await env.placeBet({ amount: HROLL_UNIT, target: 5000, direction: "under", clientSeed: "player-seed" });
    const meta = await env.settle("hashroll-test-server-seed", seedFor("next"));
    const [entry] = eventsToHistory("sig", null, meta.logs(), env.player.publicKey);
    expect(entry.roll).toBe(7338);
    expect(entry.roll).toBe(computeRoll("hashroll-test-server-seed", "player-seed", 0));
    expect(entry.win).toBe(false);
  });

  it("escrows, settles, pays exactly like packages/fair and rotates the commitment", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    const seeds = Array.from({ length: 6 }, (_, i) => seedFor(`seed-${i}`));
    await env.openPlayer(seeds[0]);

    let balance = env.balance(env.ata(p));
    for (let nonce = 0; nonce < 5; nonce++) {
      const amount = 10n * HROLL_UNIT;
      const direction = nonce % 2 ? "over" : "under";
      await env.placeBet({ amount, target: 4950, direction, clientSeed: `client-${nonce}` });
      const pending = env.playerState()!;
      expect(pending.pending).toBe(true);
      expect(env.balance(env.ata(p))).toBe(balance - amount);
      expect(BigInt(env.configAccount().reserved.toString())).toBe(payoutFor(amount, 4950, 100));

      const meta = await env.settle(seeds[nonce], seeds[nonce + 1]);
      const [entry] = eventsToHistory("sig", null, meta.logs(), p);
      const roll = computeRoll(seeds[nonce], `client-${nonce}`, nonce);
      const win = direction === "under" ? roll < 4950 : roll >= 10_000 - 4950;
      expect(entry).toMatchObject({ kind: "settled", nonce, roll, win, serverSeed: seeds[nonce], clientSeed: `client-${nonce}` });
      expect(entry.payout).toBe(win ? payoutFor(amount, 4950, 100) : 0n);

      balance = balance - amount + entry.payout;
      expect(env.balance(env.ata(p))).toBe(balance);
      const after = env.playerState()!;
      expect(after).toMatchObject({ pending: false, nonce: nonce + 1, commitment: toHex(sha256(seeds[nonce + 1])) });
      expect(env.configAccount().reserved.toString()).toBe("0");
    }
  });

  it("rejects a wrong server seed and a non-house settler", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    await env.placeBet({ amount: HROLL_UNIT, target: 5000, direction: "under", clientSeed: "c" });
    await expectFail(env.settle(seedFor("b"), seedFor("n")), "BadServerSeed");
    const intruder = Keypair.generate();
    env.svm.airdrop(intruder.publicKey, 10n ** 9n);
    await expectFail(env.settle(seedFor("a"), seedFor("n"), intruder), "Unauthorized");
    await env.settle(seedFor("a"), seedFor("n"));
  });

  it("locks the commitment while a bet is pending and validates inputs", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    const base = { amount: HROLL_UNIT, target: 5000, direction: "under" as const, clientSeed: "c" };
    await expectFail(env.placeBet({ ...base, expected: sha256("other") }), "CommitmentMismatch");
    await expectFail(env.placeBet({ ...base, target: 9900 }), "InvalidTarget");
    await expectFail(env.placeBet({ ...base, clientSeed: "a:b" }), "InvalidClientSeed");
    await expectFail(env.placeBet({ ...base, amount: 0n }), "ZeroAmount");
    await env.placeBet(base);
    await expectFail(env.placeBet({ ...base, clientSeed: "d" }), "BetPending");
    await expectFail(env.commitSeed(seedFor("swap")), "BetPending");
  });

  it("caps the profit per bet at max_payout_bps of the free bankroll", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    // 1% of 1,000,000 = 10,000 HROLL of max profit; 1% chance pays 99x, so 200 HROLL → 19,600 profit.
    await expectFail(env.placeBet({ amount: 200n * HROLL_UNIT, target: 100, direction: "under", clientSeed: "c" }), "ProfitTooHigh");
    await env.placeBet({ amount: 100n * HROLL_UNIT, target: 100, direction: "under", clientSeed: "c" });
  });
});

describe("blocking the reveal", () => {
  it("a player who closes their token account cannot stop a losing bet from settling", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    // Fixed vector: nonce 0 rolls 73.38, so "under 50.00" loses.
    await env.openPlayer("hashroll-test-server-seed");
    await env.placeBet({ amount: HROLL_UNIT, target: 5000, direction: "under", clientSeed: "player-seed" });
    // Empty and close the token account so it no longer exists at settlement time.
    env.send(
      [
        createTransferInstruction(env.ata(p), env.ata(env.admin.publicKey), p, env.balance(env.ata(p))),
        createCloseAccountInstruction(env.ata(p), p, p),
      ],
      [env.player],
    );
    expect(env.svm.getAccount(env.ata(p))?.lamports ?? 0).toBe(0);
    await env.settle("hashroll-test-server-seed", seedFor("next"), env.house, false);
    expect(env.playerState()).toMatchObject({ pending: false, nonce: 1 });
    expect(env.configAccount().reserved.toString()).toBe("0");
  });

  it("a win still needs the token account to be paid", async () => {
    const env = await ready();
    await env.openPlayer("hashroll-test-server-seed");
    // Same roll (73.38) wins "over 50.00".
    await env.placeBet({ amount: HROLL_UNIT, target: 5000, direction: "over", clientSeed: "player-seed" });
    await expectFail(env.settle("hashroll-test-server-seed", seedFor("next"), env.house, false), "MissingPlayerToken");
    await env.settle("hashroll-test-server-seed", seedFor("next"));
  });
});

describe("timeout", () => {
  it("pays the full potential payout when the house does not settle in time", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    await env.openPlayer(seedFor("a"));
    const amount = 10n * HROLL_UNIT;
    const before = env.balance(env.ata(p));
    await env.placeBet({ amount, target: 5000, direction: "under", clientSeed: "c" });
    await expectFail(env.claimExpired(), "NotExpired");

    env.warp(61);
    const meta = await env.claimExpired();
    const potential = payoutFor(amount, 5000, 100);
    expect(env.balance(env.ata(p))).toBe(before - amount + potential);
    const [entry] = eventsToHistory("sig", null, meta.logs(), p);
    expect(entry).toMatchObject({ kind: "expired", nonce: 0, payout: potential });

    // The unrevealed commitment is cleared: no bets until the house commits again.
    expect(env.playerState()).toMatchObject({ nonce: 1, pending: false, commitment: "0".repeat(64) });
    await expectFail(env.placeBet({ amount, target: 5000, direction: "under", clientSeed: "c" }), "NoCommitment");
    await env.commitSeed(seedFor("b"));
    await env.placeBet({ amount, target: 5000, direction: "under", clientSeed: "c" });
    await env.settle(seedFor("b"), seedFor("c"));
    expect(env.configAccount().reserved.toString()).toBe("0");
  });
});

describe("bankroll", () => {
  it("the admin cannot withdraw funds reserved for pending bets", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    await env.placeBet({ amount: 100n * HROLL_UNIT, target: 100, direction: "under", clientSeed: "c" });
    const reserved = BigInt(env.configAccount().reserved.toString());
    const vault = env.balance(env.vault);
    await expectFail(env.defund(vault - reserved + 1n), "InsufficientBankroll");
    await env.defund(vault - reserved);
    expect(env.balance(env.vault)).toBe(reserved);
    await env.settle(seedFor("a"), seedFor("b")); // still payable
  });
});
