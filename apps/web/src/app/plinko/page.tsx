"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PLINKO_RISKS, PLINKO_ROWS, decodePlinkoPath, plinkoMaxPayout, plinkoSlot, plinkoTable, type PlinkoRisk } from "@hashroll/fair";
import { formatHroll, parseHroll, type BetHistoryEntry } from "@hashroll/program";
import { AmountInput, GameShell } from "@/components/GameShell";
import { fmtMultiplier, verifyHref } from "@/lib/format";
import { useHashroll } from "@/lib/useHashroll";

const W = 480;
const TOP = 30;
const BALL_R = 7;

function geometry(rows: number) {
  const gap = (W - 40) / (rows + 2);
  const rowH = gap * 0.86;
  const pegR = Math.max(2.5, gap * 0.09);
  const height = TOP + rows * rowH + 20;
  const pegX = (row: number, j: number) => W / 2 + (j - (row + 2) / 2) * gap;
  const rowY = (row: number) => TOP + row * rowH + rowH * 0.6;
  return { gap, rowH, pegR, height, pegX, rowY };
}

/** Color of a multiplier: cold below 1x, hot for the big ones. */
function slotColor(bps: number) {
  if (bps >= 100_000) return "#f43f5e";
  if (bps >= 30_000) return "#f97316";
  if (bps >= 15_000) return "#f59e0b";
  if (bps >= 10_000) return "#eab308";
  if (bps >= 5_000) return "#84cc16";
  return "#22c55e";
}

type Phase = "idle" | "waiting" | "dropping" | "done";

export default function PlinkoPage() {
  const hr = useHashroll();
  const [amount, setAmount] = useState("1");
  const [rows, setRows] = useState<number>(12);
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [phase, setPhase] = useState<Phase>("idle");
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [hitPeg, setHitPeg] = useState<string | null>(null);
  const [last, setLast] = useState<BetHistoryEntry | null>(null);
  const frame = useRef<number | null>(null);

  const g = geometry(rows);
  const table = plinkoTable(rows, risk);

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stop, []);

  /** The ball bobs at the top until the house reveals the seed. */
  const startWaiting = () => {
    stop();
    setPhase("waiting");
    setLanded(null);
    const tick = (t: number) => {
      setBall({ x: W / 2 + Math.sin(t / 180) * 4, y: TOP - 14 + Math.sin(t / 90) * 2 });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  /** Replays the on-chain path: one bounce per row, left or right as the digest bits say. */
  const drop = (path: number[], rowsUsed: number) => {
    stop();
    setPhase("dropping");
    const geo = geometry(rowsUsed);
    // Contact points: above each peg the ball hits, then the slot.
    const points: { x: number; y: number }[] = [{ x: W / 2, y: TOP - 14 }];
    let k = 0;
    for (let i = 0; i < rowsUsed; i++) {
      points.push({ x: W / 2 + (k - i / 2) * geo.gap, y: geo.rowY(i) - geo.pegR - BALL_R });
      k += path[i];
    }
    points.push({ x: W / 2 + (k - rowsUsed / 2) * geo.gap, y: geo.height - 6 });
    const seg = 1_600 / (rowsUsed + 1);
    const start = performance.now();
    const tick = (t: number) => {
      const elapsed = t - start;
      const i = Math.min(points.length - 2, Math.floor(elapsed / seg));
      const u = Math.min(1, (elapsed - i * seg) / seg);
      const a = points[i];
      const b = points[i + 1];
      // Horizontal drift is linear; vertical is a small hop off the peg then gravity.
      const hop = i === 0 ? 0 : geo.rowH * 0.35;
      setBall({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u * u - hop * Math.sin(Math.PI * u) * (1 - u) });
      if (i >= 1 && u < 0.15) setHitPeg(`${i - 1}`);
      if (elapsed < seg * (points.length - 1)) {
        frame.current = requestAnimationFrame(tick);
      } else {
        setHitPeg(null);
        setLanded(k);
        setPhase("done");
      }
    };
    frame.current = requestAnimationFrame(tick);
  };

  const play = async () => {
    setLast(null);
    let units: bigint;
    try {
      units = parseHroll(amount);
    } catch (e) {
      hr.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const bet = { game: "plinko" as const, amount: units, rows, risk };
    const entry = await hr.play(bet, startWaiting);
    if (entry?.outcome != null && entry.bet) {
      setLast(entry);
      drop(decodePlinkoPath(entry.outcome, entry.bet.rows), entry.bet.rows);
    } else {
      stop();
      setBall(null);
      setPhase("idle");
    }
  };

  let maxWin = "—";
  try {
    maxWin = formatHroll(plinkoMaxPayout(parseHroll(amount), rows, risk));
  } catch {}
  const animating = phase === "waiting" || phase === "dropping";
  const lastSlot = last?.bet && last.outcome != null ? plinkoSlot(decodePlinkoPath(last.outcome, last.bet.rows)) : null;
  // The settled bet's own table: changing rows/risk afterwards must not relabel a paid result.
  const lastTable = last?.bet ? plinkoTable(last.bet.rows, last.bet.risk) : table;
  const locked = animating || hr.busy;

  return (
    <GameShell hr={hr} title="Plinko">
      <section className="rounded-xl border border-white/10 p-4 sm:p-6 flex flex-col gap-5">
        <svg viewBox={`0 0 ${W} ${g.height + 34}`} className="w-full select-none" role="img" aria-label={`Plinko board, ${rows} rows`}>
          {Array.from({ length: rows }, (_, i) =>
            Array.from({ length: i + 3 }, (_, j) => (
              <circle
                key={`${i}-${j}`}
                cx={g.pegX(i, j)}
                cy={g.rowY(i)}
                r={g.pegR}
                className={hitPeg === `${i}` ? "fill-white" : "fill-white/50"}
              />
            )),
          )}
          {table.map((bps, s) => {
            const x = W / 2 + (s - rows / 2) * g.gap;
            const isLanded = phase === "done" && landed === s;
            return (
              <g key={s} transform={`translate(${x}, ${g.height + 4})`}>
                <rect
                  x={-g.gap / 2 + 1.5}
                  width={g.gap - 3}
                  height={24}
                  rx={4}
                  fill={slotColor(bps)}
                  opacity={isLanded ? 1 : 0.75}
                  className={isLanded ? "animate-[pop_0.4s_ease-out]" : ""}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
                <text y={16} textAnchor="middle" fontSize={rows === 16 ? 7.5 : 9.5} fontWeight={700} fill="#0b0f0e" fontFamily="var(--font-geist-mono)">
                  {(bps / 10_000).toLocaleString("en-US", { maximumFractionDigits: bps >= 100_000 ? 0 : 1 })}
                </text>
              </g>
            );
          })}
          {ball && <circle cx={ball.x} cy={ball.y} r={BALL_R} fill="#fbbf24" stroke="#0b0f0e" strokeWidth={1.5} />}
        </svg>

        <div className="text-center text-sm h-5 text-white/60">
          {phase === "waiting" && "Waiting for the house to reveal the seed…"}
          {phase === "done" && last && lastSlot != null && (
            <>
              Slot {lastSlot} · {fmtMultiplier(lastTable[lastSlot] ?? 0)} · paid{" "}
              <span className={last.win ? "text-emerald-400" : "text-amber-300"}>{formatHroll(last.payout)} HROLL</span> ·{" "}
              <Link href={verifyHref(last)} className="underline hover:text-white">verify</Link>
            </>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <AmountInput value={amount} onChange={setAmount} />
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">Risk</span>
            <div className="grid grid-cols-3 rounded border border-white/10 overflow-hidden">
              {PLINKO_RISKS.map((r) => (
                <button key={r} disabled={locked} onClick={() => {
                  setRisk(r);
                  setLanded(null);
                }} className={`py-2 capitalize ${risk === r ? "bg-white/15" : "hover:bg-white/5"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">Rows</span>
            <div className="grid grid-cols-3 rounded border border-white/10 overflow-hidden">
              {PLINKO_ROWS.map((r) => (
                <button
                  key={r}
                  disabled={locked}
                  onClick={() => {
                    setRows(r);
                    setBall(null);
                    setLanded(null);
                    setPhase("idle");
                  }}
                  className={`py-2 ${rows === r ? "bg-white/15" : "hover:bg-white/5"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          disabled={hr.busy || animating || !hr.player || hr.player.pending || hr.house?.paused}
          onClick={play}
          className="rounded-lg bg-amber-400 text-black font-bold py-3 hover:bg-amber-300 disabled:opacity-50"
        >
          {animating ? "Dropping…" : hr.house?.paused ? "Betting paused" : "Drop ball"}
        </button>
        <p className="text-xs text-white/40">
          Max win {maxWin} HROLL ({fmtMultiplier(table[0])}). Each row reads one bit of HMAC_SHA256(serverSeed, clientSeed:nonce): 1 = right.
          The edge is built into the tables (RTP 98.75–98.97%).
        </p>
      </section>
    </GameShell>
  );
}
