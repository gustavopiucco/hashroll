# 🎲 Hashroll

> *Provably fair* **Dice, Plinko and Roulette**, fully on-chain on **Solana**: every bet is escrowed, resolved and paid by a program, and any player can prove each outcome on their own.

Hashroll is the foundation of an iGaming ecosystem with its own token (**HROLL**, an SPL token).

- **On-chain:** the bankroll, the bets, the payouts and the randomness check. The player's balance is their own wallet.
- **Off-chain:** only the house key, which commits to each server seed before a bet and reveals it to settle.
- **Provably Fair:** the program refuses to settle unless the revealed seed matches the commitment stored before the bet, and it computes the outcome with the same specification as `packages/fair`.

> ⚠️ **Status: local development MVP.** Do not use it on a public cluster or with real funds before completing the security and compliance phases of the [ROADMAP](./ROADMAP.md).

---

## Architecture

```
┌──────────────┐  sign & send tx  ┌───────────────────────────────┐
│  apps/web    │ ───────────────▶ │  solana/ (Anchor program)     │
│  Next.js     │ ◀── read state ─ │  hashroll                     │
│  wallet-     │     & events     │  • Config + vault (bankroll)  │
│  adapter     │                  │  • PlayerState (nonce, owed,  │
└──────┬───────┘                  │    commitment, pending bet)   │
       │ open account / faucet    │  • Dice, Plinko, Roulette     │
       ▼                          └───────────────▲───────────────┘
┌────────────────────┐   commit seed / settle bet │
│  apps/api (NestJS) │ ───────────────────────────┘
│  "the house"       │
│  settler loop      │      packages/fair: the same Provably Fair spec in TypeScript
└────────────────────┘      (browser verifier) and in Rust (solana/programs/hashroll/src/fair.rs)
```

| Folder | Stack | What it does |
|---|---|---|
| `packages/fair` | TypeScript + `@noble/hashes` | Provably Fair specification and the rules of every game: Dice, Plinko tables, Roulette masks (values as `bigint`) |
| `solana/programs/hashroll` | Rust, Anchor 0.32 | The program: bankroll vault, bets for the three games, settlement, timeout claims, owed payouts, admin |
| `solana/client` | TypeScript (`@hashroll/program`) | IDL, PDAs, event/history parsing and formatting, shared by the API, the web app and the tests |
| `apps/api` | NestJS 12 (ESM) | The house: opens player accounts, derives and commits server seeds, settles bets, dev faucet |
| `apps/web` | Next.js 16, Tailwind 4, Solana wallet adapter | Lobby, `/dice`, `/plinko` and `/roulette` with animations that replay the on-chain result, history read from the chain, independent verifier (`/verify`) |
| `docker-compose.yml` | Postgres 17, `solana-test-validator` | Local infra (Postgres is not used yet; see the roadmap) |

### Bet lifecycle

1. **Open:** on first connect the API calls `open_player`, creating the player's account (the house pays the rent) with `commitment = SHA256(serverSeed₀)`.
2. **Bet:** the player signs one of:
   - `place_dice(amount, target, direction, clientSeed, expectedCommitment)`
   - `place_plinko(amount, rows, risk, clientSeed, expectedCommitment)`
   - `place_roulette(chips, clientSeed, expectedCommitment)` (up to 8 chips of `{ mask, amount }`)

   The program moves the stake from the player's token account to the vault and **reserves the maximum payout** of the bet (the best case over every possible outcome), so the house can always pay.
3. **Settle:** the house signs `settle_bet(serverSeed, nextCommitment)`, which works for every game. The program checks `SHA256(serverSeed) == commitment`, computes the outcome, pays from the vault and stores the commitment for the next bet. The seed is now public in the transaction's `BetSettled` event.
   - The player's token account is optional here. If it does not exist, the payout is credited to the player's `owed` balance (still reserved in the vault) and the player withdraws it later with `withdraw_owed`. Closing the token account therefore can never block a reveal; without this, a player could block every Plinko outcome (almost all of them pay something) and wait for the timeout.
4. **Timeout:** if the house does not settle within `settle_timeout_secs` (60 s locally), the player calls `claim_expired` and receives the **full maximum payout**. Withholding an unfavourable reveal never pays off for the house.

Why nobody can steer the roll: the house commits to the server seed before it sees the client seed, the player picks the client seed without knowing the server seed, and the commitment cannot change while a bet is pending. `expectedCommitment` makes a bet fail instead of silently using another seed.

### Bankroll safety

- The vault is a token account owned by a program PDA. Only the program moves funds.
- `reserved` tracks the maximum payouts of all pending bets plus every unwithdrawn `owed` balance. `defund_house` can never touch it.
- Maximum profit per bet = free bankroll × `max_payout_bps` / 10000 (1% by default), applied to the bet's maximum payout. With a 1,000x Plinko edge, the largest stake is about 1/1000 of that limit.
- Pausing blocks new bets only; settlements and timeout claims keep working.
- `initialize` can only be called by the program's upgrade authority; admin transfer is two-step.
- HROLL has a fixed supply: the mint authority is revoked right after the initial mint.

---

## Provably Fair: specification

```
commitment = SHA256(serverSeed)                          ← stored on-chain BEFORE the bet
digest     = HMAC_SHA256(key = serverSeed, msg = clientSeed + ":" + nonce)
n          = first 4 bytes of the digest (big-endian uint32)

Dice       roll   = floor(n × 10000 / 2³²)               ← 0..9999, displayed as 00.00–99.99
Roulette   number = floor(n × 37 / 2³²)                  ← 0..36
Plinko     row i goes right iff bit i of the digest is 1 (byte i/8, bit 7 − i%8, MSB first)
           slot   = number of right bounces              ← 0..rows
```

- The `:` separator avoids ambiguity between `"ab"+"12"` and `"a"+"b12"`, which is why `clientSeed` cannot contain `:` (and, on-chain, has 1–32 bytes).
- **Dice:** `target` is the number of winning outcomes (100–9800, i.e. 1% to 98% chance).
  - `under` wins if `roll < target`.
  - `over` wins if `roll ≥ 10000 − target`.
- **Dice payout:** `amount × (10000 − houseEdgeBps) / target`. With a 1% edge and 50% chance, the payout is 1.98x.
- **Plinko:** 8, 12 or 16 rows and low/medium/high risk. Each slot pays a fixed multiplier (`PLINKO_TABLES` in `packages/fair`, identical copy in `fair.rs`). The edge is built into the tables: their exact RTP is 98.75%–98.97%, checked in both test suites. `houseEdgeBps` does not apply. The best slot pays from 5.6x (8 rows, low) to 1,000x (16 rows, high).
- **Roulette:** European single zero. A chip covers any set of 1–36 numbers, given as a 37-bit mask (bit i = number i), and pays `amount × 36 / numbers covered`. That reproduces every classic bet (straight 36x, split 18x, street 12x, corner 9x, line 6x, dozen and column 3x, red/black/odd/even/low/high 2x), all with the classic 1/37 = 2.70% edge. `houseEdgeBps` does not apply.
- `BetSettled.outcome` is the Dice roll, the Plinko path bits (bit i = row i, 1 = right) or the Roulette number.
- **One server seed per bet.** It is revealed on-chain when that bet settles, so every bet can be audited right away. The API derives seeds as `HMAC_SHA256(HOUSE_SEED_SECRET, genesisHash + ":" + programId + ":" + player + ":" + nonce)`, so it keeps no state, survives restarts and never re-issues a seed on another cluster or deployment.
- The fixed test vectors (Dice, Roulette and 16-row Plinko) live in `packages/fair/src/index.test.ts` and are replayed against the Rust implementation (`solana/programs/hashroll/src/fair.rs`) and against the deployed program (`solana/tests`). **If they change, the specification changed** and old audits break. Version it before changing.

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
3. Pick a game in the lobby, click **+1000 HROLL + 2 SOL (dev faucet)** and play. Each bet is one wallet signature; the house settles it within a second or two, and only then does the animation play out the result read from the chain.
4. Click **verify** on any bet in the history to audit it at `/verify`.

Smoke test of the whole local stack (no browser needed):

```bash
npm run e2e:local -w @hashroll/program                 # one round per game: bet → settle → re-verify with packages/fair
# timeout path: run the API with SETTLER_ENABLED=false, then
npm run e2e:local -w @hashroll/program -- --expire
```

> Restarting the `solana` container resets the chain (`docker compose restart solana`). Do it after any change to the program's account layout; old accounts cannot be read by the new program. Run `npm run deploy:local` again; every address stays the same because the dev keypairs are committed in `solana/keys/dev` (**public keys, localnet only**).
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
- **Liveness depends on the settler.** If it stops, every pending bet becomes claimable at its **maximum** payout after the timeout. With high-multiplier games (Plinko 16 rows high risk pays up to 1,000x) a settler outage is far more expensive than with Dice; the per-bet profit cap bounds each bet, not the total.
- Crash is not implemented. The roadmap's version (shared rounds and a pre-committed hash chain) needs a different architecture than the per-player commit-reveal used here.
- `open_player` costs the house rent and is not rate-limited yet.
- The program has **not been audited**.
- Admin powers (`set_params`, `set_house`, `defund_house`, upgrades) are held by a single key, not a multisig with a timelock.

What to do next is in **[ROADMAP.md](./ROADMAP.md)**.
