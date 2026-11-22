"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ROULETTE_MAX_CHIPS, rouletteColor, rouletteMasks, rouletteMaxPayout, popcount } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry } from "@hashroll/program";
import { GameShell } from "@/components/GameShell";
import { verifyHref } from "@/lib/format";
import { useHashroll } from "@/lib/useHashroll";

/** Pocket order of a European wheel, clockwise from zero. */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SECTOR = 360 / WHEEL.length;
const CHIP_VALUES = ["0.1", "1", "5", "10", "50"];

const FILL = { red: "#dc2626", black: "#18181b", green: "#16a34a" } as const;

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

function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function sectorPath(i: number, r1: number, r2: number) {
  const a0 = i * SECTOR - SECTOR / 2;
  const a1 = a0 + SECTOR;
  const [x0, y0] = polar(r2, a0);
  const [x1, y1] = polar(r2, a1);
  const [x2, y2] = polar(r1, a1);
  const [x3, y3] = polar(r1, a0);
  return `M${x0} ${y0} A${r2} ${r2} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r1} ${r1} 0 0 0 ${x3} ${y3}Z`;
}

type Phase = "idle" | "spinning" | "landing" | "done";

export default function RoulettePage() {
  const hr = useHashroll();
  const [chipValue, setChipValue] = useState("1");
  const [bets, setBets] = useState<Map<string, Spot & { amount: bigint }>>(new Map());
  const [history, setHistory] = useState<string[]>([]); // undo stack of keys
  const [phase, setPhase] = useState<Phase>("idle");
  const [angle, setAngle] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const [lastNumbers, setLastNumbers] = useState<number[]>([]);
  const frame = useRef<number | null>(null);
  const angleRef = useRef(0);

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stop, []);

  const setWheel = (a: number) => {
    angleRef.current = a;
    setAngle(a);
  };

  const startSpinning = () => {
    stop();
    setPhase("spinning");
    setResult(null);
    let prev = performance.now();
    const tick = (t: number) => {
      setWheel(angleRef.current + (t - prev) * 0.45);
      prev = t;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  /** Decelerates the wheel so the on-chain number stops under the pointer. */
  const land = (n: number) => {
    stop();
    setPhase("landing");
    const from = angleRef.current;
    // The wheel rotates by `angle`; pocket i sits at i * SECTOR, so it is on top when angle ≡ -i * SECTOR.
    const targetMod = (360 - WHEEL.indexOf(n) * SECTOR) % 360;
    const base = from - (((from % 360) + 360) % 360);
    let to = base + targetMod + 360 * 3;
    if (to - from < 720) to += 360;
    const start = performance.now();
    const duration = 3_000;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setWheel(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) frame.current = requestAnimationFrame(tick);
      else {
        setResult(n);
        setPhase("done");
        setLastNumbers((l) => [n, ...l].slice(0, 12));
      }
    };
    frame.current = requestAnimationFrame(tick);
  };

  const add = (spot: Spot) => {
    hr.setError(null);
    let units: bigint;
    try {
      units = parseHroll(chipValue);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBets((prev) => {
      const next = new Map(prev);
      const cur = next.get(spot.key);
      if (!cur && next.size >= ROULETTE_MAX_CHIPS) {
        hr.setError(`At most ${ROULETTE_MAX_CHIPS} different bets per spin (on-chain limit).`);
        return prev;
      }
      next.set(spot.key, { ...spot, amount: (cur?.amount ?? 0n) + units });
      return next;
    });
    setHistory((h) => [...h, `${spot.key}:${units}`]);
  };

  const undo = () => {
    const lastKey = history.at(-1);
    if (!lastKey) return;
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
    setLast(null);
    if (chips.length === 0) {
      hr.setError("Place at least one chip on the table.");
      return;
    }
    const entry = await hr.play({ game: "roulette", chips }, startSpinning);
    if (entry?.outcome != null) {
      setLast(entry);
      land(entry.outcome);
    } else {
      stop();
      setPhase("idle");
    }
  };

  const winning = (mask: bigint) => phase === "done" && result !== null && ((mask >> BigInt(result)) & 1n) === 1n;

  const cell = (spot: Spot, className = "", color?: string) => {
    const bet = bets.get(spot.key);
    return (
      <button
        key={spot.key}
        disabled={locked}
        onClick={() => add(spot)}
        className={`relative flex items-center justify-center border border-white/15 text-xs sm:text-sm font-semibold hover:brightness-125 disabled:cursor-not-allowed ${
          winning(spot.mask) ? "ring-2 ring-yellow-300 z-10" : ""
        } ${className}`}
        style={color ? { backgroundColor: color } : undefined}
        title={`${spot.label}: pays ${(36 / popcount(spot.mask)).toFixed(popcount(spot.mask) === 36 ? 0 : 2).replace(/\.00$/, "")}x`}
      >
        {spot.label}
        {bet && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-yellow-300 text-black text-[10px] leading-5 font-mono shadow">
            {formatHroll(bet.amount, 1)}
          </span>
        )}
      </button>
    );
  };

  return (
    <GameShell hr={hr} title="Roulette">
      <section className="rounded-xl border border-white/10 p-4 sm:p-6 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-56 h-56 shrink-0">
            <svg viewBox="0 0 200 200" className="w-full h-full" role="img" aria-label="European roulette wheel">
              <circle cx={100} cy={100} r={98} fill="#3f2a14" />
              <g transform={`rotate(${angle} 100 100)`}>
                {WHEEL.map((n, i) => {
                  const [tx, ty] = polar(82, i * SECTOR);
                  return (
                    <g key={n}>
                      <path d={sectorPath(i, 62, 94)} fill={FILL[rouletteColor(n)]} stroke="#d4a373" strokeWidth={0.4} />
                      <text x={tx} y={ty} fontSize={7} fill="white" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-geist-mono)" transform={`rotate(${i * SECTOR} ${tx} ${ty})`}>
                        {n}
                      </text>
                    </g>
                  );
                })}
                <circle cx={100} cy={100} r={62} fill="#2b1d0e" stroke="#d4a373" strokeWidth={1} />
                {[0, 45, 90, 135].map((a) => (
                  <line key={a} x1={polar(40, a)[0]} y1={polar(40, a)[1]} x2={polar(40, a + 180)[0]} y2={polar(40, a + 180)[1]} stroke="#d4a373" strokeWidth={2} />
                ))}
              </g>
              <polygon points="100,3 94,-6 106,-6" transform="translate(0 6)" fill="#fde047" />
              {phase === "done" && result !== null && <circle cx={100} cy={16} r={4.5} fill="white" />}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center font-mono text-2xl font-bold ${
                  result !== null && phase === "done" ? "animate-[pop_0.4s_ease-out]" : ""
                }`}
                style={{ backgroundColor: result !== null && phase === "done" ? FILL[rouletteColor(result)] : "transparent" }}
              >
                {phase === "done" && result !== null ? result : ""}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-3 w-full">
            <div className="text-sm text-white/60 min-h-5">
              {phase === "spinning" && "Waiting for the house to reveal the seed…"}
              {phase === "landing" && "No more bets…"}
              {phase === "done" && last && (
                <>
                  {last.payout > 0n ? (
                    <span className={last.win ? "text-emerald-400" : "text-amber-300"}>Paid {formatHroll(last.payout)} HROLL</span>
                  ) : (
                    <span className="text-rose-400">No winning chips</span>
                  )}{" "}
                  · <Link href={verifyHref(last)} className="underline hover:text-white">verify</Link>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {lastNumbers.map((n, i) => (
                <span key={i} className="w-7 h-7 rounded-full text-xs font-mono flex items-center justify-center" style={{ backgroundColor: FILL[rouletteColor(n)] }}>
                  {n}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-white/60">Chip value (HROLL)</span>
              <div className="flex gap-2 flex-wrap">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setChipValue(v)}
                    className={`w-11 h-11 rounded-full border-4 border-dashed font-mono text-xs font-bold ${
                      chipValue === v ? "border-yellow-300 bg-yellow-300/20 text-yellow-200" : "border-white/30 hover:border-white/60"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Betting table */}
        <div className="overflow-x-auto">
          <div className="min-w-[560px] grid gap-0.5" style={{ gridTemplateColumns: "2.5rem repeat(12, minmax(0, 1fr)) 2.5rem" }}>
            {cell(straight(0), "row-span-3 rounded-l-md", FILL.green)}
            {[3, 2, 1].map((offset, row) => (
              <div key={row} className="contents">
                {Array.from({ length: 12 }, (_, c) => {
                  const n = c * 3 + offset;
                  return cell(straight(n), "h-10", FILL[rouletteColor(n)]);
                })}
                {cell(COLUMNS[row], "h-10 bg-emerald-900/60")}
              </div>
            ))}
            <div />
            {DOZENS.map((d) => cell(d, "col-span-4 h-9 bg-emerald-900/60"))}
            <div />
            <div />
            {OUTSIDE.map((o) => cell(o, "col-span-2 h-9", o.key === "red" ? FILL.red : o.key === "black" ? FILL.black : "rgb(6 78 59 / 0.6)"))}
            <div />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="font-mono text-white/70">
            Stake {formatHroll(total)} HROLL · {bets.size}/{ROULETTE_MAX_CHIPS} bets · max win {formatHroll(maxWin)} HROLL
          </div>
          <div className="flex gap-2">
            <button disabled={locked || history.length === 0} onClick={undo} className="rounded border border-white/20 px-3 py-1.5 hover:bg-white/5 disabled:opacity-40">
              Undo
            </button>
            <button
              disabled={locked || bets.size === 0}
              onClick={() => {
                setBets(new Map());
                setHistory([]);
              }}
              className="rounded border border-white/20 px-3 py-1.5 hover:bg-white/5 disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <button
          disabled={hr.busy || animating || !hr.player || hr.player.pending || hr.house?.paused || total === 0n}
          onClick={spin}
          className="rounded-lg bg-rose-500 text-white font-bold py-3 hover:bg-rose-400 disabled:opacity-50"
        >
          {animating ? "Spinning…" : hr.house?.paused ? "Betting paused" : total === 0n ? "Place your chips" : `Spin for ${formatHroll(total)} HROLL`}
        </button>
        <p className="text-xs text-white/40">
          European single-zero wheel: number = floor(uint32(HMAC_SHA256(serverSeed, clientSeed:nonce)) × 37 / 2³²). Every chip pays 36 / (numbers
          covered), so every bet has the classic 2.70% edge. Your chips stay on the table between spins.
        </p>
      </section>
    </GameShell>
  );
}
