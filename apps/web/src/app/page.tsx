"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { ROLL_RANGE, payoutFor } from "@hashroll/fair";
import {
  BN,
  configPda,
  fetchBetHistory,
  fetchPlayer,
  formatHroll,
  fromHex,
  isZeroCommitment,
  parseHroll,
  playerPda,
  playerTokenAccount,
  toAnchorDirection,
  vaultPda,
  type BetHistoryEntry,
  type Direction,
  type PlayerView,
} from "@hashroll/program";
import { ConnectButton } from "@/components/ConnectButton";
import { api } from "@/lib/api";
import { getConnection, getProgram } from "@/lib/solana";

const fmtRoll = (r: number) => (r / 100).toFixed(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomClientSeed(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function verifyHref(b: BetHistoryEntry) {
  const q = new URLSearchParams({ serverSeed: b.serverSeed ?? "", commitment: b.commitment, clientSeed: b.clientSeed ?? "", nonce: String(b.nonce) });
  return `/verify?${q}`;
}

interface HouseState {
  mint: PublicKey;
  houseEdgeBps: number;
  settleTimeoutSecs: number;
  maxProfit: bigint;
  paused: boolean;
}

export default function DicePage() {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const address = publicKey?.toBase58();

  const [house, setHouse] = useState<HouseState | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [hroll, setHroll] = useState<bigint>(0n);
  const [sol, setSol] = useState<number>(0);
  const [bets, setBets] = useState<BetHistoryEntry[]>([]);
  const [amount, setAmount] = useState("1");
  const [target, setTarget] = useState(4950);
  const [direction, setDirection] = useState<Direction>("under");
  const [clientSeed, setClientSeed] = useState("");
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0); // set in an effect: the clock must not be read during prerender

  useEffect(() => setClientSeed(randomClientSeed()), []);
  useEffect(() => {
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  /** Everything here is read straight from the chain, not from the API. */
  const refresh = useCallback(async () => {
    if (!publicKey) return;
    const connection = getConnection();
    const program = getProgram();
    const cfg = await program.account.config.fetch(configPda());
    const vault = BigInt((await connection.getTokenAccountBalance(vaultPda())).value.amount);
    const reserved = BigInt(cfg.reserved.toString());
    const free = vault > reserved ? vault - reserved : 0n;
    setHouse({
      mint: cfg.mint,
      houseEdgeBps: cfg.houseEdgeBps,
      settleTimeoutSecs: cfg.settleTimeoutSecs.toNumber(),
      maxProfit: (free * BigInt(cfg.maxPayoutBps)) / 10_000n,
      paused: cfg.paused,
    });
    const ata = playerTokenAccount(cfg.mint, publicKey);
    const [p, tokenBal, lamports, history] = await Promise.all([
      fetchPlayer(program, publicKey),
      connection.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n),
      connection.getBalance(publicKey),
      fetchBetHistory(connection, publicKey),
    ]);
    setPlayer(p);
    setHroll(tokenBal);
    setSol(lamports / 1e9);
    setBets(history);
    return p;
  }, [publicKey]);

  // On connect: make sure the house opened our account and committed a seed, then load the state.
  useEffect(() => {
    if (!address) return;
    setError(null);
    api
      .open(address)
      .catch((e) => setError(`API: ${e instanceof Error ? e.message : String(e)}`))
      .then(() => refresh())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [address, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  /** Signs with the wallet and submits through our own RPC, so the wallet's network setting does not matter. */
  const submit = async (ix: TransactionInstruction) => {
    if (!publicKey) throw new Error("wallet not connected");
    const connection = getConnection();
    const tx = new Transaction().add(ix);
    tx.feePayer = publicKey;
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = signTransaction
      ? await connection.sendRawTransaction((await signTransaction(tx)).serialize())
      : await sendTransaction(tx, connection);
    const res = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
    return signature;
  };

  const placeBet = () =>
    run(async () => {
      if (!publicKey || !house || !player) throw new Error("not ready");
      if (isZeroCommitment(fromHex(player.commitment))) throw new Error("the house has not committed a seed yet; try again");
      const units = parseHroll(amount);
      const ix = await getProgram()
        .methods.placeBet(new BN(units.toString()), target, toAnchorDirection(direction), clientSeed, fromHex(player.commitment))
        .accountsPartial({
          player: publicKey,
          config: configPda(),
          playerState: playerPda(publicKey),
          mint: house.mint,
          vault: vaultPda(),
          playerToken: playerTokenAccount(house.mint, publicKey),
        })
        .instruction();
      setStatus("Waiting for wallet signature…");
      await submit(ix);

      // The house settles on its own; wait for the nonce to move on.
      setStatus("Bet placed. Waiting for the house to reveal the seed…");
      const nonce = player.nonce;
      for (let i = 0; i < 60; i++) {
        const p = await fetchPlayer(getProgram(), publicKey);
        if (p && p.nonce > nonce) break;
        await sleep(1000);
      }
      const history = await fetchBetHistory(getConnection(), publicKey, 5);
      setLast(history.find((b) => b.nonce === nonce) ?? null);
      setClientSeed(randomClientSeed());
    });

  const claimExpired = () =>
    run(async () => {
      if (!publicKey || !house) throw new Error("not ready");
      const ix = await getProgram()
        .methods.claimExpired()
        .accountsPartial({
          player: publicKey,
          config: configPda(),
          playerState: playerPda(publicKey),
          mint: house.mint,
          vault: vaultPda(),
          playerToken: playerTokenAccount(house.mint, publicKey),
        })
        .instruction();
      await submit(ix);
    });

  if (!address) {
    return (
      <section className="flex flex-col items-center gap-6 py-24 text-center">
        <h1 className="text-4xl font-bold">On-chain dice with cryptographic proof</h1>
        <p className="text-white/60 max-w-md">
          Every bet is settled by a Solana program. The house commits SHA256(serverSeed) before you bet, you pick the
          client seed, and the program checks the revealed seed before paying out.
        </p>
        <ConnectButton />
      </section>
    );
  }

  const edge = house?.houseEdgeBps ?? 100;
  let multiplier = "—";
  try {
    multiplier = (Number(payoutFor(10_000n, target, edge)) / 10_000).toFixed(4) + "x";
  } catch {}
  const winRange = direction === "under" ? `< ${fmtRoll(target)}` : `≥ ${fmtRoll(ROLL_RANGE - target)}`;
  const pending = player?.pending ? player.bet : null;
  const expiresAt = pending && house ? pending.placedAt + house.settleTimeoutSecs : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-white/50">Wallet balance (on-chain)</div>
          <div className="text-2xl font-mono">{formatHroll(hroll)} HROLL</div>
          <div className="text-xs font-mono text-white/40">{sol.toFixed(4)} SOL for fees</div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            disabled={busy}
            onClick={() => run(() => api.faucet(address))}
            className="text-xs rounded border border-white/20 px-3 py-1.5 hover:bg-white/5"
          >
            + 1000 HROLL + 2 SOL (dev faucet)
          </button>
          <ConnectButton />
        </div>
      </div>

      <section className="rounded-xl border border-white/10 p-6 flex flex-col gap-5">
        <div className="text-center">
          <div className={`font-mono text-6xl ${last?.roll != null ? (last.win ? "text-emerald-400" : "text-rose-400") : "text-white/30"}`}>
            {last?.roll != null ? fmtRoll(last.roll) : "00.00"}
          </div>
          {last && (
            <div className="text-sm text-white/60 mt-1">
              {last.win ? `Won ${formatHroll(last.payout)} HROLL` : "Lost"} ·{" "}
              <Link href={verifyHref(last)} className="underline hover:text-white">verify</Link>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-2 text-sm">
          <span className="flex justify-between text-white/60">
            <span>Win chance: {(target / 100).toFixed(2)}%</span>
            <span>Multiplier: {multiplier}</span>
          </span>
          <input type="range" min={100} max={9800} step={50} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="accent-emerald-400" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">Amount (HROLL)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded bg-white/5 border border-white/10 px-3 py-2 font-mono" />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">Wins if roll {winRange}</span>
            <div className="grid grid-cols-2 rounded border border-white/10 overflow-hidden">
              {(["under", "over"] as const).map((d) => (
                <button key={d} onClick={() => setDirection(d)} className={`py-2 ${direction === d ? "bg-white/15" : "hover:bg-white/5"}`}>
                  {d === "under" ? "Under" : "Over"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Client seed (yours: up to 32 characters, no &quot;:&quot;; a new one is drawn after each bet)</span>
          <input value={clientSeed} maxLength={32} onChange={(e) => setClientSeed(e.target.value.trim())} className="rounded bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs" />
        </label>

        {pending ? (
          <div className="rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm flex flex-col gap-2">
            <div>
              Pending bet: {formatHroll(pending.amount)} HROLL, waiting for the house to settle.
            </div>
            {expiresAt !== null && now >= expiresAt ? (
              <button disabled={busy} onClick={claimExpired} className="self-start rounded bg-amber-400 text-black font-semibold px-3 py-1.5 disabled:opacity-50">
                House missed the deadline: claim {formatHroll(pending.potentialPayout)} HROLL
              </button>
            ) : (
              expiresAt !== null && (
                <div className="text-white/50 text-xs">If it is not settled in {Math.max(0, Math.ceil(expiresAt - now))}s you can claim the full payout.</div>
              )
            )}
          </div>
        ) : (
          <button
            disabled={busy || !player || house?.paused}
            onClick={placeBet}
            className="rounded-lg bg-emerald-500 text-black font-bold py-3 hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? "Rolling…" : house?.paused ? "Betting paused" : "Roll"}
          </button>
        )}
        {status && <p className="text-white/60 text-sm">{status}</p>}
        {error && <p className="text-rose-400 text-sm break-words">{error}</p>}
        {house && <p className="text-white/40 text-xs">Max profit per bet: {formatHroll(house.maxProfit)} HROLL</p>}
      </section>

      {player && (
        <section className="rounded-xl border border-white/10 p-4 text-xs font-mono flex flex-col gap-1 break-all">
          <div><span className="text-white/50">next server seed hash:</span> {isZeroCommitment(fromHex(player.commitment)) ? "(waiting for the house)" : player.commitment}</div>
          <div><span className="text-white/50">next nonce:</span> {player.nonce}</div>
          <div><span className="text-white/50">player account:</span> {playerPda(new PublicKey(address)).toBase58()}</div>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase text-white/50 mb-2">History (read from the chain)</h2>
        <table className="w-full text-sm font-mono">
          <thead className="text-white/40 text-left">
            <tr><th>nonce</th><th>roll</th><th>target</th><th>amount</th><th>payout</th><th></th></tr>
          </thead>
          <tbody>
            {bets.map((b) => (
              <tr key={`${b.signature}-${b.nonce}`} className={b.win ? "text-emerald-400" : "text-rose-400"}>
                <td>{b.nonce}</td>
                <td>{b.roll != null ? fmtRoll(b.roll) : "expired"}</td>
                <td>
                  {b.target != null && b.direction
                    ? `${b.direction === "under" ? "<" : "≥"} ${fmtRoll(b.direction === "under" ? b.target : ROLL_RANGE - b.target)}`
                    : "—"}
                </td>
                <td>{b.amount != null ? formatHroll(b.amount) : "—"}</td>
                <td>{formatHroll(b.payout)}</td>
                <td>{b.serverSeed && <Link href={verifyHref(b)} className="underline text-white/60 hover:text-white">verify</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
