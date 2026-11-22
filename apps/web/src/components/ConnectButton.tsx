"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";

export function ConnectButton() {
  const { publicKey, wallets, select, disconnect, connecting, wallet } = useWallet();

  if (publicKey) {
    const a = publicKey.toBase58();
    return (
      <button onClick={() => void disconnect()} className="font-mono text-xs rounded border border-white/20 px-3 py-1.5 hover:bg-white/5">
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
          className="flex items-center gap-2 rounded bg-emerald-500 text-black font-semibold px-4 py-2 hover:bg-emerald-400 disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={w.adapter.icon} alt="" className="h-5 w-5" />
          {connecting && wallet?.adapter.name === w.adapter.name ? "Connecting…" : w.adapter.name}
        </button>
      ))}
    </div>
  );
}
