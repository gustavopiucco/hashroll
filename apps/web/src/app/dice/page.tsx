"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ROLL_RANGE, payoutFor } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry, type Direction } from "@hashroll/program";
import { AmountInput, GameShell } from "@/components/GameShell";
import { fmtRoll, verifyHref } from "@/lib/format";
import { useHashroll } from "@/lib/useHashroll";

type Phase = "idle" | "rolling" | "revealing" | "done";

export default function DicePage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [target, setTarget] = useState(4950);
  const [direction, setDirection] = useState<Direction>("under");
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState<number | null>(null); // number on the display (0..9999)
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const frame = useRef<number | null>(null);

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stop, []);

  /** Shuffles random numbers while the house has not revealed the seed yet. */
  const startRolling = () => {
    stop();
    setPhase("rolling");
    let t0 = 0;
    const tick = (t: number) => {
      if (t - t0 > 50) {
        setShown(Math.floor(Math.random() * ROLL_RANGE));
        t0 = t;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  /** Eases the display to the on-chain roll. The animation only replays the result; it never decides it. */
  const reveal = (roll: number) => {
    stop();
    setPhase("revealing");
    const from = Math.floor(Math.random() * ROLL_RANGE);
    const start = performance.now();
    const duration = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      setShown(Math.round(from + (roll - from) * eased));
      if (k < 1) frame.current = requestAnimationFrame(tick);
      else setPhase("done");
    };
    frame.current = requestAnimationFrame(tick);
  };

  const roll = async () => {
    setLast(null);
    let units: bigint;
    try {
      units = parseHroll(amount);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const entry = await hr.play({ game: "dice", amount: units, target, direction }, startRolling);
    if (entry?.outcome != null) {
      reveal(entry.outcome);
      setLast(entry);
    } else {
      stop();
      setPhase("idle");
    }
  };

  const edge = hr.house?.houseEdgeBps ?? 100;
  let multiplier = "—";
  let profit = "—";
  try {
    multiplier = (Number(payoutFor(10_000n, target, edge)) / 10_000).toFixed(4) + "x";
    const units = parseHroll(amount);
    profit = formatHroll(payoutFor(units, target, edge) - units);
  } catch {}

  // Winning zone on the 0..100 bar.
  const zoneStart = direction === "under" ? 0 : (ROLL_RANGE - target) / 100;
  const zoneWidth = target / 100;
  const settled = phase === "done" && last;
  const color = settled ? (last.win ? "text-emerald-400" : "text-rose-400") : phase === "idle" ? "text-white/30" : "text-white";

  return (
    <GameShell hr={hr} title="Dice">
      <section className="rounded-xl border border-white/10 p-6 flex flex-col gap-6">
        <div className="text-center">
          <div className={`font-mono text-7xl tabular-nums transition-colors ${color} ${settled && last.win ? "animate-[pop_0.4s_ease-out]" : ""}`}>
            {shown != null ? fmtRoll(shown) : "00.00"}
          </div>
          <div className="text-sm text-white/60 h-5 mt-1">
            {phase === "rolling" && "Waiting for the house to reveal the seed…"}
            {settled && (
              <>
                {last.win ? `Won ${formatHroll(last.payout)} HROLL` : "Lost"} ·{" "}
                <Link href={verifyHref(last)} className="underline hover:text-white">verify</Link>
              </>
            )}
          </div>
        </div>

        {/* Result bar: green = winning zone, the marker slides to the roll. */}
        <div className="relative h-3 rounded-full bg-rose-500/30 mt-4">
          <div className="absolute inset-y-0 rounded-full bg-emerald-500/60 transition-all duration-300" style={{ left: `${zoneStart}%`, width: `${zoneWidth}%` }} />
          {shown != null && phase !== "idle" && (
            <div
              className={`absolute -top-7 -translate-x-1/2 flex flex-col items-center ${phase === "rolling" ? "" : "transition-[left] duration-150"}`}
              style={{ left: `${shown / 100}%` }}
            >
              <span className={`text-[10px] font-mono px-1 rounded ${settled ? (last.win ? "bg-emerald-500 text-black" : "bg-rose-500 text-black") : "bg-white text-black"}`}>
                {fmtRoll(shown)}
              </span>
              <span className="w-0.5 h-5 bg-white" />
            </div>
          )}
          <div className="absolute -bottom-5 inset-x-0 flex justify-between text-[10px] text-white/40 font-mono">
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
        </div>

        <label className="flex flex-col gap-2 text-sm mt-4">
          <span className="flex justify-between text-white/60">
            <span>Win chance: {(target / 100).toFixed(2)}%</span>
            <span>Multiplier: {multiplier}</span>
          </span>
          <input type="range" min={100} max={9800} step={50} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="accent-emerald-400" />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <AmountInput value={amount} onChange={setAmount} />
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">
              Wins if roll {direction === "under" ? `< ${fmtRoll(target)}` : `≥ ${fmtRoll(ROLL_RANGE - target)}`} · profit {profit}
            </span>
            <div className="grid grid-cols-2 rounded border border-white/10 overflow-hidden">
              {(["under", "over"] as const).map((d) => (
                <button key={d} onClick={() => setDirection(d)} className={`py-2 ${direction === d ? "bg-white/15" : "hover:bg-white/5"}`}>
                  {d === "under" ? "Roll under" : "Roll over"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          disabled={hr.busy || phase === "revealing" || !hr.player || hr.player.pending || hr.house?.paused}
          onClick={roll}
          className="rounded-lg bg-emerald-500 text-black font-bold py-3 hover:bg-emerald-400 disabled:opacity-50"
        >
          {hr.busy ? "Rolling…" : hr.house?.paused ? "Betting paused" : "Roll"}
        </button>
        <p className="text-xs text-white/40">
          House edge {(edge / 100).toFixed(2)}%. roll = floor(uint32(HMAC_SHA256(serverSeed, clientSeed:nonce)) × 10000 / 2³²).
        </p>
      </section>
    </GameShell>
  );
}
