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
