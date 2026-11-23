import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { computeDigest, computeRoll, hashServerSeed, isWin, payoutFor, resolveDice, verifyCommitment } from "./index.js";

const SERVER = "hashroll-test-server-seed";
const CLIENT = "player-seed";

test("commitment matches node:crypto (independent reference)", () => {
  const ref = createHash("sha256").update(SERVER).digest("hex");
  assert.equal(hashServerSeed(SERVER), ref);
  assert.ok(verifyCommitment(SERVER, ref.toUpperCase()));
  assert.ok(!verifyCommitment("other", ref));
});

test("digest matches node:crypto HMAC", () => {
  for (let nonce = 0; nonce < 50; nonce++) {
    const ref = createHmac("sha256", SERVER).update(`${CLIENT}:${nonce}`).digest("hex");
    assert.equal(computeDigest(SERVER, CLIENT, nonce), ref);
  }
});

test("fixed vectors (specification regression)", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => computeRoll(SERVER, CLIENT, n)), VECTORS);
});

test("rolls stay in [0, 9999] with ~uniform distribution", () => {
  let under5000 = 0;
  const N = 20_000;
  for (let i = 0; i < N; i++) {
    const r = computeRoll(SERVER, CLIENT, i);
    assert.ok(r >= 0 && r <= 9999);
    if (r < 5000) under5000++;
  }
  assert.ok(Math.abs(under5000 / N - 0.5) < 0.02);
});

test("clientSeed containing ':' is rejected", () => {
  assert.throws(() => computeDigest(SERVER, "a:b", 1));
});

test("win rules and payout (bigint)", () => {
  assert.ok(isWin(4999, 5000, "under") && !isWin(5000, 5000, "under"));
  assert.ok(isWin(5000, 5000, "over") && !isWin(4999, 5000, "over"));
  // 50% chance, 1% edge => 1.98x
  assert.equal(payoutFor(10n ** 18n, 5000, 100), 198n * 10n ** 16n);
  assert.throws(() => payoutFor(1n, 50, 100));
  const r = resolveDice({ amount: 1000n, target: 5000, direction: "under" }, { serverSeed: SERVER, clientSeed: CLIENT, nonce: 0 });
  assert.equal(r.payout, r.win ? 1980n : 0n);
});

// Fixed vectors: if they change, the specification changed (breaks old audits!)
const VECTORS = [7338, 7101, 4624, 3298, 7864];

/* ------------------------------------------------------- Plinko & Roulette */

import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  PLINKO_TABLES,
  chipPayout,
  decodePlinkoPath,
  digestToPlinkoPath,
  encodePlinkoPath,
  resolvePlinko,
  resolveRoulette,
  rouletteMasks,
  rouletteMaxPayout,
  popcount,
} from "./index.js";

const binom = (n: number, k: number) => {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
};

test("plinko tables: symmetric, exact RTP between 98.5% and 99%", () => {
  for (const rows of PLINKO_ROWS) {
    for (const risk of PLINKO_RISKS) {
      const t = PLINKO_TABLES[rows][risk];
      assert.equal(t.length, rows + 1);
      assert.deepEqual([...t].reverse(), [...t]);
      // RTP = Σ C(rows, k) * mult_k / 2^rows, computed exactly in basis points.
      const num = t.reduce((s, m, k) => s + binom(rows, k) * BigInt(m), 0n);
      const den = 2n ** BigInt(rows) * 10_000n;
      assert.ok(num * 1000n < den * 990n, `${rows}/${risk} RTP must be < 99%`);
      assert.ok(num * 1000n >= den * 985n, `${rows}/${risk} RTP must be >= 98.5%`);
    }
  }
});

test("plinko path bits and encoding", () => {
  const digest = "a5" + "00".repeat(31); // 1010 0101
  assert.deepEqual(digestToPlinkoPath(digest, 8), [1, 0, 1, 0, 0, 1, 0, 1]);
  const p = [1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1];
  assert.deepEqual(decodePlinkoPath(encodePlinkoPath(p), 12), p);
});

test("roulette masks reproduce the classic payouts", () => {
  const chip = (mask: bigint) => ({ mask, amount: 100n });
  assert.equal(chipPayout(chip(rouletteMasks.straight(17)), 17), 3600n);
  assert.equal(chipPayout(chip(rouletteMasks.red()), 1), 200n);
  assert.equal(chipPayout(chip(rouletteMasks.red()), 0), 0n);
  assert.equal(chipPayout(chip(rouletteMasks.dozen(2)), 36), 300n);
  assert.equal(chipPayout(chip(rouletteMasks.column(0)), 34), 300n);
  assert.equal(popcount(rouletteMasks.black()), 18);
  assert.equal(rouletteMasks.red() & rouletteMasks.black(), 0n);
  // Red and black together: at most one of them wins, so the max payout is 2x one chip.
  assert.equal(rouletteMaxPayout([chip(rouletteMasks.red()), chip(rouletteMasks.black())]), 200n);
});

test("fixed vectors for plinko and roulette (specification regression)", () => {
  const seeds = (nonce: number) => ({ serverSeed: SERVER, clientSeed: CLIENT, nonce });
  const roulette = [0, 1, 2, 3, 4].map((n) => resolveRoulette([], seeds(n)).number);
  const plinko = [0, 1, 2, 3, 4].map((n) => encodePlinkoPath(resolvePlinko({ amount: 1n, rows: 16, risk: "high" }, seeds(n)).path));
  assert.deepEqual(roulette, ROULETTE_VECTORS);
  assert.deepEqual(plinko, PLINKO16_VECTORS);
});

// Fixed vectors (same seeds as above). Replayed by solana/programs/hashroll/src/fair.rs.
const ROULETTE_VECTORS = [27, 26, 17, 12, 29];
const PLINKO16_VECTORS = [56285, 62381, 42606, 36394, 51859]; // encoded paths, 16 rows

test("plinko path matches the bits of node:crypto HMAC", () => {
  for (let nonce = 0; nonce < 20; nonce++) {
    const d = createHmac("sha256", SERVER).update(`${CLIENT}:${nonce}`).digest();
    const bits = ((d[0] << 8) | d[1]).toString(2).padStart(16, "0").split("").map(Number);
    assert.deepEqual(resolvePlinko({ amount: 1n, rows: 16, risk: "low" }, { serverSeed: SERVER, clientSeed: CLIENT, nonce }).path, bits);
  }
});

/* ------------------------------------------------------------------ Slots */

import {
  SLOT_CELLS,
  SLOT_LINE_PAYS,
  SLOT_MAX_MULTIPLIER,
  SLOT_SYMBOLS,
  SLOT_WEIGHTS,
  decodeSlotGrid,
  digestToSlotGrid,
  encodeSlotGrid,
  resolveSlots,
  slotMaxPayout,
  slotPayout,
  slotSymbol,
  slotWins,
} from "./index.js";

test("slots: every byte maps to a symbol with the published weights", () => {
  assert.equal(SLOT_WEIGHTS.reduce((a, b) => a + b, 0), 256);
  assert.equal(SLOT_WEIGHTS.length, SLOT_SYMBOLS.length);
  assert.equal(SLOT_LINE_PAYS.length, SLOT_SYMBOLS.length);
  const seen = SLOT_SYMBOLS.map(() => 0);
  for (let b = 0; b < 256; b++) seen[slotSymbol(b)]++;
  assert.deepEqual(seen, [...SLOT_WEIGHTS]);
  assert.deepEqual(digestToSlotGrid("00" + "14" + "15" + "ff".repeat(29)), [0, 0, 1, 6, 6, 6, 6, 6, 6]);
  const grid = [0, 1, 2, 3, 4, 5, 6, 0, 3];
  assert.deepEqual(decodeSlotGrid(encodeSlotGrid(grid)), grid);
});

test("slots: lines, wilds and the full-board multiplier", () => {
  const W = 0, SEVEN = 1, GEM = 2, CHERRY = 5, LEMON = 6;
  // No line: nothing pays.
  assert.equal(slotWins([SEVEN, GEM, CHERRY, GEM, CHERRY, SEVEN, SEVEN, CHERRY, GEM]).units, 0);
  // Top row of sevens only.
  const top = slotWins([SEVEN, SEVEN, SEVEN, GEM, CHERRY, LEMON, LEMON, GEM, CHERRY]);
  assert.deepEqual(top.lines, [{ line: 0, symbol: SEVEN, pay: 50 }]);
  assert.equal(top.fullBoard, false);
  assert.equal(slotPayout(1000n, [SEVEN, SEVEN, SEVEN, GEM, CHERRY, LEMON, LEMON, GEM, CHERRY]), 10_000n);
  // A wild in the centre completes the middle row and both diagonals.
  const mid = slotWins([GEM, LEMON, CHERRY, SEVEN, W, SEVEN, CHERRY, SEVEN, GEM]);
  assert.deepEqual(mid.lines.map((l) => [l.line, l.symbol]), [[1, SEVEN], [3, GEM], [4, CHERRY]]);
  assert.equal(mid.units, 50 + 25 + 5);
  // Full board of lemons with two wilds: 5 lines x 3, times 10.
  const full = slotWins([LEMON, W, LEMON, LEMON, LEMON, LEMON, W, LEMON, LEMON]);
  assert.ok(full.fullBoard);
  assert.equal(full.units, 150);
  // Nine wilds: the 1000x maximum.
  assert.equal(slotPayout(7n, Array(9).fill(W)), slotMaxPayout(7n));
  // The payout is floored once, on the total.
  assert.equal(slotPayout(3n, [LEMON, LEMON, LEMON, GEM, CHERRY, SEVEN, CHERRY, SEVEN, GEM]), 1n);
});

test("slots: exact RTP over all 7^9 boards, and no board beats the reserved maximum", () => {
  // Σ weight(board) * units(board), exactly; RTP = total / (5 * 256^9).
  let total = 0n;
  let hits = 0n;
  let maxUnits = 0;
  const grid = Array(SLOT_CELLS).fill(0);
  const walk = (i: number, weight: bigint) => {
    if (i === SLOT_CELLS) {
      const { units } = slotWins(grid);
      if (units > maxUnits) maxUnits = units;
      if (units > 0) hits += weight;
      total += weight * BigInt(units);
      return;
    }
    for (let s = 0; s < SLOT_WEIGHTS.length; s++) {
      grid[i] = s;
      walk(i + 1, weight * BigInt(SLOT_WEIGHTS[s]));
    }
  };
  walk(0, 1n);
  const den = 5n * 256n ** 9n;
  assert.equal(BigInt(maxUnits), SLOT_MAX_MULTIPLIER * 5n);
  assert.equal(total, SLOTS_RTP_NUMERATOR);
  assert.ok(total * 1000n >= den * 965n && total * 1000n < den * 970n, "RTP must be in [96.5%, 97%)");
  // About one spin in three pays something.
  assert.ok(hits * 100n > 256n ** 9n * 30n && hits * 100n < 256n ** 9n * 35n);
});

test("fixed vectors for slots (specification regression)", () => {
  const spins = [0, 1, 2, 3, 4].map((nonce) => resolveSlots({ amount: 5n }, { serverSeed: SERVER, clientSeed: CLIENT, nonce }));
  assert.deepEqual(spins.map((s) => encodeSlotGrid(s.grid)), SLOTS_VECTORS);
  assert.deepEqual(spins.map((s) => Number(s.payout)), SLOTS_UNITS);
});

// Fixed vectors (same seeds as above). Replayed by solana/programs/hashroll/src/fair.rs.
const SLOTS_VECTORS = [68297653, 103568757, 113684572, 92345059, 57431838]; // encoded grids
const SLOTS_UNITS = [10, 0, 0, 0, 15]; // total line bets won (the payout of a 5-unit stake)
/** Σ weight * units over every board; the Rust tests derive the same number from the closed form. */
const SLOTS_RTP_NUMERATOR = 22832364483877821225600n; // 96.6988%
