import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hashroll",
  description: "Provably fair on-chain Dice, Plinko and Roulette on Solana",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <header className="border-b border-white/10 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-mono text-lg font-bold tracking-tight">
              hash<span className="text-emerald-400">roll</span>
            </Link>
            <nav className="flex gap-4 text-sm text-white/60">
              <Link href="/dice" className="hover:text-white">Dice</Link>
              <Link href="/plinko" className="hover:text-white">Plinko</Link>
              <Link href="/roulette" className="hover:text-white">Roulette</Link>
              <Link href="/verify" className="hover:text-white">Verify</Link>
            </nav>
          </header>
          <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
