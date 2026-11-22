# 🎲 Hashroll

> *Provably fair* dice, fully on-chain on **Solana**: every bet is escrowed, resolved and paid by a program, and any player can prove each roll on their own.

Hashroll is the foundation of an iGaming ecosystem with its own token (**HROLL**, an SPL token).

- **On-chain:** the bankroll, the bets, the payouts and the randomness check. The player's balance is their own wallet.
- **Off-chain:** only the house key, which commits to each server seed before a bet and reveals it to settle.
- **Provably Fair:** the program refuses to settle unless the revealed seed matches the commitment stored before the bet, and it computes the roll with the same specification as `packages/fair`.

> ⚠️ **Status: local development MVP.** Do not use it on a public cluster or with real funds before completing the security and compliance phases of the [ROADMAP](./ROADMAP.md).

---

## Architecture

```
┌──────────────┐  sign & send tx  ┌───────────────────────────────┐
│  apps/web    │ ───────────────▶ │  solana/ (Anchor program)     │
│  Next.js     │ ◀── read state ─ │  hashroll                     │
│  wallet-     │     & events     │  • Config + vault (bankroll)  │
│  adapter     │                  │  • PlayerState (nonce,        │
└──────┬───────┘                  │    commitment, pending bet)   │
       │ open account / faucet    │  • on-chain HMAC-SHA256 roll  │
       ▼                          └───────────────▲───────────────┘
┌────────────────────┐   commit seed / settle bet │
│  apps/api (NestJS) │ ───────────────────────────┘
│  "the house"       │
│  settler loop      │      packages/fair: the same Provably Fair spec in TypeScript
└────────────────────┘      (browser verifier) and in Rust (solana/programs/hashroll/src/fair.rs)
```

| Folder | Stack | What it does |
|---|---|---|
| `packages/fair` | TypeScript + `@noble/hashes` | Provably Fair and Dice rules specification and implementation (values as `bigint`) |
| `solana/programs/hashroll` | Rust, Anchor 0.32 | The program: bankroll vault, bets, settlement, timeout claims, admin |
| `solana/client` | TypeScript (`@hashroll/program`) | IDL, PDAs, event/history parsing and formatting, shared by the API, the web app and the tests |
| `apps/api` | NestJS 12 (ESM) | The house: opens player accounts, derives and commits server seeds, settles bets, dev faucet |
| `apps/web` | Next.js 16, Tailwind 4, Solana wallet adapter | Wallet connection, Dice screen, history read from the chain, independent verifier (`/verify`) |
| `docker-compose.yml` | Postgres 17, `solana-test-validator` | Local infra (Postgres is not used yet; see the roadmap) |

### Bet lifecycle

1. **Open:** on first connect the API calls `open_player`, creating the player's account (the house pays the rent) with `commitment = SHA256(serverSeed₀)`.
2. **Bet:** the player signs `place_bet(amount, target, direction, clientSeed, expectedCommitment)`. The program moves the stake from the player's token account to the vault and **reserves the maximum payout**, so the house can always pay.
3. **Settle:** the house signs `settle_bet(serverSeed, nextCommitment)`. The program checks `SHA256(serverSeed) == commitment`, computes the roll, pays a win from the vault and stores the commitment for the next bet. The seed is now public in the transaction's `BetSettled` event. The player's token account is only required to pay a win, so closing it cannot block the reveal of a losing roll.
4. **Timeout:** if the house does not settle within `settle_timeout_secs` (60 s locally), the player calls `claim_expired` and receives the **full potential payout**. Withholding a losing reveal never pays off for the house.

Why nobody can steer the roll: the house commits to the server seed before it sees the client seed, the player picks the client seed without knowing the server seed, and the commitment cannot change while a bet is pending. `expectedCommitment` makes a bet fail instead of silently using another seed.

### Bankroll safety

- The vault is a token account owned by a program PDA. Only the program moves funds.
- `reserved` tracks the potential payouts of all pending bets. `defund_house` can never touch it.
- Maximum profit per bet = free bankroll × `max_payout_bps` / 10000 (1% by default).
- Pausing blocks new bets only; settlements and timeout claims keep working.
- `initialize` can only be called by the program's upgrade authority; admin transfer is two-step.
- HROLL has a fixed supply: the mint authority is revoked right after the initial mint.

---

## Provably Fair: specification

```
commitment = SHA256(serverSeed)                          ← stored on-chain BEFORE the bet
digest     = HMAC_SHA256(key = serverSeed, msg = clientSeed + ":" + nonce)
n          = first 4 bytes of the digest (big-endian uint32)
roll       = floor(n × 10000 / 2³²)                      ← 0..9999, displayed as 00.00–99.99
```

- The `:` separator avoids ambiguity between `"ab"+"12"` and `"a"+"b12"`, which is why `clientSeed` cannot contain `:` (and, on-chain, has 1–32 bytes).
- **Dice:** `target` is the number of winning outcomes (100–9800, i.e. 1% to 98% chance).
  - `under` wins if `roll < target`.
  - `over` wins if `roll ≥ 10000 − target`.
- **Payout:** `amount × (10000 − houseEdgeBps) / target`. With a 1% edge and 50% chance, the payout is 1.98x.
- **One server seed per bet.** It is revealed on-chain when that bet settles, so every bet can be audited right away. The API derives seeds as `HMAC_SHA256(HOUSE_SEED_SECRET, genesisHash + ":" + programId + ":" + player + ":" + nonce)`, so it keeps no state, survives restarts and never re-issues a seed on another cluster or deployment.
- The fixed test vectors live in `packages/fair/src/index.test.ts` and are replayed against the Rust implementation (`solana/programs/hashroll/src/fair.rs`) and against the deployed program (`solana/tests`). **If they change, the specification changed** and old audits break. Version it before changing.

---

## Running locally

### Prerequisites

- **Node.js ≥ 22.12** and npm
- **Docker** (runs Postgres, the Solana validator and the Anchor toolchain, so there is no need to install Rust, Solana or Anchor locally). The `solanafoundation/anchor` image is amd64-only; on Apple Silicon it runs under emulation, which works but is slower.
- A Solana browser wallet (Phantom, Solflare, Backpack…)

### Step by step

```bash
npm install
cp .env.example .env                 # read by the API (RPC, house key, seed secret)

npm run build:program                # compiles the Anchor program in Docker (first run: ~10 min)
npm run dev:infra                    # Postgres + solana-test-validator (RPC 8899, websocket 8900)
npm run deploy:local                 # deploys the program, creates HROLL, initializes and funds the house

npm run dev:api                      # API (house + settler) at http://localhost:4000
npm run dev:web                      # Web at http://localhost:3000  (another terminal)
```

In your wallet:

1. Point it at the local cluster: custom RPC `http://localhost:8899`. Solflare and Backpack accept a custom RPC, so they are the easiest choice locally; Phantom's network options vary by version. The app submits transactions through its own RPC and only asks the wallet to sign, but some wallets still simulate against their selected network and may show a warning.
2. Connect at `http://localhost:3000`.
3. Click **+1000 HROLL + 2 SOL (dev faucet)** and play. Each bet is one wallet signature; the house settles it within a second or two.
4. Click **verify** on any bet in the history to audit it at `/verify`.

Smoke test of the whole local stack (no browser needed):

```bash
npm run e2e:local -w @hashroll/program                 # 3 rounds: bet → settle → re-verify with packages/fair
# timeout path: run the API with SETTLER_ENABLED=false, then
npm run e2e:local -w @hashroll/program -- --expire
```

> Restarting the `solana` container resets the chain. Run `npm run deploy:local` again; every address stays the same because the dev keypairs are committed in `solana/keys/dev` (**public keys, localnet only**).
>
> The root `.env` is read by the API. The frontend uses the defaults (`http://localhost:4000` and `http://localhost:8899`). To change them, create `apps/web/.env.local` with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_RPC_URL`.
>
> npm's `install-scripts` warnings are harmless.

### Tests

```bash
npm test                 # fair + program (LiteSVM) + API
npm run test:fair        # Provably Fair: fixed vectors + cross-check against node:crypto
npm run test:program     # program integration tests in LiteSVM (needs `npm run build:program` first)
npm test -w @hashroll/api
```

`npm run build:program` also runs the Rust unit tests (`fair.rs` against the fixed vectors).

### API

Bets, balances and history are on-chain; the web app reads them directly from the cluster. The API only does what needs the house key.

| Method | Route | Description |
|---|---|---|
| GET | `/house` | Program, mint, edge, payout cap, timeout, bankroll, reserved, current max profit |
| POST | `/players/:addr/open` | Opens the player's account and makes sure a seed is committed (idempotent) |
| POST | `/players/:addr/dev/faucet` | 2 SOL + 1000 HROLL (blocked when `NODE_ENV=production`) |

---

## Known limitations (honest)

- **One signature and one fee per bet.** That is the price of settling everything on-chain.
- **The house is a single hot key** and `HOUSE_SEED_SECRET` sits in an environment variable. Anyone holding the secret can predict every future roll; anyone holding the key can settle (but never fake a roll). Both must move to a KMS/HSM.
- **Liveness depends on the settler.** If it stops, every pending bet becomes claimable at full payout after the timeout.
- `open_player` costs the house rent and is not rate-limited yet.
- The program has **not been audited**.
- Admin powers (`set_params`, `set_house`, `defund_house`, upgrades) are held by a single key, not a multisig with a timelock.

What to do next is in **[ROADMAP.md](./ROADMAP.md)**.
