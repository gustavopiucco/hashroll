/**
 * Hashroll — Provably Fair (isomorphic: runs identically on the server and in the browser).
 *
 * Specification (do NOT change without versioning — players depend on it to audit):
 *
 *   commitment = SHA256(serverSeed)                       (hex, published BEFORE betting)
 *   digest     = HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`)
 *   n          = first 4 bytes of digest as big-endian uint32
 *   roll       = floor(n * 10000 / 2^32)                  -> integer 0..9999 (displayed as 00.00–99.99)
 *
 * The ":" separates clientSeed and nonce to avoid ambiguity ("ab"+"12" vs "a"+"b12").
 * clientSeed cannot contain ":" (validated below).
 *
 * Every game reads its outcome from the same digest (one server seed per bet):
 *   Dice      roll   = floor(n * 10000 / 2^32)                    n = digest[0..4] as big-endian uint32
 *   Roulette  number = floor(n * 37 / 2^32)                       0..36 (European wheel)
 *   Plinko    row i goes right iff bit i of the digest is 1       bits read MSB-first: byte i/8, bit 7 - i%8
 *             slot = number of right bounces (0..rows)
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const ROLL_RANGE = 10_000; // roll ∈ [0, 9999]
export const BPS = 10_000n;

export function generateSeed(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export function hashServerSeed(serverSeed: string): string {
  return bytesToHex(sha256(utf8ToBytes(serverSeed)));
}

export function verifyCommitment(serverSeed: string, commitment: string): boolean {
  return hashServerSeed(serverSeed) === commitment.toLowerCase();
}

export function computeDigest(serverSeed: string, clientSeed: string, nonce: number): string {
  if (clientSeed.includes(":")) throw new Error("clientSeed cannot contain ':'");
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error("invalid nonce");
  return bytesToHex(hmac(sha256, utf8ToBytes(serverSeed), utf8ToBytes(`${clientSeed}:${nonce}`)));
}

export function digestToRoll(digestHex: string): number {
  const n = parseInt(digestHex.slice(0, 8), 16); // uint32
  return Math.floor((n * ROLL_RANGE) / 2 ** 32);
}

export function computeRoll(serverSeed: string, clientSeed: string, nonce: number): number {
  return digestToRoll(computeDigest(serverSeed, clientSeed, nonce));
}

/* ------------------------------- Dice ------------------------------- */

export type Direction = "under" | "over";

export interface DiceBet {
  amount: bigint;      // in token base units (HROLL has 9 decimals; no floats!)
  target: number;      // number of winning outcomes, 1..9800 (chance = target/10000)
  direction: Direction;
}

export const MIN_TARGET = 100;   // 1% chance
export const MAX_TARGET = 9_800; // 98% chance

/** under: wins if roll < target | over: wins if roll >= 10000 - target */
export function isWin(roll: number, target: number, direction: Direction): boolean {
  return direction === "under" ? roll < target : roll >= ROLL_RANGE - target;
}

/** gross payout on a win = amount * (1 - edge) / chance = amount * (10000 - edgeBps) / target */
export function payoutFor(amount: bigint, target: number, houseEdgeBps: number): bigint {
  if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) {
    throw new Error(`target must be between ${MIN_TARGET} and ${MAX_TARGET}`);
  }
  return (amount * (BPS - BigInt(houseEdgeBps))) / BigInt(target);
}

export interface DiceResult {
  roll: number;
  win: boolean;
  payout: bigint; // 0n on a loss
  digest: string;
}

export function resolveDice(
  bet: DiceBet,
  seeds: { serverSeed: string; clientSeed: string; nonce: number },
  houseEdgeBps = 100,
): DiceResult {
  const digest = computeDigest(seeds.serverSeed, seeds.clientSeed, seeds.nonce);
  const roll = digestToRoll(digest);
  const win = isWin(roll, bet.target, bet.direction);
  return { roll, win, payout: win ? payoutFor(bet.amount, bet.target, houseEdgeBps) : 0n, digest };
}

/* ------------------------------- Plinko ------------------------------ */

export type PlinkoRisk = "low" | "medium" | "high";
export const PLINKO_RISKS: readonly PlinkoRisk[] = ["low", "medium", "high"];
export const PLINKO_ROWS = [8, 12, 16] as const;

/**
 * Multipliers in basis points (10000 = 1x), indexed by slot. The house edge is built into the tables
 * (RTP between 98.75% and 98.97%, checked exactly in the tests); `houseEdgeBps` does not apply.
 * The on-chain program has an identical copy (solana/programs/hashroll/src/fair.rs).
 */
export const PLINKO_TABLES: Record<number, Record<PlinkoRisk, readonly number[]>> = {
  8: {
    low: [56000, 27100, 13800, 7700, 5000, 7700, 13800, 27100, 56000],
    medium: [130000, 37100, 13100, 5900, 4000, 5900, 13100, 37100, 130000],
    high: [290000, 49200, 11100, 3600, 2000, 3600, 11100, 49200, 290000],
  },
  12: {
    low: [100000, 55500, 31500, 18400, 11100, 7000, 5000, 7000, 11100, 18400, 31500, 55500, 100000],
    medium: [330000, 127000, 51500, 21900, 9900, 4900, 3000, 4900, 9900, 21900, 51500, 127000, 330000],
    high: [1700000, 308000, 67900, 18400, 6300, 2900, 2000, 2900, 6300, 18400, 67900, 308000, 1700000],
  },
  16: {
    low: [160000, 96800, 59300, 36800, 23200, 14900, 9800, 6700, 5000, 6700, 9800, 14900, 23200, 36800, 59300, 96800, 160000],
    medium: [1100000, 424000, 171000, 72200, 32100, 15200, 7700, 4300, 3000, 4300, 7700, 15200, 32100, 72200, 171000, 424000, 1100000],
    high: [10000000, 1840000, 397000, 100000, 29800, 10700, 4700, 2600, 2000, 2600, 4700, 10700, 29800, 100000, 397000, 1840000, 10000000],
  },
};

export function plinkoTable(rows: number, risk: PlinkoRisk): readonly number[] {
  const t = PLINKO_TABLES[rows]?.[risk];
  if (!t) throw new Error(`rows must be one of ${PLINKO_ROWS.join(", ")}`);
  return t;
}

/** Direction of each row (0 = left, 1 = right), read MSB-first from the digest. */
export function digestToPlinkoPath(digestHex: string, rows: number): number[] {
  const path: number[] = [];
  for (let i = 0; i < rows; i++) {
    const byte = parseInt(digestHex.slice((i >> 3) * 2, (i >> 3) * 2 + 2), 16);
    path.push((byte >> (7 - (i & 7))) & 1);
  }
  return path;
}

/** On-chain encoding of a path (event `outcome`): bit i = direction of row i. */
export const encodePlinkoPath = (path: number[]) => path.reduce((acc, bit, i) => acc | (bit << i), 0);
export const decodePlinkoPath = (bits: number, rows: number) => Array.from({ length: rows }, (_, i) => (bits >> i) & 1);
export const plinkoSlot = (path: number[]) => path.reduce((a, b) => a + b, 0);

export function plinkoPayout(amount: bigint, rows: number, risk: PlinkoRisk, slot: number): bigint {
  return (amount * BigInt(plinkoTable(rows, risk)[slot])) / BPS;
}

export function plinkoMaxPayout(amount: bigint, rows: number, risk: PlinkoRisk): bigint {
  return plinkoPayout(amount, rows, risk, 0); // the edges hold the largest multiplier
}

export function resolvePlinko(
  bet: { amount: bigint; rows: number; risk: PlinkoRisk },
  seeds: { serverSeed: string; clientSeed: string; nonce: number },
) {
  const digest = computeDigest(seeds.serverSeed, seeds.clientSeed, seeds.nonce);
  const path = digestToPlinkoPath(digest, bet.rows);
  const slot = plinkoSlot(path);
  return { path, slot, multiplierBps: plinkoTable(bet.rows, bet.risk)[slot], payout: plinkoPayout(bet.amount, bet.rows, bet.risk, slot), digest };
}

/* ------------------------------ Roulette ----------------------------- */

/**
 * European roulette (single zero). A chip covers any set of numbers, given as a 37-bit mask
 * (bit i = number i), and pays amount * 36 / (numbers covered) when the ball lands on one of them.
 * That reproduces every classic bet (straight 36x, split 18x, street 12x, corner 9x, line 6x,
 * dozen/column 3x, red/black/odd/even/low/high 2x) with a 1/37 = 2.70% edge on all of them.
 * `houseEdgeBps` does not apply.
 */
export const ROULETTE_POCKETS = 37;
export const ROULETTE_MAX_CHIPS = 8;
export const RED_NUMBERS: readonly number[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const ALL_NUMBERS_MASK = (1n << 37n) - 1n;

export interface RouletteChip {
  mask: bigint;
  amount: bigint;
}

export function digestToRouletteNumber(digestHex: string): number {
  const n = parseInt(digestHex.slice(0, 8), 16);
  return Math.floor((n * ROULETTE_POCKETS) / 2 ** 32);
}

export const maskOf = (numbers: Iterable<number>) => {
  let m = 0n;
  for (const x of numbers) {
    if (!Number.isInteger(x) || x < 0 || x > 36) throw new Error(`invalid roulette number ${x}`);
    m |= 1n << BigInt(x);
  }
  return m;
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const rouletteMasks = {
  straight: (n: number) => maskOf([n]),
  red: () => maskOf(RED_NUMBERS),
  black: () => maskOf(range(1, 36).filter((x) => !RED_NUMBERS.includes(x))),
  odd: () => maskOf(range(1, 36).filter((x) => x % 2 === 1)),
  even: () => maskOf(range(1, 36).filter((x) => x % 2 === 0)),
  low: () => maskOf(range(1, 18)),
  high: () => maskOf(range(19, 36)),
  /** i = 0, 1, 2 → 1–12, 13–24, 25–36 */
  dozen: (i: number) => maskOf(range(i * 12 + 1, i * 12 + 12)),
  /** i = 0, 1, 2 → the column starting with 1, 2, 3 */
  column: (i: number) => maskOf(range(1, 36).filter((x) => x % 3 === (i + 1) % 3)),
};

export function popcount(mask: bigint): number {
  let c = 0;
  for (let m = mask; m > 0n; m >>= 1n) c += Number(m & 1n);
  return c;
}

export function isValidRouletteChip(chip: RouletteChip): boolean {
  const k = popcount(chip.mask);
  return chip.amount > 0n && chip.mask > 0n && (chip.mask & ~ALL_NUMBERS_MASK) === 0n && k <= 36;
}

export function chipPayout(chip: RouletteChip, number: number): bigint {
  return (chip.mask >> BigInt(number)) & 1n ? (chip.amount * 36n) / BigInt(popcount(chip.mask)) : 0n;
}

export const roulettePayout = (chips: RouletteChip[], number: number) => chips.reduce((sum, c) => sum + chipPayout(c, number), 0n);

/** Largest total payout over the 37 numbers: what the program reserves for the bet. */
export function rouletteMaxPayout(chips: RouletteChip[]): bigint {
  let max = 0n;
  for (let n = 0; n < ROULETTE_POCKETS; n++) {
    const p = roulettePayout(chips, n);
    if (p > max) max = p;
  }
  return max;
}

export function resolveRoulette(chips: RouletteChip[], seeds: { serverSeed: string; clientSeed: string; nonce: number }) {
  const digest = computeDigest(seeds.serverSeed, seeds.clientSeed, seeds.nonce);
  const number = digestToRouletteNumber(digest);
  return { number, payout: roulettePayout(chips, number), digest };
}

export const rouletteColor = (n: number): "green" | "red" | "black" => (n === 0 ? "green" : RED_NUMBERS.includes(n) ? "red" : "black");
