import Link from "next/link";
import type { Game } from "@hashroll/program";
import { GameIcon } from "@/components/GameArt";

const GAMES: { game: Game; name: string; tagline: string; stats: [string, string][]; from: string; to: string; glow: string }[] = [
  {
    game: "dice",
    name: "Dice",
    tagline: "Pick your odds, roll under or over.",
    stats: [
      ["Max", "99x"],
      ["Edge", "1%"],
    ],
    from: "#0f6b4b",
    to: "#082a22",
    glow: "#2cf0a4",
  },
  {
    game: "plinko",
    name: "Plinko",
    tagline: "Drop the ball through 8, 12 or 16 rows of pegs.",
    stats: [
      ["Max", "1000x"],
      ["RTP", "98.9%"],
    ],
    from: "#7a4a06",
    to: "#2a1804",
    glow: "#ffc83d",
  },
  {
    game: "roulette",
    name: "Roulette",
    tagline: "European single-zero wheel, up to 8 bets per spin.",
    stats: [
      ["Max", "36x"],
      ["Edge", "2.7%"],
    ],
    from: "#7a0f2e",
    to: "#2a0612",
    glow: "#ff3d7f",
  },
];

const STEPS = [
  ["Commit", "The house stores the hash of a fresh server seed in your on-chain account before every bet."],
  ["Bet", "You sign the bet with your own client seed. The program escrows the stake and reserves the maximum payout."],
  ["Reveal", "The house reveals the seed; the program checks it, computes the outcome and pays you. If the house stalls, you claim the maximum payout."],
];

export default function Lobby() {
  return (
    <div className="flex flex-col gap-12 py-4">
      <section className="panel relative overflow-hidden px-6 py-14 text-center sm:py-20">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-hot/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative flex flex-col items-center gap-5">
          <span className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-brand">
            100% on-chain · Solana
          </span>
          <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight sm:text-7xl">
            Play. Win. <span className="text-shimmer">Verify.</span>
          </h1>
          <p className="max-w-xl text-white/65">
            Every bet is escrowed, resolved and paid by a Solana program. The house commits to its seed before you bet, you pick yours, and the
            program refuses to settle unless the reveal matches.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Link href="/plinko" className="btn-play" style={{ ["--btn" as string]: "var(--gold)" }}>
              Play Plinko
            </Link>
            <Link href="/verify" className="rounded-[0.9rem] border border-line bg-white/5 px-5 py-4 font-display font-bold hover:bg-white/10">
              How it&apos;s fair
            </Link>
          </div>
        </div>
        <GameIcon game="dice" className="pointer-events-none absolute left-[6%] top-[18%] hidden h-16 w-16 rotate-12 opacity-80 animate-[drift_5s_ease-in-out_infinite] md:block" />
        <GameIcon game="roulette" className="pointer-events-none absolute right-[7%] top-[14%] hidden h-20 w-20 opacity-80 animate-[drift_6s_ease-in-out_infinite_0.6s] md:block" />
        <GameIcon game="plinko" className="pointer-events-none absolute bottom-[12%] right-[14%] hidden h-14 w-14 opacity-70 animate-[drift_4.5s_ease-in-out_infinite_1.2s] md:block" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-black">Games</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {GAMES.map((g) => (
            <Link
              key={g.game}
              href={`/${g.game}`}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/10 p-5 transition duration-300 hover:-translate-y-1.5"
              style={{ background: `linear-gradient(160deg, ${g.from}, ${g.to})`, ["--glow" as string]: g.glow }}
            >
              <div
                className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full opacity-40 blur-2xl transition-opacity group-hover:opacity-70"
                style={{ background: g.glow }}
              />
              <div className="relative flex h-36 items-center justify-center">
                <GameIcon game={g.game} className="h-28 w-28 drop-shadow-[0_12px_20px_rgb(0_0_0/0.5)] transition duration-500 group-hover:scale-110 group-hover:-rotate-6" />
              </div>
              <span className="relative font-display text-3xl font-black">{g.name}</span>
              <span className="relative mt-1 text-sm text-white/70">{g.tagline}</span>
              <div className="relative mt-4 flex items-center justify-between">
                <div className="flex gap-2">
                  {g.stats.map(([k, v]) => (
                    <span key={k} className="rounded-lg bg-black/30 px-2 py-1 text-xs">
                      <span className="text-white/50">{k} </span>
                      <span className="font-bold">{v}</span>
                    </span>
                  ))}
                </div>
                <span
                  className="rounded-full px-4 py-1.5 text-sm font-bold text-black transition group-hover:animate-[glow-pulse_1.6s_ease-in-out_infinite]"
                  style={{ background: g.glow }}
                >
                  Play
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-black">Provably fair in 3 steps</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <div key={title} className="panel p-5 text-sm text-white/65">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 font-display text-lg font-black text-brand">{i + 1}</span>
                <span className="font-display text-lg font-bold text-white">{title}</span>
              </div>
              {text}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-white/50">
          Audit any bet in the{" "}
          <Link href="/verify" className="text-brand underline">
            verifier
          </Link>
          : it runs entirely in your browser.
        </p>
      </section>
    </div>
  );
}
