"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/effects";
import { sfx } from "@/lib/sound";

/** Number that counts smoothly to its new value. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}

/** Bet amount with quick ½ / 2× / max-style buttons. */
export function AmountInput({ value, onChange, disabled, label = "Bet amount" }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) {
  const scale = (f: number) => {
    sfx.click();
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) onChange(String(Math.max(0.01, Math.round(n * f * 100) / 100)));
  };
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <div className="flex items-center rounded-xl border border-line bg-black/35 p-1 focus-within:border-brand/60 transition-colors">
        <span className="pl-2 pr-1 text-gold" aria-hidden>
          <Coin />
        </span>
        <input
          value={value}
          disabled={disabled}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent px-2 py-2 font-mono text-base outline-none disabled:opacity-50"
        />
        {[
          ["½", 0.5],
          ["2×", 2],
        ].map(([l, f]) => (
          <button
            key={l}
            type="button"
            disabled={disabled}
            onClick={() => scale(f as number)}
            className="ml-1 rounded-lg bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 disabled:opacity-50"
          >
            {l}
          </button>
        ))}
      </div>
    </label>
  );
}

/** Segmented control. */
export function Seg<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  render,
}: {
  label?: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  render?: (v: T) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="field-label">{label}</span>}
      <div className="seg">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            disabled={disabled}
            aria-pressed={o === value}
            onClick={() => {
              sfx.click();
              onChange(o);
            }}
            className="capitalize"
          >
            {render ? render(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Stat line in the bet panel (e.g. "Profit on win"). */
export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-black/25 px-3 py-2">
      <span className="field-label">{label}</span>
      <span className={`font-mono text-sm tabular-nums truncate ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

/** Result badge that pops over the stage after a bet settles. */
export function WinBanner({ show, multiplier, detail, win }: { show: boolean; multiplier: string; detail: string; win: boolean }) {
  if (!show) return null;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex flex-col items-center rounded-2xl border px-7 py-4 text-center backdrop-blur-md animate-[win-in_0.5s_cubic-bezier(.2,1.4,.4,1)_both]"
      style={{
        borderColor: win ? "rgb(44 240 164 / 0.6)" : "rgb(255 61 127 / 0.45)",
        background: win ? "rgb(6 40 30 / 0.78)" : "rgb(40 8 22 / 0.72)",
        boxShadow: win ? "0 0 60px -10px rgb(44 240 164 / 0.7)" : "0 0 40px -12px rgb(255 61 127 / 0.6)",
      }}
    >
      <span className={`font-display text-4xl sm:text-5xl font-black tabular-nums ${win ? "text-brand" : "text-hot"}`}>{multiplier}</span>
      <span className="mt-1 font-mono text-sm text-white/80">{detail}</span>
    </div>
  );
}

export function Coin({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#ffc83d" />
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="#b07800" strokeWidth="1.6" />
      <path d="M9 8v8M15 8v8M8 11h8M8 14h8" stroke="#8a5d00" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
