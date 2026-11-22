"use client";

import { sfx } from "@/lib/sound";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Multiplier (payout / stake) from which a win gets the full celebration. */
export const BIG_WIN = 5;

/** Plays the result sound and, for big wins, fires confetti from the given element. */
export async function celebrate(multiplier: number, origin?: Element | null) {
  if (multiplier <= 0 || multiplier < 1) {
    sfx.lose();
    return;
  }
  if (multiplier < BIG_WIN) {
    sfx.win();
    return;
  }
  sfx.bigWin();
  if (prefersReducedMotion()) return;
  const { default: confetti } = await import("canvas-confetti");
  const r = origin?.getBoundingClientRect();
  const x = r ? (r.left + r.width / 2) / window.innerWidth : 0.5;
  const y = r ? (r.top + r.height / 2) / window.innerHeight : 0.5;
  const colors = ["#2cf0a4", "#ffc83d", "#ff3d7f", "#4cc9ff", "#ffffff"];
  confetti({ particleCount: 140, spread: 90, startVelocity: 45, origin: { x, y }, colors, scalar: 1.1 });
  setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors }), 180);
  setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors }), 180);
}
