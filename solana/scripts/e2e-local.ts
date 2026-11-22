/**
 * End-to-end smoke test against the local stack (validator + deployed program + running API).
 * Acts as a fresh player: faucet → open account → one bet per game (Dice, Plinko, Roulette) → wait
 * for the house to settle → re-verify every outcome with packages/fair.
 *
 *   npm run e2e:local -w @hashroll/program              # one round per game (API settler running)
 *   npm run e2e:local -w @hashroll/program -- --expire  # timeout path (start the API with SETTLER_ENABLED=false)
 */
import { createHash } from "node:crypto";
import { Connection, Keypair, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  computeRoll,
  encodePlinkoPath,
  payoutFor,
  resolvePlinko,
  resolveRoulette,
  rouletteMasks,
  verifyCommitment,
} from "@hashroll/fair";
import {
  HROLL_UNIT,
  configPda,
  fetchBetHistory,
  fetchPlayer,
  formatHroll,
  placeBetInstruction,
  playerAccounts,
  playerTokenAccount,
  readOnlyProgram,
  type BetInput,
  type BetHistoryEntry,
} from "../client/src/index.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const API = process.env.API_URL ?? "http://localhost:4000";
const expire = process.argv.includes("--expire");

const connection = new Connection(RPC_URL, "confirmed");
const program = readOnlyProgram(connection);
const player = Keypair.generate();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

async function post(path: string) {
  const res = await fetch(`${API}${path}`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body;
}

async function send(ix: TransactionInstruction) {
  const tx = new Transaction().add(ix);
  const latest = await connection.getLatestBlockhash();
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = player.publicKey;
  tx.sign(player);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const res = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  if (res.value.err) throw new Error(`tx failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function tokenBalance(mint: Awaited<ReturnType<typeof getMint>>) {
  return BigInt((await connection.getTokenAccountBalance(playerTokenAccount(mint, player.publicKey))).value.amount);
}

async function getMint() {
  return (await program.account.config.fetch(configPda())).mint;
}

async function main() {
  const p = player.publicKey;
  console.log(`player ${p.toBase58()}`);
  await post(`/players/${p.toBase58()}/dev/faucet`);
  await post(`/players/${p.toBase58()}/open`);
  const mint = await getMint();
  const cfg = await program.account.config.fetch(configPda());
  check((await tokenBalance(mint)) === 1_000n * HROLL_UNIT, "faucet credited 1000 HROLL");

  const accounts = playerAccounts(p, mint);
  const u = HROLL_UNIT;
  const rounds: { bet: BetInput; stake: bigint; reference: (seed: string, client: string, nonce: number) => { outcome: number; payout: bigint } }[] = [
    {
      bet: { game: "dice", amount: 5n * u, target: 4950, direction: "under" },
      stake: 5n * u,
      reference: (s, c, n) => {
        const roll = computeRoll(s, c, n);
        return { outcome: roll, payout: roll < 4950 ? payoutFor(5n * u, 4950, cfg.houseEdgeBps) : 0n };
      },
    },
    {
      bet: { game: "plinko", amount: 5n * u, rows: 12, risk: "medium" },
      stake: 5n * u,
      reference: (s, c, n) => {
        const r = resolvePlinko({ amount: 5n * u, rows: 12, risk: "medium" }, { serverSeed: s, clientSeed: c, nonce: n });
        return { outcome: encodePlinkoPath(r.path), payout: r.payout };
      },
    },
    {
      bet: { game: "roulette", chips: [{ mask: rouletteMasks.red(), amount: 3n * u }, { mask: rouletteMasks.straight(17), amount: 1n * u }] },
      stake: 4n * u,
      reference: (s, c, n) => {
        const chips = [{ mask: rouletteMasks.red(), amount: 3n * u }, { mask: rouletteMasks.straight(17), amount: 1n * u }];
        const r = resolveRoulette(chips, { serverSeed: s, clientSeed: c, nonce: n });
        return { outcome: r.number, payout: r.payout };
      },
    },
  ];

  for (const [i, round] of (expire ? rounds.slice(0, 1) : rounds).entries()) {
    const state = (await fetchPlayer(program, p))!;
    const before = await tokenBalance(mint);
    const clientSeed = createHash("sha256").update(`e2e-${i}-${Date.now()}`).digest("hex").slice(0, 16);
    await send(await placeBetInstruction(program, p, mint, round.bet, clientSeed, state.commitment));
    const placed = (await fetchPlayer(program, p))!;
    check(placed.pending, `${round.bet.game} bet ${state.nonce} placed and escrowed`);

    if (expire) {
      const wait = cfg.settleTimeoutSecs.toNumber() + 2;
      console.log(`  waiting ${wait}s for the settlement deadline…`);
      await sleep(wait * 1000);
      await send(await program.methods.claimExpired().accountsPartial(accounts).instruction());
      const after = await tokenBalance(mint);
      check(after === before - round.stake + placed.bet!.maxPayout, "expired bet paid the full potential payout");
      const s = (await fetchPlayer(program, p))!;
      check(s.nonce === state.nonce + 1 && /^0+$/.test(s.commitment), "nonce advanced and commitment cleared");
      return;
    }

    let settled = false;
    for (let t = 0; t < 60 && !settled; t++) {
      await sleep(500);
      settled = ((await fetchPlayer(program, p))?.nonce ?? 0) > state.nonce;
    }
    check(settled, `house settled bet ${state.nonce}`);

    const entry: BetHistoryEntry | undefined = (await fetchBetHistory(connection, p, 10)).find((b) => b.nonce === state.nonce);
    check(entry?.serverSeed, "settlement event found in the transaction history");
    check(verifyCommitment(entry.serverSeed, state.commitment), "revealed seed matches the commitment made before the bet");
    const ref = round.reference(entry.serverSeed, clientSeed, state.nonce);
    check(ref.outcome === entry.outcome && ref.payout === entry.payout, `${round.bet.game} outcome ${entry.outcome} and payout reproduced off-chain with packages/fair`);
    const after = await tokenBalance(mint);
    check(after === before - round.stake + entry.payout, `balance ${formatHroll(before)} → ${formatHroll(after)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
