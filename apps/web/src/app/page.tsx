import Link from "next/link";

const GAMES = [
  {
    href: "/dice",
    name: "Dice",
    tagline: "Pick your odds, roll under or over.",
    detail: "1%–98% win chance · up to 99x · 1% edge",
    accent: "from-emerald-500/30 to-emerald-500/5 border-emerald-500/40",
    glyph: "🎲",
  },
  {
    href: "/plinko",
    name: "Plinko",
    tagline: "Drop the ball through 8, 12 or 16 rows of pegs.",
    detail: "3 risk levels · up to 1000x · RTP 98.75%–98.97%",
    accent: "from-amber-400/30 to-amber-400/5 border-amber-400/40",
    glyph: "🔻",
  },
  {
    href: "/roulette",
    name: "Roulette",
    tagline: "European single-zero wheel, up to 8 bets per spin.",
    detail: "Straight 36x · dozens 3x · red/black 2x · 2.70% edge",
    accent: "from-rose-500/30 to-rose-500/5 border-rose-500/40",
    glyph: "🎡",
  },
];

export default function Lobby() {
  return (
    <div className="flex flex-col gap-10 py-6">
      <section className="flex flex-col gap-3 text-center items-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Provably fair, fully on-chain</h1>
        <p className="text-white/60 max-w-xl">
          Every bet is escrowed, resolved and paid by a Solana program. The house commits to SHA256(serverSeed) before you bet,
          you choose the client seed, and the program refuses to settle unless the revealed seed matches.
        </p>
      </section>

      <section className="grid sm:grid-cols-3 gap-4">
        {GAMES.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className={`group rounded-2xl border bg-gradient-to-b p-5 flex flex-col gap-3 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-black/40 ${g.accent}`}
          >
            <span className="text-4xl transition group-hover:scale-110 origin-left" aria-hidden>{g.glyph}</span>
            <span className="text-2xl font-bold">{g.name}</span>
            <span className="text-sm text-white/70">{g.tagline}</span>
            <span className="text-xs font-mono text-white/50 mt-auto">{g.detail}</span>
          </Link>
        ))}
      </section>

      <section className="grid sm:grid-cols-3 gap-4 text-sm text-white/60">
        <div className="rounded-xl border border-white/10 p-4">
          <div className="font-semibold text-white mb-1">1. Commit</div>
          The house stores the hash of a fresh server seed in your on-chain account before every bet.
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <div className="font-semibold text-white mb-1">2. Bet</div>
          You sign the bet with your own client seed. The program escrows the stake and reserves the maximum payout.
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <div className="font-semibold text-white mb-1">3. Reveal</div>
          The house reveals the seed; the program checks it, computes the outcome and pays you. If the house stalls, you claim the maximum payout.
        </div>
      </section>

      <p className="text-center text-sm text-white/50">
        Audit any bet in the <Link href="/verify" className="underline hover:text-white">verifier</Link>: it runs entirely in your browser.
      </p>
    </div>
  );
}
