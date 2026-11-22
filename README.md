# 🎲 Hashroll

> *Provably fair* dice on the blockchain: every roll comes from a hash, and any player can prove it on their own.

Hashroll is the foundation of an iGaming ecosystem with its own token (**HROLL**, ERC-20). The model is **hybrid**:

- **On-chain:** deposits, withdrawals and house liquidity.
- **Off-chain:** the bets, for zero latency and zero gas.
- **Provably Fair:** ties the two layers together. Players can audit any round without trusting the server.

> ⚠️ **Status: local development MVP.** Do not use it on a public network or with real funds before completing the security and compliance phases of the [ROADMAP](./ROADMAP.md).

---

## Architecture

```
┌──────────────┐   HTTP    ┌────────────────────┐            ┌──────────────────────┐
│  apps/web    │ ────────▶ │  apps/api (NestJS) │            │  contracts (Foundry) │
│  Next.js     │           │  Game Engine       │            │  HashrollToken (ERC20)│
│  wagmi/viem  │           │  off-chain balance │◀─ events ──│  HouseBankroll       │
└──────┬───────┘           └─────────┬──────────┘ (phase 3)  └──────────▲───────────┘
       │                             │                                  │
       │      ┌──────────────────────┴───────┐                          │
       └─────▶│ packages/fair                │   wallet (deposit / withdraw with voucher)
              │ isomorphic HMAC-SHA256       │──────────────────────────┘
              │ (same code in the browser    │
              │  and on the server)          │
              └──────────────────────────────┘
```

| Folder | Stack | What it does |
|---|---|---|
| `packages/fair` | TypeScript + `@noble/hashes` | Provably Fair and Dice rules specification and implementation (values as `bigint`) |
| `contracts` | Solidity 0.8.28, Foundry, OpenZeppelin 5 | HROLL token and `HouseBankroll` treasury (deposit, EIP-712 voucher withdrawal, payout limit, pause) |
| `apps/api` | NestJS 12 (ESM) | Per-player seeds, bet endpoint, seed rotation/reveal, history |
| `apps/web` | Next.js 16, Tailwind 4, wagmi 3, viem | Wallet connection, Dice screen, independent verifier (`/verify`) |
| `docker-compose.yml` | Postgres 17, Anvil | Local infra (Postgres already starts, but the MVP still uses memory; see the roadmap) |

### Money flow (target)

1. The player calls `HouseBankroll.deposit(amount)`, which emits the `Deposited` event. The indexer credits the off-chain balance.
2. Bets run in the API against that balance, with the outcome determined by Provably Fair.
3. On withdrawal, the API debits the balance and signs an **EIP-712 voucher** with `(player, amount, nonce, deadline)`. The player calls `withdraw(...)` and receives the tokens.
4. The sequential per-player nonce, the deadline and the EIP-712 domain (chainId + contract address) prevent replay.

In the MVP, steps 1 and 3 are not wired to the backend yet. Credit comes from the **dev faucet**. See phase 3 of the roadmap.

---

## Provably Fair: specification

```
commitment = SHA256(serverSeed)                          ← shown BEFORE betting
digest     = HMAC_SHA256(key = serverSeed, msg = clientSeed + ":" + nonce)
n          = first 4 bytes of the digest (big-endian uint32)
roll       = floor(n × 10000 / 2³²)                      ← 0..9999, displayed as 00.00–99.99
```

- The `:` separator avoids ambiguity between `"ab"+"12"` and `"a"+"b12"`, which is why `clientSeed` cannot contain `:`.
- **Dice:** `target` is the number of winning outcomes (100–9800, i.e. 1% to 98% chance).
  - `under` wins if `roll < target`.
  - `over` wins if `roll ≥ 10000 − target`.
- **Payout:** `amount × (10000 − houseEdgeBps) / target`. With a 1% edge and 50% chance, the payout is 1.98x.
- The active server seed **never** leaves the API. It is only revealed by `POST /players/:addr/seeds/rotate`, which generates a new pair and resets the nonce.
- The fixed test vectors live in `packages/fair/src/index.test.ts`. **If they change, the specification changed** and old audits break. Version it before changing.

---

## Running locally

### Prerequisites

- **Node.js ≥ 22.12** and npm
- **Docker** (runs Postgres, Anvil and Foundry, so there is no need to install `forge` locally)
- A browser wallet (MetaMask, Rabby…)

### Step by step

```bash
npm install
cp .env.example .env                 # read by the API (port, house edge, limits)

npm run dev:infra                    # Postgres + Anvil (chainId 31337, port 8545)
npm run deploy:local                 # deploys HROLL + HouseBankroll to Anvil

npm run dev:api                      # API at http://localhost:4000
npm run dev:web                      # Web at http://localhost:3000  (another terminal)
```

In your wallet:

1. Add the **Localhost 8545** network (RPC `http://localhost:8545`, chainId `31337`).
2. Connect at `http://localhost:3000`.
3. Click **+1000 (dev faucet)** and play.
4. Click **Reveal seed and generate new** and audit the bets at `/verify`.

> If you restart the Anvil container, the chain is reset. Run `npm run deploy:local` again and the addresses stay the same.
>
> The root `.env` is read by the API. The frontend uses the defaults (`http://localhost:4000` and `http://localhost:8545`). To change them, create `apps/web/.env.local` with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_RPC_URL`. `deploy:local` uses Anvil's public keys directly in `package.json`.
>
> npm's `install-scripts … fsevents` warning is harmless: it is an optional dependency of the watcher on macOS.

### Tests

```bash
npm test                 # everything
npm run test:fair        # Provably Fair: fixed vectors + cross-check against node:crypto
npm test -w @hashroll/api
npm run test:contracts   # forge test via Docker (includes fuzzing)
```

### API (MVP)

| Method | Route | Description |
|---|---|---|
| GET | `/players/:addr` | Balance, server seed hash, client seed, next nonce |
| POST | `/players/:addr/dice` | `{ amount: "<wei>", target: 100..9800, direction: "under" \| "over" }` |
| POST | `/players/:addr/seeds/rotate` | `{ clientSeed? }`: reveals the current seed and creates a new pair |
| GET | `/players/:addr/bets` | Last 100 bets |
| POST | `/players/:addr/dev/faucet` | +1000 HROLL of off-chain balance (blocked when `NODE_ENV=production`) |

> ⚠️ **No authentication in the MVP.** Anyone can act on behalf of any address. SIWE is in phase 2.

---

## Known limitations (honest)

- API state lives **in memory** and is lost on restart.
- There is no wallet authentication (SIWE).
- On-chain deposits do not credit the balance and the API does not issue withdrawal vouchers yet. The contracts support both, but the integration is missing.
- The per-bet profit limit comes from config (`MAX_PROFIT_WEI`), not from the on-chain `maxPayout()`.
- The contract does not separate house balance from player balances, because player balances live off-chain. This requires proof of reserves and a multisig/timelock owner before production.
- The contracts **have not been audited**.

What to do next is in **[ROADMAP.md](./ROADMAP.md)**.
