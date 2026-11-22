import { Connection } from "@solana/web3.js";
import { readOnlyProgram } from "@hashroll/program";

// MVP: local solana-test-validator. Phase 4 moves to devnet, then mainnet-beta.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8899";

let connection: Connection | null = null;
export function getConnection(): Connection {
  return (connection ??= new Connection(RPC_URL, "confirmed"));
}

export const getProgram = () => readOnlyProgram(getConnection());
