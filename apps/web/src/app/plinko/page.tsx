"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLINKO_RISKS, PLINKO_ROWS, decodePlinkoPath, plinkoMaxPayout, plinkoSlot, plinkoTable, type PlinkoRisk } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { AmountInput, Seg, Stat, WinBanner } from "@/components/ui";
import { PLINKO_H, PLINKO_W, createPlinkoStage } from "@/games/plinkoStage";
import { usePixiStage } from "@/games/usePixiStage";
import { celebrate } from "@/lib/effects";
import { fmtMultiplier, resultDetail, verifyHref } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useHashroll } from "@/lib/useHashroll";

type Phase = "idle" | "waiting" | "dropping" | "done";

export default function PlinkoPage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [rows, setRows] = useState<number>(12);
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [phase, setPhase] = useState<Phase>("idle");
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const { hostRef, host, stageRef, ready } = usePixiStage(PLINKO_W, PLINKO_H, createPlinkoStage);

  useEffect(() => {
    if (ready) stageRef.current?.setBoard(rows, risk);
  }, [ready, rows, risk, stageRef]);

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
    const bet = { game: "plinko" as const, amount: units, rows, risk };
    const entry = await hr.play(bet, () => {
      setPhase("waiting");
      stageRef.current?.wait();
    });
    if (entry?.outcome != null && entry.bet?.game === "plinko") {
      setPhase("dropping");
      try {
        // The animation only replays the on-chain path; it never decides the result.
        await stageRef.current?.drop(decodePlinkoPath(entry.outcome, entry.bet.rows), entry.bet.rows, entry.bet.risk);
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
    maxWin = formatHroll(plinkoMaxPayout(parseHroll(amount), rows, risk));
    stakeOk = true;
  } catch {}
  const table = plinkoTable(rows, risk);
  const animating = phase === "waiting" || phase === "dropping";
  const locked = animating || hr.busy;
  const lastBet = last?.bet?.game === "plinko" ? last.bet : null;
  const lastSlot = lastBet && last?.outcome != null ? plinkoSlot(decodePlinkoPath(last.outcome, lastBet.rows)) : null;
  // The settled bet's own table: changing rows/risk afterwards must not relabel a paid result.
  const lastMult = lastBet && lastSlot != null ? plinkoTable(lastBet.rows, lastBet.risk)[lastSlot] ?? 0 : 0;

  const controls = (
    <>
      <AmountInput value={amount} onChange={setAmount} disabled={locked} />
      <Seg label="Risk" options={PLINKO_RISKS} value={risk} onChange={setRisk} disabled={locked} />
      <Seg label="Rows" options={PLINKO_ROWS} value={rows as (typeof PLINKO_ROWS)[number]} onChange={setRows} disabled={locked} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Max multiplier" value={fmtMultiplier(table[0])} accent="text-hot" />
        <Stat label="Max win" value={maxWin} accent="text-gold" />
      </div>
      <button
        disabled={hr.busy || animating || !hr.player || hr.player.pending || hr.house?.paused || !stakeOk}
        onClick={play}
        className="btn-play mt-auto"
        style={{ ["--btn" as string]: "var(--gold)" }}
      >
        {animating ? "Dropping…" : hr.busy ? "Please wait…" : hr.house?.paused ? "Betting paused" : "Drop ball"}
      </button>
    </>
  );

  return (
    <GameShell
      hr={hr}
      game="plinko"
      hold={animating}
      tagline="Drop the ball through 8, 12 or 16 rows of pegs and hit up to 1000x."
      controls={controls}
      fairness={
        <>
          Each row reads one bit of HMAC_SHA256(serverSeed, clientSeed:nonce): 1 = right. The ball&apos;s slot is the number of right bounces. The
          edge is built into the payout tables (RTP 98.75–98.97%).
        </>
      }
    >
      <div className="relative">
        <div ref={hostRef} role="img" aria-label={`Plinko board, ${rows} rows, ${risk} risk`} className="mx-auto w-full max-w-[640px] aspect-[640/580]" />
        <WinBanner
          show={phase === "done" && !!last}
          win={!!last?.win}
          multiplier={fmtMultiplier(lastMult)}
          detail={last?.bet ? resultDetail(last.bet.amount, last.payout, formatHroll) : ""}
        />
      </div>
      <div className="mt-2 h-5 text-center text-sm text-white/60">
        {phase === "waiting" && "Waiting for the house to reveal the seed…"}
        {phase === "done" && last && (
          <>
            Slot {lastSlot} · paid <span className={last.win ? "text-brand" : "text-gold"}>{formatHroll(last.payout)} HROLL</span> ·{" "}
            <Link href={verifyHref(last)} className="underline hover:text-white">
              verify
            </Link>
          </>
        )}
      </div>
    </GameShell>
  );
}
