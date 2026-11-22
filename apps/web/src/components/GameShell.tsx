"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { HROLL_UNIT, formatHroll, fromHex, isZeroCommitment, playerPda } from "@hashroll/program";
import { ConnectButton } from "@/components/ConnectButton";
import { GameIcon } from "@/components/GameArt";
import { AnimatedNumber, Coin } from "@/components/ui";
import { describeOutcome, GAME_LABEL, verifyHref } from "@/lib/format";
import type { Hashroll } from "@/lib/useHashroll";
import type { Game } from "@hashroll/program";

const toHroll = (units: bigint) => Number(units) / Number(HROLL_UNIT);
const fmtBalance = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Layout shared by every game: balance bar, bet panel + stage, pending/owed banners, recent bets
 * read from the chain, and a collapsible fairness section with the seeds.
 */
export function GameShell({
  hr,
  game,
  tagline,
  controls,
  fairness,
  hold = false,
  children,
}: {
  hr: Hashroll;
  game: Game;
  tagline: string;
  controls: ReactNode;
  fairness: ReactNode;
  /** While a result is animating, keep showing the pre-bet balance and history so they do not spoil it. */
  hold?: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState({ hroll: hr.hroll, history: hr.history });
  useEffect(() => {
    if (!hold) setShown({ hroll: hr.hroll, history: hr.history });
  }, [hold, hr.hroll, hr.history]);

  const [now, setNow] = useState(0); // set in an effect: the clock must not be read during prerender
  useEffect(() => {
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const title = GAME_LABEL[game];

  if (!hr.address) {
    return (
      <section className="panel relative overflow-hidden flex flex-col items-center gap-6 px-6 py-20 text-center">
        <div className="absolute inset-0 opacity-30 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,var(--brand),transparent_60%)]" />
        <GameIcon game={game} className="relative h-24 w-24 animate-[drift_4s_ease-in-out_infinite]" />
        <h1 className="relative font-display text-5xl font-black tracking-tight">{title}</h1>
        <p className="relative text-white/65 max-w-md">{tagline}</p>
        <div className="relative">
          <ConnectButton />
        </div>
        <p className="relative text-xs text-white/40">Every bet is escrowed and settled by an on-chain program.</p>
      </section>
    );
  }

  const { player, house } = hr;
  const pending = player?.pending ? player.bet : null;
  const expiresAt = pending && house ? pending.placedAt + house.settleTimeoutSecs : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GameIcon game={game} className="h-10 w-10" />
          <h1 className="font-display text-3xl font-black tracking-tight">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2" title={`${hr.sol.toFixed(4)} SOL for fees`}>
            <Coin className="h-5 w-5" />
            <span className="font-mono text-lg font-bold tabular-nums">
              <AnimatedNumber value={toHroll(shown.hroll)} format={fmtBalance} />
            </span>
            <span className="text-xs font-semibold text-white/50">HROLL</span>
          </div>
          <button
            disabled={hr.busy}
            onClick={hr.faucet}
            title="Dev faucet: 1000 HROLL + 2 SOL"
            className="rounded-xl bg-gold px-3 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            + Get test HROLL
          </button>
          <ConnectButton />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="panel order-2 lg:order-1 flex min-w-0 flex-col gap-4 p-4">{controls}</aside>
        <section className="panel order-1 lg:order-2 relative overflow-hidden p-3 sm:p-5">{children}</section>
      </div>

      {hr.status && (
        <p className="flex items-center gap-2 text-sm text-white/70">
          <span className="h-2 w-2 rounded-full bg-brand animate-pulse" />
          {hr.status}
        </p>
      )}
      {hr.error && <p className="rounded-xl border border-hot/40 bg-hot/10 px-4 py-3 text-sm text-rose-200 break-words">{hr.error}</p>}

      {pending && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm flex flex-col gap-2">
          <div>
            Pending {GAME_LABEL[pending.game]} bet: {formatHroll(pending.amount)} HROLL, waiting for the house to settle.
          </div>
          {expiresAt !== null && now >= expiresAt ? (
            <button disabled={hr.busy} onClick={hr.claimExpired} className="self-start rounded-lg bg-gold text-black font-bold px-4 py-2 disabled:opacity-50">
              House missed the deadline: claim {formatHroll(pending.maxPayout)} HROLL
            </button>
          ) : (
            expiresAt !== null && (
              <div className="text-white/60 text-xs">
                If it is not settled in {Math.max(0, Math.ceil(expiresAt - now))}s you can claim the maximum payout ({formatHroll(pending.maxPayout)} HROLL).
              </div>
            )
          )}
        </div>
      )}

      {player && player.owed > 0n && (
        <div className="rounded-xl border border-sky/40 bg-sky/10 p-4 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{formatHroll(player.owed)} HROLL was credited to you while your token account was closed.</span>
          <button disabled={hr.busy} onClick={hr.withdrawOwed} className="rounded-lg bg-sky text-black font-bold px-4 py-2 disabled:opacity-50">
            Withdraw
          </button>
        </div>
      )}

      <section className="panel p-4">
        <h2 className="field-label mb-3">Recent bets · read from the chain</h2>
        {shown.history.length === 0 ? (
          <p className="text-sm text-white/40">No bets yet. Place your first one!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left field-label">
                <tr>
                  <th className="pb-2 font-bold">Game</th>
                  <th className="pb-2 font-bold">Outcome</th>
                  <th className="pb-2 font-bold text-right">Stake</th>
                  <th className="pb-2 font-bold text-right">Multiplier</th>
                  <th className="pb-2 font-bold text-right">Payout</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.history.map((b) => {
                  const mult = b.bet && b.bet.amount > 0n ? Number(b.payout) / Number(b.bet.amount) : 0;
                  const tone = b.win ? "text-brand" : b.payout > 0n ? "text-gold" : "text-white/40";
                  return (
                    <tr key={`${b.signature}-${b.nonce}`} className="border-t border-line/60">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {b.bet && <GameIcon game={b.bet.game} className="h-5 w-5" />}
                          {b.bet ? GAME_LABEL[b.bet.game] : "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-white/70 whitespace-nowrap">{describeOutcome(b)}</td>
                      <td className="py-2 pr-3 font-mono text-right">{b.bet ? formatHroll(b.bet.amount) : "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${b.win ? "bg-brand/15 text-brand" : "bg-white/5 text-white/50"}`}>
                          {mult.toFixed(2)}x
                        </span>
                      </td>
                      <td className={`py-2 pr-3 font-mono text-right ${tone}`}>
                        {formatHroll(b.payout)}
                        {b.credited ? " (owed)" : ""}
                      </td>
                      <td className="py-2 text-right">
                        {b.serverSeed && (
                          <Link href={verifyHref(b)} className="text-xs text-white/50 underline hover:text-white">
                            verify
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="panel group p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <span className="flex items-center gap-2 font-semibold">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
              <path d="M8.5 12l2.5 2.5 4.5-5" />
            </svg>
            Provably fair
          </span>
          <span className="text-white/40 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-4 flex flex-col gap-3 text-xs font-mono break-all">
          <label className="flex flex-col gap-1">
            <span className="text-white/50">Your client seed (up to 32 characters, no &quot;:&quot;; a new one is drawn after each bet)</span>
            <input
              value={hr.clientSeed}
              maxLength={32}
              onChange={(e) => hr.setClientSeed(e.target.value.trim())}
              className="rounded-lg bg-black/35 border border-line px-3 py-2"
            />
          </label>
          {player && (
            <>
              <div>
                <span className="text-white/50">Next server seed hash:</span>{" "}
                {isZeroCommitment(fromHex(player.commitment)) ? "(waiting for the house)" : player.commitment}
              </div>
              <div>
                <span className="text-white/50">Next nonce:</span> {player.nonce}
              </div>
              <div>
                <span className="text-white/50">Player account:</span> {playerPda(new PublicKey(hr.address)).toBase58()}
              </div>
            </>
          )}
          {house && (
            <div className="text-white/50">
              Max profit per bet: {formatHroll(house.maxProfit)} HROLL · {hr.sol.toFixed(4)} SOL for fees
            </div>
          )}
          <div className="text-white/50 font-sans text-sm leading-relaxed">{fairness}</div>
          <Link href="/verify" className="self-start font-sans text-sm text-brand underline">
            Open the verifier
          </Link>
        </div>
      </details>
    </div>
  );
}
