import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"], weight: ["600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "Hashroll",
  description: "Provably fair on-chain Dice, Plinko, Roulette and Slots on Solana",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${rubik.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:px-6">{children}</main>
          <footer className="border-t border-line/60 py-6 text-center text-xs text-white/40">
            Hashroll · provably fair, settled on Solana · test tokens only
          </footer>
        </Providers>
      </body>
    </html>
  );
}
