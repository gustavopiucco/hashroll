"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny synthesized sound kit (WebAudio, no asset files). The AudioContext is created lazily on the
 * first sound, which always follows a click, so browsers' autoplay rules are satisfied.
 */

const STORAGE_KEY = "hashroll:muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const listeners = new Set<() => void>();

try {
  muted = typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
} catch {}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (muted || typeof window === "undefined") return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

function tone(freq: number, opts: { type?: OscillatorType; dur?: number; gain?: number; delay?: number; slideTo?: number } = {}) {
  const a = audio();
  if (!a) return;
  const { type = "sine", dur = 0.12, gain = 0.5, delay = 0, slideTo } = opts;
  const t = a.ctx.currentTime + delay;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  click: () => tone(900, { type: "triangle", dur: 0.05, gain: 0.25 }),
  chip: () => {
    tone(1800, { type: "triangle", dur: 0.04, gain: 0.25 });
    tone(2400, { type: "sine", dur: 0.05, gain: 0.15, delay: 0.02 });
  },
  /** Peg / tick sound; `step` raises the pitch a little each time. */
  tick: (step = 0) => tone(520 + step * 35, { type: "triangle", dur: 0.06, gain: 0.22 }),
  roll: () => tone(300 + Math.random() * 500, { type: "square", dur: 0.025, gain: 0.05 }),
  land: () => tone(180, { type: "sine", dur: 0.18, gain: 0.5, slideTo: 90 }),
  win: () => [660, 880, 1320].forEach((f, i) => tone(f, { type: "triangle", dur: 0.18, gain: 0.35, delay: i * 0.08 })),
  bigWin: () =>
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      tone(f, { type: "triangle", dur: 0.3, gain: 0.35, delay: i * 0.07 });
      tone(f * 2, { type: "sine", dur: 0.25, gain: 0.1, delay: i * 0.07 });
    }),
  lose: () => tone(240, { type: "sawtooth", dur: 0.28, gain: 0.12, slideTo: 110 }),
};

export function setMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Current mute state; false on the server so hydration is stable. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted, () => false);
}
