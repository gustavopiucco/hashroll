"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { formatEther, parseEther } from "viem";
import { ROLL_RANGE, payoutFor } from "@hashroll/fair";
import { ConnectButton } from "@/components/ConnectButton";
import { api, type BetRecord, type PlayerState } from "@/lib/api";

const fmtRoll = (r: number) => (r / 100).toFixed(2);

export default function DicePage() {
  const { address } = useConnection();
  const [state, setState] = useState<PlayerState | null>(null);
  const [bets, setBets] = useState<BetRecord[]>([]);
  const [amount, setAmount] = useState("1");
  const [target, setTarget] = useState(4950);
  const [direction, setDirection] = useState<"under" | "over">("under");
  const [last, setLast] = useState<BetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    const [s, b] = await Promise.all([api.state(address), api.bets(address)]);
    setState(s);
    setBets(b);
  }, [address]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message ?? e)));
  }, [refresh]);

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
    }
  };

  if (!address) {
    return (
      <section className="flex flex-col items-center gap-6 py-24 text-center">
        <h1 className="text-4xl font-bold">Dice with cryptographic proof</h1>
        <p className="text-white/60 max-w-md">
          Every roll is HMAC-SHA256(serverSeed, clientSeed:nonce). The server seed hash is published before the bet.
        </p>
        <ConnectButton />
      </section>
    );
  }

  const edge = state?.houseEdgeBps ?? 100;
  let multiplier = "—";
  try {
    multiplier = (Number(payoutFor(10_000n, target, edge)) / 10_000).toFixed(4) + "x";
  } catch {}
  const winRange =
    direction === "under" ? `< ${fmtRoll(target)}` : `≥ ${fmtRoll(ROLL_RANGE - target)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-white/50">Balance (off-chain)</div>
          <div className="text-2xl font-mono">{state ? formatEther(BigInt(state.balance)) : "…"} HROLL</div>
        </div>
        <div className="flex gap-2 items-center">
          <button disabled={busy} onClick={() => run(() => api.faucet(address))} className="text-xs rounded border border-white/20 px-3 py-1.5 hover:bg-white/5">
            + 1000 (dev faucet)
          </button>
          <ConnectButton />
        </div>
      </div>

      <section className="rounded-xl border border-white/10 p-6 flex flex-col gap-5">
        <div className="text-center">
          <div className={`font-mono text-6xl ${last ? (last.win ? "text-emerald-400" : "text-rose-400") : "text-white/30"}`}>
            {last ? fmtRoll(last.roll) : "00.00"}
          </div>
          {last && <div className="text-sm text-white/60 mt-1">{last.win ? `Won ${formatEther(BigInt(last.payout))} HROLL` : "Lost"}</div>}
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

        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.dice(address, { amount: parseEther(amount).toString(), target, direction });
              setLast(r.bet);
            })
          }
          className="rounded-lg bg-emerald-500 text-black font-bold py-3 hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? "Rolling…" : "Roll"}
        </button>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
      </section>

      {state && (
        <section className="rounded-xl border border-white/10 p-4 text-xs font-mono flex flex-col gap-1 break-all">
          <div><span className="text-white/50">server seed hash:</span> {state.commitment}</div>
          <div><span className="text-white/50">client seed:</span> {state.clientSeed}</div>
          <div><span className="text-white/50">next nonce:</span> {state.nonce}</div>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.rotate(address);
                alert(`Server seed revealed:\n${r.revealed.serverSeed}\n\nUse the Verify page to audit.`);
              })
            }
            className="self-start mt-2 rounded border border-white/20 px-3 py-1 hover:bg-white/5 font-sans"
          >
            Reveal seed and generate new
          </button>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase text-white/50 mb-2">History</h2>
        <table className="w-full text-sm font-mono">
          <thead className="text-white/40 text-left">
            <tr><th>nonce</th><th>roll</th><th>target</th><th>amount</th><th>payout</th></tr>
          </thead>
          <tbody>
            {bets.map((b) => (
              <tr key={b.id} className={b.win ? "text-emerald-400" : "text-rose-400"}>
                <td>{b.nonce}</td>
                <td>{fmtRoll(b.roll)}</td>
                <td>{b.direction === "under" ? "<" : "≥"} {fmtRoll(b.direction === "under" ? b.target : ROLL_RANGE - b.target)}</td>
                <td>{formatEther(BigInt(b.amount))}</td>
                <td>{formatEther(BigInt(b.payout))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
