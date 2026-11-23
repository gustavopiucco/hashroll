"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  ROLL_RANGE,
  computeDigest,
  digestToPlinkoPath,
  digestToRoll,
  digestToRouletteNumber,
  digestToSlotGrid,
  SLOT_SYMBOLS,
  SLOT_LINES,
  BPS,
  slotWins,
  plinkoSlot,
  plinkoTable,
  rouletteColor,
  verifyCommitment,
  type PlinkoRisk,
} from "@hashroll/fair";
import { fmtMultiplier, fmtRoll, GAME_LABEL } from "@/lib/format";
import { GAMES, type Game } from "@hashroll/program";
import { SlotIcon } from "@/components/SlotIcon";

/**
 * 100% client-side verifier: uses exactly the same code as the on-chain program's specification
 * (packages/fair), without calling the API. The "verify" links in the history pre-fill it.
 */
export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Verify a bet</h1>
      <div className="text-sm text-white/60 flex flex-col gap-1 font-mono">
        <div>digest = HMAC_SHA256(serverSeed, clientSeed + &quot;:&quot; + nonce), n = uint32(digest[0..4])</div>
        <div>Dice: roll = floor(n × 10000 / 2³²) / 100</div>
        <div>Roulette: number = floor(n × 37 / 2³²)</div>
        <div>Plinko: row i goes right iff bit i of the digest is 1; slot = right bounces</div>
        <div>Slots: cell i of the 3×3 grid reads byte i of the digest; the symbol is the first whose cumulative weight exceeds it</div>
      </div>
      <p className="text-sm text-white/60">
        Each bet uses its own server seed. Its hash was stored on-chain before you bet, and the program refused to settle unless the revealed seed
        matched it.
      </p>
      <Suspense fallback={<p className="text-sm text-white/40">Loading…</p>}>
        <VerifyForm />
      </Suspense>
    </div>
  );
}

function VerifyForm() {
  const params = useSearchParams();
  const [game, setGame] = useState<Game>(GAMES.find((g) => g === params.get("game")) ?? "dice");
  const [serverSeed, setServerSeed] = useState(params.get("serverSeed") ?? "");
  const [commitment, setCommitment] = useState(params.get("commitment") ?? "");
  const [clientSeed, setClientSeed] = useState(params.get("clientSeed") ?? "");
  const [nonce, setNonce] = useState(params.get("nonce") ?? "0");
  const [rows, setRows] = useState(Number(params.get("rows") ?? 12));
  const [risk, setRisk] = useState<PlinkoRisk>((params.get("risk") as PlinkoRisk) ?? "medium");
  const target = Number(params.get("target") ?? NaN);
  const direction = params.get("direction");

  const out = useMemo(() => {
    if (!serverSeed || !clientSeed) return null;
    try {
      const digest = computeDigest(serverSeed, clientSeed, Number(nonce));
      return { digest, ok: commitment ? verifyCommitment(serverSeed, commitment) : null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [serverSeed, commitment, clientSeed, nonce]);

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-white/60">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value.trim())} className="rounded bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs" />
    </label>
  );

  const toggle = <T extends string | number>(options: readonly T[], value: T, set: (v: T) => void, label = (v: T) => String(v)) => (
    <div className="flex rounded border border-white/10 overflow-hidden text-sm">
      {options.map((o) => (
        <button key={String(o)} onClick={() => set(o)} className={`px-3 py-1.5 capitalize ${value === o ? "bg-white/15" : "hover:bg-white/5"}`}>
          {label(o)}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center">
        {toggle(GAMES, game, setGame, (g) => GAME_LABEL[g])}
        {game === "plinko" && (
          <>
            {toggle(PLINKO_ROWS, rows as (typeof PLINKO_ROWS)[number], setRows, (r) => `${r} rows`)}
            {toggle(PLINKO_RISKS, risk, setRisk)}
          </>
        )}
      </div>
      {field("Server seed (revealed)", serverSeed, setServerSeed)}
      {field("Server seed hash committed before the bet (optional)", commitment, setCommitment)}
      {field("Client seed", clientSeed, setClientSeed)}
      {field("Nonce", nonce, setNonce)}
      {out && "error" in out && <p className="text-rose-400 text-sm">{out.error}</p>}
      {out && "digest" in out && out.digest && (
        <div className="rounded-xl border border-white/10 p-4 font-mono text-sm flex flex-col gap-2 break-all">
          <div className="text-white/60">HMAC: {out.digest}</div>
          <Outcome game={game} digest={out.digest} rows={rows} risk={risk} target={target} direction={direction} />
          {out.ok !== null && (
            <div className={out.ok ? "text-emerald-400" : "text-rose-400"}>
              {out.ok ? "✓ SHA256(serverSeed) matches the committed hash" : "✗ Hash does NOT match: seed tampered with"}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Outcome(props: { game: Game; digest: string; rows: number; risk: PlinkoRisk; target: number; direction: string | null }) {
  const { game, digest } = props;
  if (game === "dice") {
    const roll = digestToRoll(digest);
    const { target, direction } = props;
    const hasBet = Number.isInteger(target) && (direction === "under" || direction === "over");
    const win = hasBet && (direction === "under" ? roll < target : roll >= ROLL_RANGE - target);
    return (
      <div>
        <div className="text-4xl">{fmtRoll(roll)}</div>
        {hasBet && (
          <div className={win ? "text-emerald-400" : "text-rose-400"}>
            bet: roll {direction === "under" ? `< ${fmtRoll(target)}` : `≥ ${fmtRoll(ROLL_RANGE - target)}`} → {win ? "win" : "loss"}
          </div>
        )}
      </div>
    );
  }
  if (game === "roulette") {
    const n = digestToRouletteNumber(digest);
    return (
      <div className="text-4xl">
        {n} <span className="text-base text-white/60">{rouletteColor(n)}</span>
      </div>
    );
  }
  if (game === "slots") {
    const grid = digestToSlotGrid(digest);
    const { lines, fullBoard, units } = slotWins(grid);
    return (
      <div className="flex flex-col gap-2">
        <div className="grid w-max grid-cols-3 gap-1">
          {grid.map((s, i) => (
            <SlotIcon key={i} symbol={s} className="h-12 w-12 rounded-lg bg-white/10 p-1.5" />
          ))}
        </div>
        <div className="text-white/60">
          {lines.map((l) => `line ${l.line + 1}: ${SLOT_SYMBOLS[l.symbol]} ×${l.pay}`).join(" · ") || "no winning line"}
          {fullBoard && " · full board ×10"}
        </div>
        <div className="text-4xl">{fmtMultiplier((units * Number(BPS)) / SLOT_LINES.length)}</div>
      </div>
    );
  }
  const path = digestToPlinkoPath(digest, props.rows);
  const slot = plinkoSlot(path);
  return (
    <div className="flex flex-col gap-1">
      <div className="tracking-widest">{path.map((b) => (b ? "R" : "L")).join(" ")}</div>
      <div className="text-4xl">
        slot {slot} <span className="text-base text-white/60">{fmtMultiplier(plinkoTable(props.rows, props.risk)[slot])}</span>
      </div>
    </div>
  );
}
