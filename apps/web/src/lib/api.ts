const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface PlayerState {
  address: string;
  balance: string;
  commitment: string;
  clientSeed: string;
  nonce: number;
  houseEdgeBps: number;
  maxProfit: string;
}

export interface BetRecord {
  id: number;
  nonce: number;
  commitment: string;
  clientSeed: string;
  amount: string;
  target: number;
  direction: "under" | "over";
  roll: number;
  win: boolean;
  payout: string;
  createdAt: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? res.statusText);
  return body as T;
}

export const api = {
  state: (a: string) => call<PlayerState>(`/players/${a}`),
  bets: (a: string) => call<BetRecord[]>(`/players/${a}/bets`),
  faucet: (a: string) => call<PlayerState>(`/players/${a}/dev/faucet`, { method: "POST" }),
  dice: (a: string, b: { amount: string; target: number; direction: "under" | "over" }) =>
    call<{ bet: BetRecord; balance: string }>(`/players/${a}/dice`, { method: "POST", body: JSON.stringify(b) }),
  rotate: (a: string, clientSeed?: string) =>
    call<{ revealed: { serverSeed: string; commitment: string; clientSeed: string; lastNonce: number }; next: PlayerState }>(
      `/players/${a}/seeds/rotate`,
      { method: "POST", body: JSON.stringify({ clientSeed }) },
    ),
};
