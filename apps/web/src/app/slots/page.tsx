"use client";

import { useState } from "react";
import Link from "next/link";
import { BPS, SLOT_LINES, SLOT_LINE_PAYS, SLOT_MAX_MULTIPLIER, SLOT_SYMBOLS, decodeSlotGrid, slotMaxPayout, slotWins } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { SlotIcon } from "@/components/SlotIcon";
import { AmountInput, Stat, WinBanner } from "@/components/ui";
import { SLOTS_H, SLOTS_W, createSlotsStage } from "@/games/slotsStage";
import { usePixiStage } from "@/games/usePixiStage";
import { celebrate } from "@/lib/effects";
import { describeOutcome, fmtMultiplier, resultDetail, verifyHref } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useHashroll } from "@/lib/useHashroll";

type Phase = "idle" | "waiting" | "landing" | "done";

/** Line pays are in line bets; a line bet is 1/5 of the stake. */
const toBps = (units: number) => (units * Number(BPS)) / SLOT_LINES.length;

export default function SlotsPage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const { hostRef, host, stageRef } = usePixiStage(SLOTS_W, SLOTS_H, createSlotsStage);

  const play = async () => {
    sfx.click();
    setLast(null);
    let units: bigint;
    try {
      units = parseHroll(amount);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const entry = await hr.play({ game: "slots", amount: units }, () => {
      setPhase("waiting");
      stageRef.current?.spin();
    });
    if (entry?.outcome != null && entry.bet?.game === "slots") {
      setPhase("landing");
      try {
        // The animation only replays the on-chain grid; it never decides the result.
        await stageRef.current?.land(decodeSlotGrid(entry.outcome));
      } finally {
        setLast(entry);
        setPhase("done");
      }
      void celebrate(Number(entry.payout) / Number(entry.bet.amount), host);
    } else {
      stageRef.current?.idle();
      setPhase("idle");
    }
  };

  let maxWin = "—";
  let stakeOk = false;
  try {
    const units = parseHroll(amount);
    maxWin = formatHroll(slotMaxPayout(units));
    stakeOk = units > 0n;
  } catch {}
  const animating = phase === "waiting" || phase === "landing";
  const locked = animating || hr.busy;
  const lastMult = last?.outcome != null ? toBps(slotWins(decodeSlotGrid(last.outcome)).units) : 0;

  const controls = (
    <>
      <AmountInput value={amount} onChange={setAmount} disabled={locked} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Max multiplier" value={`${SLOT_MAX_MULTIPLIER.toLocaleString("en-US")}x`} accent="text-hot" />
        <Stat label="Max win" value={maxWin} accent="text-gold" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="field-label">Three in a line pay (× stake)</span>
        <ul className="grid grid-cols-2 gap-1.5">
          {SLOT_SYMBOLS.map((name, s) => (
            <li key={name} className="flex items-center gap-2 rounded-lg border border-line bg-black/25 px-2 py-1.5">
              <SlotIcon symbol={s} className="h-6 w-6 shrink-0" />
              <span className="ml-auto font-mono text-sm tabular-nums">{fmtMultiplier(toBps(SLOT_LINE_PAYS[s]))}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-white/50">
          5 lines: 3 rows and 2 diagonals. <span className="font-bold text-brand">#</span> is wild. Fill all 9 cells with one symbol and the whole win
          pays ×10.
        </p>
      </div>
      <button
        disabled={locked || !hr.player || hr.player.pending || hr.house?.paused || !stakeOk}
        onClick={play}
        className="btn-play mt-auto"
        style={{ ["--btn" as string]: "#9b8cff" }}
      >
        {animating ? "Spinning…" : hr.busy ? "Please wait…" : hr.house?.paused ? "Betting paused" : "Spin"}
      </button>
    </>
  );

  return (
    <GameShell
      hr={hr}
      game="slots"
      hold={animating}
      tagline="Three reels, five lines and a wild #. Fill the board for ×10 and up to 1000x."
      controls={controls}
      fairness={
        <>
          Each of the 9 cells reads one byte of HMAC_SHA256(serverSeed, clientSeed:nonce), in row order, and maps it to a symbol with fixed, published
          weights. There are no hidden reel strips. The edge is built into the weights (RTP 96.70%).
        </>
      }
    >
      <div ref={hostRef} role="img" aria-label="Slot machine, 3 by 3 grid" className="mx-auto w-full max-w-[600px] aspect-[600/580]" />
      {/* Below the reels, not over them: the centre cell is on three of the five lines. */}
      <div className="relative h-28">
        {phase === "waiting" && <p className="pt-10 text-center text-sm text-white/60">Waiting for the house to reveal the seed…</p>}
        <WinBanner
          show={phase === "done" && !!last && last.payout > 0n}
          win={!!last?.win}
          multiplier={fmtMultiplier(lastMult)}
          detail={last?.bet ? resultDetail(last.bet.amount, last.payout, formatHroll) : ""}
        />
      </div>
      <div className="mt-2 min-h-5 text-center text-sm text-white/60">
        {phase === "done" && last && (
          <>
            {describeOutcome(last)} · paid <span className={last.win ? "text-brand" : "text-gold"}>{formatHroll(last.payout)} HROLL</span> ·{" "}
            <Link href={verifyHref(last)} className="underline hover:text-white">
              verify
            </Link>
          </>
        )}
      </div>
    </GameShell>
  );
}
