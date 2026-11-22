import type { Game } from "@hashroll/program";

/** Original vector icons for each game; used in the lobby, headers and history. */
export function GameIcon({ game, className = "h-8 w-8" }: { game: Game; className?: string }) {
  switch (game) {
    case "dice":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <defs>
            <linearGradient id="gi-dice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6dffc8" />
              <stop offset="1" stopColor="#13b97c" />
            </linearGradient>
          </defs>
          <rect x="8" y="8" width="48" height="48" rx="12" fill="url(#gi-dice)" transform="rotate(-8 32 32)" />
          <rect x="12" y="10" width="40" height="10" rx="5" fill="#fff" opacity=".25" transform="rotate(-8 32 32)" />
          <g fill="#06281c" transform="rotate(-8 32 32)">
            <circle cx="21" cy="21" r="4.5" />
            <circle cx="32" cy="32" r="4.5" />
            <circle cx="43" cy="43" r="4.5" />
            <circle cx="43" cy="21" r="4.5" />
            <circle cx="21" cy="43" r="4.5" />
          </g>
        </svg>
      );
    case "plinko":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <defs>
            <radialGradient id="gi-ball" cx=".35" cy=".35" r=".7">
              <stop offset="0" stopColor="#fff6c2" />
              <stop offset=".5" stopColor="#ffd84d" />
              <stop offset="1" stopColor="#f29c00" />
            </radialGradient>
          </defs>
          {[
            [32, 22],
            [24, 32],
            [40, 32],
            [16, 42],
            [32, 42],
            [48, 42],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#c9c4ff" />
          ))}
          {["#ff2e6e", "#ff8f1f", "#2cf0a4", "#ff8f1f", "#ff2e6e"].map((c, i) => (
            <rect key={i} x={6 + i * 10.8} y="51" width="9" height="8" rx="2.5" fill={c} />
          ))}
          <circle cx="36" cy="12" r="7" fill="url(#gi-ball)" />
        </svg>
      );
    case "roulette":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="28" fill="#e8b04a" />
          <circle cx="32" cy="32" r="25" fill="#2a1608" />
          {Array.from({ length: 12 }, (_, i) => {
            const a0 = (i * 30 - 90) * (Math.PI / 180);
            const a1 = ((i + 1) * 30 - 90) * (Math.PI / 180);
            // Rounded so server and client render identical path strings (hydration).
            const p = (r: number, a: number) => `${(32 + r * Math.cos(a)).toFixed(2)} ${(32 + r * Math.sin(a)).toFixed(2)}`;
            return (
              <path
                key={i}
                d={`M${p(24, a0)} A24 24 0 0 1 ${p(24, a1)} L${p(14, a1)} A14 14 0 0 0 ${p(14, a0)}Z`}
                fill={i === 0 ? "#16b364" : i % 2 ? "#e11d48" : "#16161d"}
              />
            );
          })}
          <circle cx="32" cy="32" r="12" fill="#e8b04a" />
          <circle cx="32" cy="32" r="4" fill="#fff3cf" />
          <circle cx="44" cy="15" r="3.2" fill="#fff" />
        </svg>
      );
  }
}
