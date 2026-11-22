import { decodePlinkoPath, plinkoSlot, plinkoTable, rouletteColor, ROLL_RANGE } from "@hashroll/fair";
import type { BetHistoryEntry, Game } from "@hashroll/program";

export const fmtRoll = (r: number) => (r / 100).toFixed(2);
export const fmtMultiplier = (bps: number) => `${(bps / 10_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;

export const GAME_LABEL: Record<Game, string> = { dice: "Dice", plinko: "Plinko", roulette: "Roulette" };

/** One-line description of a settled outcome, for history tables. */
export function describeOutcome(b: BetHistoryEntry): string {
  if (b.kind === "expired" || b.outcome == null || !b.bet) return "expired (house paid the max)";
  switch (b.bet.game) {
    case "dice": {
      const rule = b.bet.direction === "under" ? `< ${fmtRoll(b.bet.target)}` : `≥ ${fmtRoll(ROLL_RANGE - b.bet.target)}`;
      return `${fmtRoll(b.outcome)} (${rule})`;
    }
    case "plinko": {
      const slot = plinkoSlot(decodePlinkoPath(b.outcome, b.bet.rows));
      return `slot ${slot} · ${fmtMultiplier(plinkoTable(b.bet.rows, b.bet.risk)[slot])} (${b.bet.rows} rows, ${b.bet.risk})`;
    }
    case "roulette":
      return `${b.outcome} ${rouletteColor(b.outcome)} · ${b.bet.chips.length} chip${b.bet.chips.length > 1 ? "s" : ""}`;
  }
}

/** Link to the independent verifier, pre-filled with everything needed to recompute the outcome. */
export function verifyHref(b: BetHistoryEntry): string {
  const q = new URLSearchParams({
    serverSeed: b.serverSeed ?? "",
    commitment: b.commitment,
    clientSeed: b.clientSeed ?? "",
    nonce: String(b.nonce),
    game: b.bet?.game ?? "dice",
  });
  if (b.bet?.game === "plinko") {
    q.set("rows", String(b.bet.rows));
    q.set("risk", b.bet.risk);
  }
  if (b.bet?.game === "dice") {
    q.set("target", String(b.bet.target));
    q.set("direction", b.bet.direction);
  }
  return `/verify?${q}`;
}
