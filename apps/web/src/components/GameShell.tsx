"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { formatHroll, fromHex, isZeroCommitment, playerPda } from "@hashroll/program";
import { ConnectButton } from "@/components/ConnectButton";
import { describeOutcome, GAME_LABEL, verifyHref } from "@/lib/format";
import type { Hashroll } from "@/lib/useHashroll";

/** Balance bar, pending/owed banners, seeds and on-chain history shared by every game. */
export function GameShell({ hr, title, children }: { hr: Hashroll; title: string; children: ReactNode }) {
  const [now, setNow] = useState(0); // set in an effect: the clock must not be read during prerender
  useEffect(() => {
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  if (!hr.address) {
    return (
      <section className="flex flex-col items-center gap-6 py-24 text-center">
        <h1 className="text-4xl font-bold">{title}</h1>
        <p className="text-white/60 max-w-md">Connect a Solana wallet to play. Every bet is escrowed and settled by an on-chain program.</p>
        <ConnectButton />
      </section>
    );
  }

  const { player, house } = hr;
  const pending = player?.pending ? player.bet : null;
  const expiresAt = pending && house ? pending.placedAt + house.settleTimeoutSecs : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-white/50">Wallet balance (on-chain)</div>
          <div className="text-2xl font-mono tabular-nums">{formatHroll(hr.hroll)} HROLL</div>
          <div className="text-xs font-mono text-white/40">{hr.sol.toFixed(4)} SOL for fees</div>
        </div>
        <div className="flex gap-2 items-center">
          <button disabled={hr.busy} onClick={hr.faucet} className="text-xs rounded border border-white/20 px-3 py-1.5 hover:bg-white/5 disabled:opacity-50">
            + 1000 HROLL + 2 SOL (dev faucet)
          </button>
          <ConnectButton />
        </div>
      </div>

      {children}

      {hr.status && <p className="text-white/60 text-sm -mt-3">{hr.status}</p>}
      {hr.error && <p className="text-rose-400 text-sm break-words -mt-3">{hr.error}</p>}

      {pending && (
        <div className="rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm flex flex-col gap-2">
          <div>
            Pending {GAME_LABEL[pending.game]} bet: {formatHroll(pending.amount)} HROLL, waiting for the house to settle.
          </div>
          {expiresAt !== null && now >= expiresAt ? (
            <button disabled={hr.busy} onClick={hr.claimExpired} className="self-start rounded bg-amber-400 text-black font-semibold px-3 py-1.5 disabled:opacity-50">
              House missed the deadline: claim {formatHroll(pending.maxPayout)} HROLL
            </button>
          ) : (
            expiresAt !== null && (
              <div className="text-white/50 text-xs">
                If it is not settled in {Math.max(0, Math.ceil(expiresAt - now))}s you can claim the maximum payout ({formatHroll(pending.maxPayout)} HROLL).
              </div>
            )
          )}
        </div>
      )}

      {player && player.owed > 0n && (
        <div className="rounded border border-sky-400/30 bg-sky-400/5 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{formatHroll(player.owed)} HROLL was credited to you while your token account was closed.</span>
          <button disabled={hr.busy} onClick={hr.withdrawOwed} className="rounded bg-sky-400 text-black font-semibold px-3 py-1.5 disabled:opacity-50">
            Withdraw
          </button>
        </div>
      )}

      <section className="rounded-xl border border-white/10 p-4 text-xs font-mono flex flex-col gap-2 break-all">
        <label className="flex flex-col gap-1">
          <span className="text-white/50">your client seed (up to 32 characters, no &quot;:&quot;; a new one is drawn after each bet)</span>
          <input
            value={hr.clientSeed}
            maxLength={32}
            onChange={(e) => hr.setClientSeed(e.target.value.trim())}
            className="rounded bg-white/5 border border-white/10 px-3 py-2"
          />
        </label>
        {player && (
          <>
            <div>
              <span className="text-white/50">next server seed hash:</span>{" "}
              {isZeroCommitment(fromHex(player.commitment)) ? "(waiting for the house)" : player.commitment}
            </div>
            <div><span className="text-white/50">next nonce:</span> {player.nonce}</div>
            <div><span className="text-white/50">player account:</span> {playerPda(new PublicKey(hr.address)).toBase58()}</div>
          </>
        )}
        {house && <div className="text-white/40">max profit per bet: {formatHroll(house.maxProfit)} HROLL</div>}
      </section>

      <section>
        <h2 className="text-sm uppercase text-white/50 mb-2">History (read from the chain)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead className="text-white/40 text-left">
              <tr><th>nonce</th><th>game</th><th>outcome</th><th>stake</th><th>payout</th><th></th></tr>
            </thead>
            <tbody>
              {hr.history.map((b) => (
                <tr key={`${b.signature}-${b.nonce}`} className={b.win ? "text-emerald-400" : b.payout > 0n ? "text-amber-300" : "text-rose-400"}>
                  <td>{b.nonce}</td>
                  <td>{b.bet ? GAME_LABEL[b.bet.game] : "—"}</td>
                  <td className="whitespace-nowrap">{describeOutcome(b)}</td>
                  <td>{b.bet ? formatHroll(b.bet.amount) : "—"}</td>
                  <td>{formatHroll(b.payout)}{b.credited ? " (owed)" : ""}</td>
                  <td>{b.serverSeed && <Link href={verifyHref(b)} className="underline text-white/60 hover:text-white">verify</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Amount input with quick ½ / 2× buttons. */
export function AmountInput({ value, onChange, label = "Amount (HROLL)" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const scale = (f: number) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) onChange(String(Math.max(0.01, Math.round(n * f * 100) / 100)));
  };
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-white/60">{label}</span>
      <div className="flex rounded border border-white/10 overflow-hidden">
        <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0 bg-white/5 px-3 py-2 font-mono" />
        <button type="button" onClick={() => scale(0.5)} className="px-3 hover:bg-white/10 border-l border-white/10">½</button>
        <button type="button" onClick={() => scale(2)} className="px-3 hover:bg-white/10 border-l border-white/10">2×</button>
      </div>
    </label>
  );
}
