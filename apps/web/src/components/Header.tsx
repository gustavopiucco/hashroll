"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GameIcon } from "@/components/GameArt";
import { setMuted, useMuted } from "@/lib/sound";
import type { Game } from "@hashroll/program";

const NAV: { href: string; label: string; game?: Game }[] = [
  { href: "/dice", label: "Dice", game: "dice" },
  { href: "/plinko", label: "Plinko", game: "plinko" },
  { href: "/roulette", label: "Roulette", game: "roulette" },
  { href: "/verify", label: "Verify" },
];

export function Header() {
  const path = usePathname();
  const muted = useMuted();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-2xl font-black tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-sky text-background shadow-[0_0_20px_rgb(44_240_164/0.5)]">#</span>
          <span>
            hash<span className="text-brand">roll</span>
          </span>
        </Link>
        <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto text-sm font-semibold sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
          {NAV.map((n) => {
            const active = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 transition ${active ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                {n.game && <GameIcon game={n.game} className="h-5 w-5" />}
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Unmute sounds" : "Mute sounds"}
          className="ml-auto rounded-xl p-2 text-white/60 hover:bg-white/5 hover:text-white sm:ml-0"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" />
            {muted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />}
          </svg>
        </button>
      </div>
    </header>
  );
}
