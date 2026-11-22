"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MAX_TARGET, MIN_TARGET, ROLL_RANGE, payoutFor } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry, type Direction } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { AmountInput, Seg, Stat } from "@/components/ui";
import { DICE_H, DICE_W, createDiceStage } from "@/games/diceStage";
import { usePixiStage } from "@/games/usePixiStage";
import { celebrate } from "@/lib/effects";
import { fmtRoll, verifyHref } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useHashroll } from "@/lib/useHashroll";

type Phase = "idle" | "rolling" | "revealing" | "done";

export default function DicePage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [target, setTarget] = useState(4950);
  const [direction, setDirection] = useState<Direction>("under");
  const [phase, setPhase] = useState<Phase>("idle");
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const [recent, setRecent] = useState<{ id: number; roll: number; win: boolean }[]>([]);
  const { hostRef, host, stageRef, ready } = usePixiStage(DICE_W, DICE_H, createDiceStage);

  useEffect(() => {
    if (ready) stageRef.current?.setZone(target, direction);
  }, [ready, target, direction, stageRef]);

  const roll = async () => {
    sfx.click();
    setLast(null);
    let units: bigint;
    try {
      units = parseHroll(amount);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const entry = await hr.play({ game: "dice", amount: units, target, direction }, () => {
      setPhase("rolling");
      stageRef.current?.roll();
    });
    if (entry?.outcome != null && entry.bet) {
      setPhase("revealing");
      try {
        // The animation only replays the on-chain roll; it never decides it.
        await stageRef.current?.reveal(entry.outcome, entry.win);
      } finally {
        setLast(entry);
        setPhase("done");
        setRecent((r) => [{ id: entry.nonce, roll: entry.outcome!, win: entry.win }, ...r].slice(0, 10));
      }
      void celebrate(Number(entry.payout) / Number(entry.bet.amount), host);
    } else {
      stageRef.current?.idle();
      setPhase("idle");
    }
  };

  const edge = hr.house?.houseEdgeBps ?? 100;
  const multiplier = Number(payoutFor(10_000n, target, edge)) / 10_000;
  let profit = "—";
  let stakeOk = false;
  try {
    const units = parseHroll(amount);
    profit = formatHroll(payoutFor(units, target, edge) - units);
    stakeOk = true;
  } catch {}
  const animating = phase === "rolling" || phase === "revealing";
  const locked = animating || hr.busy;
  const rule = direction === "under" ? `< ${fmtRoll(target)}` : `≥ ${fmtRoll(ROLL_RANGE - target)}`;
  const lastMult = last?.bet ? Number(last.payout) / Number(last.bet.amount) : 0;

  const controls = (
    <>
      <AmountInput value={amount} onChange={setAmount} disabled={locked} />
      <Seg
        label="Direction"
        options={["under", "over"] as const}
        value={direction}
        onChange={setDirection}
        disabled={locked}
        render={(d) => (d === "under" ? "Roll under" : "Roll over")}
      />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Multiplier" value={`${multiplier.toFixed(4)}x`} accent="text-gold" />
        <Stat label="Win chance" value={`${(target / 100).toFixed(2)}%`} accent="text-brand" />
        <Stat label="Wins if roll" value={rule} />
        <Stat label="Profit on win" value={profit} accent="text-brand" />
      </div>
      <button
        disabled={hr.busy || animating || !hr.player || hr.player.pending || hr.house?.paused || !stakeOk}
        onClick={roll}
        className="btn-play mt-auto"
      >
        {animating ? "Rolling…" : hr.busy ? "Please wait…" : hr.house?.paused ? "Betting paused" : "Roll dice"}
      </button>
    </>
  );

  return (
    <GameShell
      hr={hr}
      game="dice"
      hold={animating}
      tagline="Pick your odds from 1% to 98%, roll under or over and win up to 99x."
      controls={controls}
      fairness={<>House edge {(edge / 100).toFixed(2)}%. roll = floor(uint32(HMAC_SHA256(serverSeed, clientSeed:nonce)) × 10000 / 2³²).</>}
    >
      <div className="flex min-h-7 flex-wrap justify-end gap-1.5">
        {recent.map((r) => (
          <span
            key={r.id}
            className={`rounded-lg px-2 py-1 font-mono text-xs font-bold animate-[float-up_0.3s_ease-out] ${r.win ? "bg-brand/15 text-brand" : "bg-hot/15 text-hot"}`}
          >
            {fmtRoll(r.roll)}
          </span>
        ))}
      </div>
      <div className="relative">
        <div ref={hostRef} role="img" aria-label={`Dice roll display, wins if roll ${rule}`} className="mx-auto w-full max-w-[640px] aspect-[640/340]" />
      </div>

      <div className="mx-auto mt-2 flex w-full max-w-[640px] flex-col gap-2 px-[7%]">
        <div className="flex justify-between text-sm font-semibold">
          <span className="text-white/60">Win chance</span>
          <span className="font-mono">{(target / 100).toFixed(2)}%</span>
        </div>
        <input
          type="range"
          aria-label="Win chance"
          min={MIN_TARGET}
          max={MAX_TARGET}
          step={50}
          value={target}
          disabled={locked}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="range"
          style={{ ["--fill" as string]: `${target / 100}%`, ...(direction === "over" ? { transform: "scaleX(-1)" } : {}) }}
        />
      </div>

      <div className="mt-3 min-h-8 text-center text-sm text-white/60">
        {phase === "rolling" && "Waiting for the house to reveal the seed…"}
        {phase === "done" && last && (
          <>
            {last.win ? (
              <span className="mr-1 inline-block rounded-lg bg-brand/15 px-3 py-1 font-display text-base font-black text-brand animate-[pop_0.4s_ease-out]">
                {lastMult.toFixed(2)}x · +{formatHroll(last.payout - (last.bet?.amount ?? 0n))} HROLL
              </span>
            ) : <span className="text-hot">Rolled {fmtRoll(last.outcome ?? 0)}, no win</span>} ·{" "}
            <Link href={verifyHref(last)} className="underline hover:text-white">
              verify
            </Link>
          </>
        )}
      </div>
    </GameShell>
  );
}
