"use client";

import type { ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { WalletError } from "@solana/wallet-adapter-base";
import { RPC_URL } from "@/lib/solana";

/**
 * The adapter's default handler logs every error with console.error, which the Next dev overlay
 * reports as a crash. The callers already show these errors in the UI; a user cancelling a
 * signature is expected and not worth logging at all.
 */
function onWalletError(error: WalletError) {
  const text = `${error.message} ${(error.error as Error | undefined)?.message ?? ""}`;
  if (/user rejected|rejected the request|declined/i.test(text)) return;
  console.warn(error);
}

/**
 * No wallet adapters are listed on purpose: Phantom, Solflare, Backpack and other wallets
 * implement the Wallet Standard and are detected automatically.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect onError={onWalletError}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
