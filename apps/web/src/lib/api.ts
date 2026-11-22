const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? res.statusText);
  return body as T;
}

export interface HouseInfo {
  programId: string;
  house: string;
  mint: string;
  houseEdgeBps: number;
  maxPayoutBps: number;
  settleTimeoutSecs: number;
  paused: boolean;
  bankroll: string;
  reserved: string;
  maxProfit: string;
}

/** The API only does what needs the house key. Everything else is read from the chain. */
export const api = {
  house: () => call<HouseInfo>("/house"),
  /** Opens the player's on-chain account (the house pays the rent) and makes sure a seed is committed. */
  open: (address: string) => call<unknown>(`/players/${address}/open`, { method: "POST" }),
  /** Local dev only: 2 SOL for fees + 1000 HROLL. */
  faucet: (address: string) => call<unknown>(`/players/${address}/dev/faucet`, { method: "POST" }),
};
