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
import {
  computeRoll,
  payoutFor,
  plinkoMaxPayout,
  resolvePlinko,
  resolveRoulette,
  resolveSlots,
  rouletteMasks,
  rouletteMaxPayout,
  encodePlinkoPath,
  encodeSlotGrid,
  slotMaxPayout,
} from "@hashroll/fair";
import {
  BN,
  BPF_LOADER_UPGRADEABLE_ID,
  HROLL_UNIT,
  PROGRAM_ID,
  configPda,
  eventsToHistory,
  playerAccounts,
  placeBetInstruction,
  playerPda,
  readOnlyProgram,
  toHex,
  type BetInput,
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

  async placeBet(opts: { amount: bigint; target: number; direction: "under" | "over"; clientSeed: string; expected?: string }) {
    return this.place({ game: "dice", amount: opts.amount, target: opts.target, direction: opts.direction }, opts.clientSeed, opts.expected);
  }

  async place(bet: BetInput, clientSeed: string, expected = this.playerState()!.commitment) {
    const ix = await placeBetInstruction(program, this.player.publicKey, this.mint.publicKey, bet, clientSeed, expected);
    return this.send([ix], [this.player]);
  }

  async withdrawOwed() {
    const ix = await program.methods.withdrawOwed().accountsPartial(playerAccounts(this.player.publicKey, this.mint.publicKey)).instruction();
    return this.send([ix], [this.player]);
  }

  closePlayerTokenAccount() {
    const p = this.player.publicKey;
    this.send(
      [
        createTransferInstruction(this.ata(p), this.ata(this.admin.publicKey), p, this.balance(this.ata(p))),
        createCloseAccountInstruction(this.ata(p), p, p),
      ],
      [this.player],
    );
    expect(this.svm.getAccount(this.ata(p))?.lamports ?? 0).toBe(0);
  }

  reopenPlayerTokenAccount() {
    const p = this.player.publicKey;
    this.send([createAssociatedTokenAccountIdempotentInstruction(p, this.ata(p), p, this.mint.publicKey)], [this.player]);
  }

  reserved() {
    return BigInt(this.configAccount().reserved.toString());
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
    expect(entry.outcome).toBe(7338);
    expect(entry.outcome).toBe(computeRoll("hashroll-test-server-seed", "player-seed", 0));
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
      expect(entry).toMatchObject({ kind: "settled", nonce, outcome: roll, win, serverSeed: seeds[nonce], clientSeed: `client-${nonce}` });
      expect(entry.bet).toMatchObject({ game: "dice", target: 4950, direction, amount });
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
    await expectFail(env.placeBet({ ...base, expected: toHex(sha256("other")) }), "CommitmentMismatch");
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

describe("plinko", () => {
  it("drops the ball exactly like packages/fair and pays the table multiplier", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    const seeds = Array.from({ length: 7 }, (_, i) => seedFor(`plinko-${i}`));
    await env.openPlayer(seeds[0]);
    const configs = [
      { rows: 8, risk: "low" }, { rows: 12, risk: "medium" }, { rows: 16, risk: "high" },
      { rows: 8, risk: "high" }, { rows: 16, risk: "low" }, { rows: 12, risk: "high" },
    ] as const;
    for (const [nonce, c] of configs.entries()) {
      const amount = 2n * HROLL_UNIT;
      const before = env.balance(env.ata(p));
      await env.place({ game: "plinko", amount, ...c }, `c${nonce}`);
      expect(env.reserved()).toBe(plinkoMaxPayout(amount, c.rows, c.risk));
      const meta = await env.settle(seeds[nonce], seeds[nonce + 1]);
      const [entry] = eventsToHistory("sig", null, meta.logs(), p);
      const ref = resolvePlinko({ amount, ...c }, { serverSeed: seeds[nonce], clientSeed: `c${nonce}`, nonce });
      expect(entry.outcome).toBe(encodePlinkoPath(ref.path));
      expect(entry.payout).toBe(ref.payout);
      expect(entry.bet).toMatchObject({ game: "plinko", rows: c.rows, risk: c.risk, amount });
      expect(env.balance(env.ata(p))).toBe(before - amount + ref.payout);
      expect(env.reserved()).toBe(0n);
    }
  });

  it("rejects unsupported rows and caps the 1000x edge by the bankroll limit", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    await expectFail(env.place({ game: "plinko", amount: HROLL_UNIT, rows: 10, risk: "low" }, "c"), "InvalidPlinko");
    // 16 rows high risk pays up to 1000x; max profit is 10,000 HROLL, so 11 HROLL is too much.
    await expectFail(env.place({ game: "plinko", amount: 11n * HROLL_UNIT, rows: 16, risk: "high" }, "c"), "ProfitTooHigh");
    await env.place({ game: "plinko", amount: 10n * HROLL_UNIT, rows: 16, risk: "high" }, "c");
  });
});

describe("roulette", () => {
  it("spins exactly like packages/fair and pays every winning chip", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    // Fixed vector: nonce 0 lands on 27 (red, odd, high, third dozen, third column).
    await env.openPlayer("hashroll-test-server-seed");
    const u = HROLL_UNIT;
    const chips = [
      { mask: rouletteMasks.straight(27), amount: 1n * u },
      { mask: rouletteMasks.red(), amount: 2n * u },
      { mask: rouletteMasks.black(), amount: 2n * u },
      { mask: rouletteMasks.dozen(2), amount: 3n * u },
      { mask: rouletteMasks.straight(0), amount: 1n * u },
    ];
    const before = env.balance(env.ata(p));
    await env.place({ game: "roulette", chips }, "player-seed");
    expect(env.balance(env.ata(p))).toBe(before - 9n * u);
    expect(env.reserved()).toBe(rouletteMaxPayout(chips));
    const meta = await env.settle("hashroll-test-server-seed", seedFor("next"));
    const [entry] = eventsToHistory("sig", null, meta.logs(), p);
    const ref = resolveRoulette(chips, { serverSeed: "hashroll-test-server-seed", clientSeed: "player-seed", nonce: 0 });
    expect(ref.number).toBe(27);
    expect(entry.outcome).toBe(27);
    // straight 27 (36) + red (4) + dozen 3 (9) = 49 HROLL
    expect(ref.payout).toBe(49n * u);
    expect(entry.payout).toBe(ref.payout);
    expect(entry.bet?.chips).toEqual(chips);
    expect(env.balance(env.ata(p))).toBe(before - 9n * u + 49n * u);
    expect(env.reserved()).toBe(0n);
  });

  it("validates the chips", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    const chip = { mask: rouletteMasks.red(), amount: HROLL_UNIT };
    await expectFail(env.place({ game: "roulette", chips: [] }, "c"), "InvalidRouletteBet");
    await expectFail(env.place({ game: "roulette", chips: Array(9).fill(chip) }, "c"), "InvalidRouletteBet");
    await expectFail(env.place({ game: "roulette", chips: [{ ...chip, mask: 1n << 37n }] }, "c"), "InvalidRouletteBet");
    await expectFail(env.place({ game: "roulette", chips: [{ ...chip, mask: (1n << 37n) - 1n }] }, "c"), "InvalidRouletteBet");
    await expectFail(env.place({ game: "roulette", chips: [{ ...chip, amount: 0n }] }, "c"), "InvalidRouletteBet");
    await env.place({ game: "roulette", chips: Array(8).fill(chip) }, "c");
  });
});

describe("slots", () => {
  it("spins exactly like packages/fair and pays the line wins", async () => {
    const env = await ready();
    const p = env.player.publicKey;
    const server = "hashroll-test-server-seed";
    await env.openPlayer(server);
    const amount = 2n * HROLL_UNIT;
    let wins = 0;
    // The first rounds replay the fixed vectors: the house reuses the same seed for every nonce here.
    for (let nonce = 0; nonce < 10; nonce++) {
      const before = env.balance(env.ata(p));
      await env.place({ game: "slots", amount }, "player-seed");
      expect(env.playerState()!.bet).toMatchObject({ game: "slots", amount, maxPayout: slotMaxPayout(amount) });
      expect(env.reserved()).toBe(slotMaxPayout(amount));
      const meta = await env.settle(server, server);
      const [entry] = eventsToHistory("sig", null, meta.logs(), p);
      const ref = resolveSlots({ amount }, { serverSeed: server, clientSeed: "player-seed", nonce });
      expect(entry.outcome).toBe(encodeSlotGrid(ref.grid));
      expect(entry.payout).toBe(ref.payout);
      expect(entry.win).toBe(ref.payout > amount);
      expect(entry.bet).toMatchObject({ game: "slots", amount });
      expect(env.balance(env.ata(p))).toBe(before - amount + ref.payout);
      expect(env.reserved()).toBe(0n);
      if (nonce === 0) expect(ref.payout).toBe(4n * HROLL_UNIT); // vector: 10 line bets
      if (ref.payout > 0n) wins++;
    }
    expect(wins).toBe(3); // nonces 0, 4 and 9
  });

  it("caps the 1000x maximum by the bankroll limit and rejects bad amounts", async () => {
    const env = await ready();
    await env.openPlayer(seedFor("a"));
    await expectFail(env.place({ game: "slots", amount: 0n }, "c"), "ZeroAmount");
    await expectFail(env.place({ game: "slots", amount: 2n ** 63n }, "c"), "MathOverflow");
    // Max profit is 10,000 HROLL and a spin can pay 1000x, so 11 HROLL is too much.
    await expectFail(env.place({ game: "slots", amount: 11n * HROLL_UNIT }, "c"), "ProfitTooHigh");
    await env.place({ game: "slots", amount: 10n * HROLL_UNIT }, "c");
  });
});

describe("blocking the reveal", () => {
  // A player who closes their token account must not be able to stop any outcome from settling
  // (and then claim the full payout at the timeout). Every game settles without it.
  const cases: [string, BetInput, string][] = [
    // Fixed vector nonce 0: roll 73.38, roulette 27, plinko path and slots grid of the same digest.
    ["dice loss", { game: "dice", amount: HROLL_UNIT, target: 5000, direction: "under" }, "player-seed"],
    ["dice win", { game: "dice", amount: HROLL_UNIT, target: 5000, direction: "over" }, "player-seed"],
    ["plinko", { game: "plinko", amount: HROLL_UNIT, rows: 16, risk: "low" }, "player-seed"],
    ["slots win", { game: "slots", amount: HROLL_UNIT }, "player-seed"],
    ["roulette win", { game: "roulette", chips: [{ mask: rouletteMasks.red(), amount: HROLL_UNIT }] }, "player-seed"],
  ];
  for (const [name, bet, clientSeed] of cases) {
    it(`${name}: settles with the token account closed and credits the payout to owed`, async () => {
      const env = await ready();
      await env.openPlayer("hashroll-test-server-seed");
      await env.place(bet, clientSeed);
      env.closePlayerTokenAccount();
      const meta = await env.settle("hashroll-test-server-seed", seedFor("next"), env.house, false);
      const [entry] = eventsToHistory("sig", null, meta.logs(), env.player.publicKey);
      const state = env.playerState()!;
      expect(state).toMatchObject({ pending: false, nonce: 1 });
      expect(entry.credited).toBe(entry.payout > 0n);
      expect(state.owed).toBe(entry.payout);
      // Owed funds stay reserved until the player withdraws them.
      expect(env.reserved()).toBe(entry.payout);

      env.reopenPlayerTokenAccount();
      if (entry.payout > 0n) {
        await env.withdrawOwed();
        expect(env.balance(env.ata(env.player.publicKey))).toBe(entry.payout);
        expect(env.playerState()!.owed).toBe(0n);
        expect(env.reserved()).toBe(0n);
      }
      await expectFail(env.withdrawOwed(), "NothingOwed");
    });
  }
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
