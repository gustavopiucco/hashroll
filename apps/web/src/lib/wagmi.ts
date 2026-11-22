import { createConfig, http, injected } from "wagmi";
import { foundry } from "viem/chains";

// MVP: local chain only (Anvil, chainId 31337). Phase 4 adds Base Sepolia → Base.
export const wagmiConfig = createConfig({
  chains: [foundry],
  connectors: [injected()],
  transports: { [foundry.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545") },
  ssr: true,
});
