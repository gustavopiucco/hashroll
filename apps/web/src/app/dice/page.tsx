"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MAX_TARGET, MIN_TARGET, ROLL_RANGE, payoutFor } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry, type Direction } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { AmountInput, Seg, Stat } from "@/components/ui";
import { useThreeStage } from "@/games/useThreeStage";
import { celebrate } from "@/lib/effects";
import { fmtRoll, verifyHref } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useHashroll } from "@/lib/useHashroll";

/** Gross multipliers offered as one-click odds. */
const PRESETS = [1.1, 1.5, 2, 5, 10];

const loadStage = () => import("@/games/diceStage").then((m) => m.createDiceStage);

type Phase = "idle" | "rolling" | "revealing" | "done";

export default function DicePage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [target, setTarget] = useState(4950);
  const [direction, setDirection] = useState<Direction>("under");
  const [phase, setPhase] = useState<Phase>("idle");
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const [recent, setRecent] = useState<{ id: number; roll: number; win: boolean }[]>([]);
  const { hostRef, host, stageRef, ready, failed } = useThreeStage(loadStage);

  const edge = hr.house?.houseEdgeBps ?? 100;
  const multiplier = Number(payoutFor(10_000n, target, edge)) / 10_000;
  const animating = phase === "rolling" || phase === "revealing";
  const locked = animating || hr.busy;

  // New odds make the previous result message stale.
  const clearResult = useCallback(() => {
    setLast(null);
    setPhase("idle");
  }, []);
  const changeTarget = useCallback(
    (t: number) => {
      setTarget(t);
      clearResult();
    },
    [clearResult],
  );

  useEffect(() => {
    if (ready) stageRef.current?.setZone(target, direction, `WIN ${multiplier.toFixed(2)}×`);
  }, [ready, target, direction, multiplier, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage) return;
    stage.onTarget = changeTarget;
    stage.setLocked(locked);
  }, [ready, locked, changeTarget, stageRef]);

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

  let profit = "—";
  let stakeOk = false;
  try {
    const units = parseHroll(amount);
    profit = formatHroll(payoutFor(units, target, edge) - units);
    stakeOk = true;
  } catch {}
  // The gate's position on the 0–100 lane; the win zone is on its left (under) or right (over).
  const split = direction === "under" ? target : ROLL_RANGE - target;
  const rule = direction === "under" ? `< ${fmtRoll(split)}` : `≥ ${fmtRoll(split)}`;
  const presets = PRESETS.map((m) => Math.max(MIN_TARGET, Math.min(MAX_TARGET, Math.round((10_000 - edge) / m))));
  const lastMult = last?.bet ? Number(last.payout) / Number(last.bet.amount) : 0;

  const controls = (
    <>
      <AmountInput value={amount} onChange={setAmount} disabled={locked} />
      <Seg
        label="Direction"
        options={["under", "over"] as const}
        value={direction}
        onChange={(d) => {
          setDirection(d);
          clearResult();
        }}
        disabled={locked}
        render={(d) => (d === "under" ? `◀ Under ${fmtRoll(target)}` : `Over ${fmtRoll(ROLL_RANGE - target)} ▶`)}
      />
      <Seg
        label="Quick payout"
        options={presets}
        value={target}
        onChange={changeTarget}
        disabled={locked}
        render={(t) => `${PRESETS[presets.indexOf(t)]}x`}
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
      <p className="mt-1 text-balance text-center text-sm text-white/60">
        Land on <span className="font-bold text-brand">green</span> ({direction === "under" ? "below" : "at or above"}{" "}
        <span className="font-mono text-white">{fmtRoll(split)}</span>) and win{" "}
        <span className="font-bold text-gold">{multiplier.toFixed(2)}x</span> your bet
      </p>
      {!failed && (
        <div
          ref={hostRef}
          role="img"
          aria-label={`Dice lane from 0 to 100, wins if roll ${rule}`}
          className="relative mx-auto mt-3 aspect-[5/4] w-full max-w-[820px] select-none sm:aspect-[2/1]"
        />
      )}

      {/* Keyboard and screen-reader control for the gate; the only slider when WebGL is unavailable. */}
      <input
        type="range"
        aria-label="Gate position"
        aria-valuetext={`${(target / 100).toFixed(2)}% win chance, wins if roll ${rule}`}
        min={direction === "under" ? MIN_TARGET : ROLL_RANGE - MAX_TARGET}
        max={direction === "under" ? MAX_TARGET : ROLL_RANGE - MIN_TARGET}
        step={50}
        value={split}
        disabled={locked}
        onChange={(e) => {
          const s = Number(e.target.value);
          changeTarget(direction === "under" ? s : ROLL_RANGE - s);
        }}
        onFocus={() => stageRef.current?.setFocused(true)}
        onBlur={() => stageRef.current?.setFocused(false)}
        className={failed ? "range my-6" : "sr-only"}
        style={{
          ["--fill" as string]: `${split / 100}%`,
          ...(direction === "over" ? { ["--from" as string]: "var(--hot)", ["--to" as string]: "var(--brand)" } : {}),
        }}
      />

      <div className="mt-3 min-h-8 text-center text-sm text-white/60">
        {phase === "idle" && !locked && !failed && "Drag the gate or tap the lane to set your odds"}
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
