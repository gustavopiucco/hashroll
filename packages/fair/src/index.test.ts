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
