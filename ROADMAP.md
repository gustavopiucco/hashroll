# Hashroll Roadmap

Each phase has an **exit criterion**. Do not move to a public network before passing the "gates" marked with 🔒.

---

## ✅ Phase 0: Foundation (done)

- [x] Monorepo with npm workspaces (`packages/fair`, `apps/api`, `apps/web`, `contracts`)
- [x] Isomorphic Provably Fair package with documented specification, fixed vectors and cross-check against `node:crypto`
- [x] `HashrollToken` (ERC-20 + Permit, fixed supply)
- [x] `HouseBankroll`: deposit, EIP-712 voucher withdrawal (nonce, deadline, domain), `maxPayout` proportional to the bankroll, pause, Ownable2Step
- [x] Foundry tests, including deposit/withdraw fuzzing
- [x] NestJS API: per-player seeds, Dice bet, rotation/reveal, history, dev faucet
- [x] Next.js web: wallet connection, Dice screen and 100% client-side `/verify` verifier (builds and serves the pages; **the click-through flow with a real wallet has not been tested in the browser yet**, which is the first item of phase 1)
- [x] docker-compose (Postgres, Anvil) and local deploy script

---

## Phase 1: Local MVP robustness

**Goal:** the local flow becomes reliable and pleasant to use.

- [ ] Manual browser test with MetaMask/Rabby (connect → faucet → bet → reveal → verify) + E2E tests with Playwright
- [ ] DTO validation (`class-validator` or `zod`) and standardized error responses
- [ ] Dice animation with Pixi.js (graphics engine mentioned in the architecture)
- [ ] When revealing the seed, open `/verify` directly with the fields pre-filled (query string)
- [ ] Let the player edit the client seed in the UI before rotating
- [ ] Simple auto-bet (N bets, stop on profit or loss)
- [ ] Lint, format and CI (GitHub Actions running `npm test`)

**Exit:** stable local demo with green CI.

---

## Phase 2: Persistence and identity

**Goal:** move off memory and know who the player is.

- [ ] **PostgreSQL** with an ORM (Drizzle or Prisma). Tables `players`, `seed_pairs`, `bets` and `ledger` (double-entry ledger: every credit and debit becomes an immutable row)
- [ ] Bet in a **single transaction** with `SELECT … FOR UPDATE` on the player, so that debit, nonce increment and bet record are atomic
- [ ] Server seeds encrypted at rest, with the key outside the database
- [ ] **Sign-In With Ethereum (EIP-4361)** with sessions in **Postgres** (`sessions` table with `expires_at`) or a signed cookie, removing the free `:address` from the routes
- [ ] Rate limiting per player and per IP (`@nestjs/throttler` in memory while there is a single instance; Postgres counter or reverse proxy when scaling)
- [ ] WebSocket for real-time balance and history

**Exit:** restarting the API loses nothing and only the wallet owner can bet.

---

## Phase 3: Connect on-chain to off-chain

**Goal:** close the deposit → bet → withdraw loop with real tokens (still on testnet).

- [ ] **Indexer** with Ponder (recommended) or The Graph, listening to `Deposited` and `Withdrawn`
  - Credit the balance only after N confirmations, idempotently by `(txHash, logIndex)`
- [ ] **Withdrawal endpoint:** debits the ledger and signs the EIP-712 voucher with viem (`signTypedData`), using the same nonce as the contract
  - Signer in KMS/HSM, never in an environment variable in production
- [ ] Deposit UI (approve or permit, then `deposit`) and withdrawal UI (request voucher, then `withdraw`)
- [ ] Read on-chain `maxPayout()` (cached) to cap the maximum profit per bet, removing `MAX_PROFIT_WEI`
- [ ] Remove the dev faucet from any non-local build
- [ ] Daily reconciliation: sum of off-chain balances + house reserve ≤ on-chain `bankroll()`, with an alert on mismatch
- [ ] End-to-end integration tests (Anvil + API + contract)

**Exit:** a testnet player deposits, bets and withdraws without human intervention, and reconciliation balances.

---

## Phase 4: Public testnet

- [ ] Deploy to **Base Sepolia** (or Polygon Amoy / Arbitrum Sepolia), with deploy scripts parameterized by network
- [ ] Contract verification on the explorer
- [ ] `HouseBankroll` owner becomes a **multisig (Safe)**, with a **timelock** on `defundHouse`, `setSigner` and `setMaxPayoutBps`
- [ ] Observability: structured logs, metrics (volume, actual vs. theoretical RTP, house PnL) and alerts
- [ ] Public proof of reserves (page with `bankroll()` vs. off-chain liabilities)
- [ ] Closed beta with testers

**Exit:** weeks of testnet operation without incidents, with observed RTP converging to the theoretical value (99% with a 1% edge).

---

## 🔒 Phase 5: Production gates (mandatory before mainnet)

These items come from section 5 of the original architecture and **are not optional**.

### Security

- [ ] Static analysis with **Slither** and **Mythril**, with every finding fixed or justified
- [ ] Foundry invariant tests (e.g. `withdrawalNonce` only increases, no withdrawal without a valid signature)
- [ ] **External audit** of the contracts by a specialized firm
- [ ] API pentest (auth, race conditions on betting, voucher replay)
- [ ] Bug bounty program (e.g. Immunefi)

### Bankroll

- [ ] Risk model: enough initial capital for the **max payout** with headroom, using the Kelly criterion or Monte Carlo simulation
- [ ] Review `maxPayoutBps` (currently 1%) based on the simulation
- [ ] Circuit breaker: automatic pause if house PnL drops X% within Y minutes

### Legal and compliance

- [ ] **iGaming license** (Curaçao, Anjouan, Malta or other), depending on target markets
- [ ] **KYC/AML**: verification provider, limits per KYC level and wallet screening (Chainalysis/TRM)
- [ ] Geoblocking of prohibited jurisdictions
- [ ] Responsible gaming: deposit limits, self-exclusion and warnings
- [ ] Terms of service, privacy policy (LGPD/GDPR) and legal analysis of the HROLL token's nature (risk of being classified as a security)

**Exit:** published audit, license issued and favorable legal opinion. Only then mainnet.

---

## Phase 6: Mainnet and expansion

- [ ] Deploy to **Base** (or the chosen L2) with initial liquidity
- [ ] New games reusing `packages/fair`:
  - **Crash:** shared rounds over WebSocket, with a pre-committed hash chain
  - **Plinko and Roulette**
- [ ] Slow-paced games (lottery, raffles) 100% on-chain with **Chainlink VRF**
- [ ] Advanced tokenomics: house staking (players as bankroll LPs), affiliate program
- [ ] Mobile app / PWA
