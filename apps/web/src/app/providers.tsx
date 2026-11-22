"use client";

import type { ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { RPC_URL } from "@/lib/solana";

/**
 * No wallet adapters are listed on purpose: Phantom, Solflare, Backpack and other wallets
 * implement the Wallet Standard and are detected automatically.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
