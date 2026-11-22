/**
 * End-to-end smoke test against the local stack (validator + deployed program + running API).
 * Acts as a fresh player: faucet → open account → place bets → wait for the house to settle →
 * re-verify every roll with packages/fair.
 *
 *   npm run e2e:local -w @hashroll/program              # normal rounds (API settler running)
 *   npm run e2e:local -w @hashroll/program -- --expire  # timeout path (start the API with SETTLER_ENABLED=false)
 */
import { createHash } from "node:crypto";
import { Connection, Keypair, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { computeRoll, payoutFor, verifyCommitment } from "@hashroll/fair";
import {
  BN,
  HROLL_UNIT,
  configPda,
  fetchBetHistory,
  fetchPlayer,
  formatHroll,
  fromHex,
  playerPda,
  playerTokenAccount,
  readOnlyProgram,
  toAnchorDirection,
  vaultPda,
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

  const accounts = { player: p, config: configPda(), playerState: playerPda(p), mint, vault: vaultPda(), playerToken: playerTokenAccount(mint, p) };
  const rounds = expire ? 1 : 3;
  for (let i = 0; i < rounds; i++) {
    const state = (await fetchPlayer(program, p))!;
    const before = await tokenBalance(mint);
    const amount = 5n * HROLL_UNIT;
    const clientSeed = createHash("sha256").update(`e2e-${i}-${Date.now()}`).digest("hex").slice(0, 16);
    await send(
      await program.methods
        .placeBet(new BN(amount.toString()), 4950, toAnchorDirection("under"), clientSeed, fromHex(state.commitment))
        .accountsPartial(accounts)
        .instruction(),
    );
    check((await fetchPlayer(program, p))!.pending, `bet ${state.nonce} placed and escrowed`);

    if (expire) {
      const wait = cfg.settleTimeoutSecs.toNumber() + 2;
      console.log(`  waiting ${wait}s for the settlement deadline…`);
      await sleep(wait * 1000);
      await send(await program.methods.claimExpired().accountsPartial(accounts).instruction());
      const after = await tokenBalance(mint);
      check(after === before - amount + payoutFor(amount, 4950, cfg.houseEdgeBps), "expired bet paid the full potential payout");
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

    const entry = (await fetchBetHistory(connection, p, 10)).find((b) => b.nonce === state.nonce)!;
    check(entry && entry.serverSeed, "settlement event found in the transaction history");
    check(verifyCommitment(entry.serverSeed!, state.commitment), "revealed seed matches the commitment made before the bet");
    const roll = computeRoll(entry.serverSeed!, clientSeed, state.nonce);
    check(roll === entry.roll, `roll ${(roll / 100).toFixed(2)} reproduced off-chain with packages/fair`);
    const after = await tokenBalance(mint);
    check(after === before - amount + entry.payout, `balance ${formatHroll(before)} → ${formatHroll(after)} (${entry.win ? "win" : "loss"})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
