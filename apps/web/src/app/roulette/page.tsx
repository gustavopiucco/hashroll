"use client";

import { useState } from "react";
import Link from "next/link";
import { ROULETTE_MAX_CHIPS, rouletteColor, rouletteMasks, rouletteMaxPayout, popcount } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { Stat, WinBanner } from "@/components/ui";
import { ROULETTE_SIZE, createRouletteStage } from "@/games/rouletteStage";
import { usePixiStage } from "@/games/usePixiStage";
import { celebrate } from "@/lib/effects";
import { resultDetail, verifyHref } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useHashroll } from "@/lib/useHashroll";

/** Chip denominations and their colors. */
const CHIPS = [
  { value: "0.1", color: "#8b93b8" },
  { value: "1", color: "#16b364" },
  { value: "5", color: "#e11d48" },
  { value: "10", color: "#2f6bff" },
  { value: "50", color: "#f5a524" },
];

const FILL = { red: "#d61f3c", black: "#1a1a24", green: "#14a85a" } as const;
const FELT = "#0d5a3c";

interface Spot {
  key: string;
  label: string;
  mask: bigint;
}

const straight = (n: number): Spot => ({ key: `n${n}`, label: String(n), mask: rouletteMasks.straight(n) });
const OUTSIDE: Spot[] = [
  { key: "low", label: "1–18", mask: rouletteMasks.low() },
  { key: "even", label: "Even", mask: rouletteMasks.even() },
  { key: "red", label: "Red", mask: rouletteMasks.red() },
  { key: "black", label: "Black", mask: rouletteMasks.black() },
  { key: "odd", label: "Odd", mask: rouletteMasks.odd() },
  { key: "high", label: "19–36", mask: rouletteMasks.high() },
];
const DOZENS: Spot[] = [0, 1, 2].map((i) => ({ key: `dozen${i}`, label: ["1st 12", "2nd 12", "3rd 12"][i], mask: rouletteMasks.dozen(i) }));
/** Board rows top to bottom: 3, 6, …, 36 / 2, 5, …, 35 / 1, 4, …, 34; the column bet sits at the end of each row. */
const COLUMNS: Spot[] = [2, 1, 0].map((i) => ({ key: `col${i}`, label: "2:1", mask: rouletteMasks.column(i) }));

type Phase = "idle" | "spinning" | "landing" | "done";

/** Color of the largest denomination that fits in the stacked amount. */
const chipColor = (amount: bigint) => CHIPS.findLast((c) => parseHroll(c.value) <= amount)?.color ?? CHIPS[0].color;

/** Total stake of a settled roulette bet. */
const stakeOf = (b: BetHistoryEntry | null) => (b?.bet?.game === "roulette" ? b.bet.chips.reduce((s, c) => s + c.amount, 0n) : 0n);

function ChipToken({ color, label, size = "h-11 w-11 text-xs" }: { color: string; label: string; size?: string }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full font-display font-black text-white ${size}`}
      style={{
        background: `repeating-conic-gradient(${color} 0 30deg, #ffffff 30deg 45deg)`,
        boxShadow: "0 3px 0 rgb(0 0 0 / 0.45), 0 0 0 1px rgb(0 0 0 / 0.3)",
      }}
    >
      <span className="absolute inset-[18%] rounded-full border-2 border-dashed border-white/70" style={{ background: color }} />
      <span className="relative drop-shadow">{label}</span>
    </span>
  );
}

export default function RoulettePage() {
  const hr = useHashroll();
  const [chipValue, setChipValue] = useState("1");
  const [bets, setBets] = useState<Map<string, Spot & { amount: bigint }>>(new Map());
  const [history, setHistory] = useState<string[]>([]); // undo stack of keys
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<number | null>(null);
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const [lastNumbers, setLastNumbers] = useState<{ id: number; n: number }[]>([]);
  const { hostRef, host, stageRef } = usePixiStage(ROULETTE_SIZE, ROULETTE_SIZE, createRouletteStage);

  const add = (spot: Spot) => {
    hr.setError(null);
    let units: bigint;
    try {
      units = parseHroll(chipValue);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!bets.has(spot.key) && bets.size >= ROULETTE_MAX_CHIPS) {
      hr.setError(`At most ${ROULETTE_MAX_CHIPS} different bets per spin (on-chain limit).`);
      return;
    }
    sfx.chip();
    setBets((prev) => {
      const next = new Map(prev);
      const cur = next.get(spot.key);
      next.set(spot.key, { ...spot, amount: (cur?.amount ?? 0n) + units });
      return next;
    });
    setHistory((h) => [...h, `${spot.key}:${units}`]);
  };

  const undo = () => {
    const lastKey = history.at(-1);
    if (!lastKey) return;
    sfx.click();
    const [key, units] = lastKey.split(":");
    setBets((prev) => {
      const next = new Map(prev);
      const cur = next.get(key);
      if (cur) {
        const amount = cur.amount - BigInt(units);
        if (amount > 0n) next.set(key, { ...cur, amount });
        else next.delete(key);
      }
      return next;
    });
    setHistory((h) => h.slice(0, -1));
  };

  const chips = [...bets.values()].map((b) => ({ mask: b.mask, amount: b.amount }));
  const total = chips.reduce((s, c) => s + c.amount, 0n);
  const maxWin = rouletteMaxPayout(chips);
  const animating = phase === "spinning" || phase === "landing";
  const locked = animating || hr.busy; // the table must not change between signing and the result

  const spin = async () => {
    sfx.click();
    setLast(null);
    if (chips.length === 0) {
      hr.setError("Place at least one chip on the table.");
      return;
    }
    const entry = await hr.play({ game: "roulette", chips }, () => {
      setPhase("spinning");
      setResult(null);
      stageRef.current?.spin();
    });
    if (entry?.outcome != null && entry.bet) {
      const n = entry.outcome;
      setPhase("landing");
      try {
        // The wheel only replays the on-chain number; it never decides it.
        await stageRef.current?.land(n);
      } finally {
        setLast(entry);
        setResult(n);
        setPhase("done");
        setLastNumbers((l) => [{ id: entry.nonce, n }, ...l].slice(0, 14));
      }
      void celebrate(Number(entry.payout) / Number(stakeOf(entry) || 1n), host);
    } else {
      stageRef.current?.idle();
      setPhase("idle");
    }
  };

  const winning = (mask: bigint) => phase === "done" && result !== null && ((mask >> BigInt(result)) & 1n) === 1n;

  const cell = (spot: Spot, className = "", color?: string) => {
    const bet = bets.get(spot.key);
    const win = winning(spot.mask);
    return (
      <button
        key={spot.key}
        disabled={locked}
        onClick={() => add(spot)}
        className={`relative flex items-center justify-center rounded-md text-xs sm:text-sm font-bold shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] transition hover:brightness-125 hover:-translate-y-px disabled:cursor-not-allowed ${
          win ? "z-10 ring-2 ring-gold shadow-[0_0_20px_rgb(255_200_61/0.7)] animate-[pop_0.5s_ease-out]" : ""
        } ${className}`}
        style={{ backgroundColor: color ?? "rgb(255 255 255 / 0.06)" }}
        title={`${spot.label}: pays ${(36 / popcount(spot.mask)).toFixed(popcount(spot.mask) === 36 ? 0 : 2).replace(/\.00$/, "")}x`}
      >
        {spot.label}
        {bet && (
          <span className="absolute -top-2 -right-2 z-10 animate-[pop_0.25s_ease-out]">
            <ChipToken color={chipColor(bet.amount)} label={formatHroll(bet.amount, 1)} size="h-7 w-7 text-[9px]" />
          </span>
        )}
      </button>
    );
  };

  const controls = (
    <>
      <div className="flex flex-col gap-2">
        <span className="field-label">Chip value</span>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={chipValue === c.value}
              onClick={() => {
                sfx.chip();
                setChipValue(c.value);
              }}
              className={`rounded-full transition ${chipValue === c.value ? "-translate-y-1 ring-2 ring-white/80 ring-offset-2 ring-offset-panel" : "opacity-75 hover:opacity-100 hover:-translate-y-0.5"}`}
            >
              <ChipToken color={c.color} label={c.value} />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total stake" value={formatHroll(total)} accent="text-gold" />
        <Stat label="Max win" value={formatHroll(maxWin)} accent="text-brand" />
        <Stat label="Bets" value={`${bets.size} / ${ROULETTE_MAX_CHIPS}`} />
        <div className="grid grid-cols-2 gap-1">
          <button disabled={locked || history.length === 0} onClick={undo} className="rounded-xl border border-line bg-black/25 text-sm font-semibold hover:bg-white/5 disabled:opacity-40">
            Undo
          </button>
          <button
            disabled={locked || bets.size === 0}
            onClick={() => {
              sfx.click();
              setBets(new Map());
              setHistory([]);
            }}
            className="rounded-xl border border-line bg-black/25 text-sm font-semibold hover:bg-white/5 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>
      <button
        disabled={hr.busy || animating || !hr.player || hr.player.pending || hr.house?.paused || total === 0n}
        onClick={spin}
        className="btn-play mt-auto"
        style={{ ["--btn" as string]: "var(--hot)", color: "white" }}
      >
        {animating ? "Spinning…" : hr.busy ? "Please wait…" : hr.house?.paused ? "Betting paused" : total === 0n ? "Place your chips" : `Spin · ${formatHroll(total)} HROLL`}
      </button>
    </>
  );

  return (
    <GameShell
      hr={hr}
      game="roulette"
      hold={animating}
      tagline="European single-zero wheel. Place up to 8 bets per spin, straight numbers pay 36x."
      controls={controls}
      fairness={
        <>
          number = floor(uint32(HMAC_SHA256(serverSeed, clientSeed:nonce)) × 37 / 2³²). Every chip pays 36 / (numbers covered), so every bet has the
          classic 2.70% edge. Your chips stay on the table between spins.
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-full max-w-[380px]">
          <div ref={hostRef} role="img" aria-label="European roulette wheel" className="aspect-square w-full" />
          <WinBanner
            show={phase === "done" && !!last && last.payout > 0n}
            win={!!last?.win}
            multiplier={`${(Number(last?.payout ?? 0n) / Number(stakeOf(last) || 1n)).toFixed(2)}x`}
            detail={last ? resultDetail(stakeOf(last), last.payout, formatHroll) : ""}
          />
        </div>

        <div className="flex min-h-7 flex-wrap justify-center gap-1.5">
          {lastNumbers.map(({ id, n }, i) => (
            <span
              key={id}
              className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-xs font-bold shadow animate-[float-up_0.3s_ease-out] ${i === 0 ? "ring-2 ring-gold" : "opacity-80"}`}
              style={{ backgroundColor: FILL[rouletteColor(n)] }}
            >
              {n}
            </span>
          ))}
        </div>

        <div className="h-5 text-center text-sm text-white/60">
          {phase === "spinning" && "Waiting for the house to reveal the seed…"}
          {phase === "landing" && "No more bets…"}
          {phase === "done" && last && (
            <>
              {last.payout > 0n ? (
                <span className={last.win ? "text-brand" : "text-gold"}>Paid {formatHroll(last.payout)} HROLL</span>
              ) : (
                <span className="text-hot">No winning chips</span>
              )}{" "}
              ·{" "}
              <Link href={verifyHref(last)} className="underline hover:text-white">
                verify
              </Link>
            </>
          )}
        </div>

        {/* Betting table */}
        <div className="w-full overflow-x-auto rounded-2xl p-3" style={{ background: `radial-gradient(ellipse at center, #137a52, ${FELT})`, boxShadow: "inset 0 0 0 3px #c98a2e, inset 0 0 40px rgb(0 0 0 / 0.5)" }}>
          <div className="min-w-[560px] grid gap-1 pt-2 pr-2" style={{ gridTemplateColumns: "2.75rem repeat(12, minmax(0, 1fr)) 2.75rem" }}>
            {cell(straight(0), "row-span-3", FILL.green)}
            {[3, 2, 1].map((offset, row) => (
              <div key={row} className="contents">
                {Array.from({ length: 12 }, (_, c) => {
                  const n = c * 3 + offset;
                  return cell(straight(n), "h-11", FILL[rouletteColor(n)]);
                })}
                {cell(COLUMNS[row], "h-11")}
              </div>
            ))}
            <div />
            {DOZENS.map((d) => cell(d, "col-span-4 h-10"))}
            <div />
            <div />
            {OUTSIDE.map((o) => cell(o, "col-span-2 h-10", o.key === "red" ? FILL.red : o.key === "black" ? FILL.black : undefined))}
            <div />
          </div>
        </div>
      </div>
    </GameShell>
  );
}
