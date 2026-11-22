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
