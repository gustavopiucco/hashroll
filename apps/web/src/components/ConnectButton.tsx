"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards. Wallet detection only exists in the browser. */
function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function ConnectButton() {
  const { publicKey, wallets, select, disconnect, connecting, wallet } = useWallet();
  const isClient = useIsClient();

  // The server never sees installed wallets, so render a neutral placeholder until hydrated.
  if (!isClient) {
    return <div className="h-9" aria-hidden />;
  }

  if (publicKey) {
    const a = publicKey.toBase58();
    return (
      <button onClick={() => void disconnect()} className="font-mono text-xs rounded-xl border border-line bg-panel px-3 py-3 hover:bg-white/5">
        {a.slice(0, 4)}…{a.slice(-4)} · disconnect
      </button>
    );
  }

  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed);
  if (installed.length === 0) {
    return <p className="text-rose-400 text-sm max-w-xs">No Solana wallet found. Install Phantom, Solflare or Backpack.</p>;
  }
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {installed.map((w) => (
        <button
          key={w.adapter.name}
          onClick={() => select(w.adapter.name)}
          disabled={connecting}
          className="flex items-center gap-2 rounded-xl bg-brand text-black font-bold px-5 py-3 shadow-[0_8px_30px_-8px_rgb(44_240_164/0.7)] hover:brightness-110 disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={w.adapter.icon} alt="" className="h-5 w-5" />
          {connecting && wallet?.adapter.name === w.adapter.name ? "Connecting…" : w.adapter.name}
        </button>
      ))}
    </div>
  );
}
