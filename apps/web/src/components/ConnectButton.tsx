"use client";

import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

export function ConnectButton() {
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (isConnected && address) {
    return (
      <button onClick={() => disconnect.mutate()} className="font-mono text-xs rounded border border-white/20 px-3 py-1.5 hover:bg-white/5">
        {address.slice(0, 6)}…{address.slice(-4)} · sair
      </button>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => connectors[0] && connect.mutate({ connector: connectors[0] })}
        disabled={connect.isPending}
        className="rounded bg-emerald-500 text-black font-semibold px-4 py-2 hover:bg-emerald-400 disabled:opacity-50"
      >
        {connect.isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {connect.error && (
        <p className="text-rose-400 text-xs max-w-xs">
          {connect.error.name === "ProviderNotFoundError" ? "No wallet found — install MetaMask or Rabby." : connect.error.message}
        </p>
      )}
    </div>
  );
}
