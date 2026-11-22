import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hashroll",
  description: "Provably fair on-chain dice on Solana",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <header className="border-b border-white/10 px-6 py-4 flex items-center gap-6">
            <Link href="/" className="font-mono text-lg font-bold tracking-tight">
              hash<span className="text-emerald-400">roll</span>
            </Link>
            <nav className="flex gap-4 text-sm text-white/60">
              <Link href="/" className="hover:text-white">Dice</Link>
              <Link href="/verify" className="hover:text-white">Verify</Link>
            </nav>
          </header>
          <main className="flex-1 w-full max-w-3xl mx-auto p-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
