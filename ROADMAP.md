# Hashroll Roadmap

Each phase has an **exit criterion**. Do not move to a public cluster before passing the "gates" marked with 🔒.

---

## ✅ Phase 0: Foundation (done)

- [x] Monorepo with npm workspaces (`packages/fair`, `solana`, `apps/api`, `apps/web`)
- [x] Isomorphic Provably Fair package with documented specification, fixed vectors and cross-check against `node:crypto`
- [x] **Migration from EVM to Solana, fully on-chain:** bets, bankroll and payouts live in the `hashroll` Anchor program
  - [x] HROLL as an SPL token (9 decimals, fixed supply, mint authority revoked)
  - [x] Vault owned by a program PDA, payout reservation, profit cap proportional to the free bankroll, pause, two-step admin, upgrade-authority-gated `initialize`
  - [x] Per-bet commit-reveal with on-chain HMAC-SHA256 (same spec and vectors as `packages/fair`) and full-payout timeout claim
- [x] Rust unit tests (fixed vectors) and LiteSVM integration tests (rounds, wrong seed, wrong settler, commitment lock, profit cap, timeout, reserved funds)
- [x] NestJS API as "the house": stateless seed derivation, account opening, settler loop, dev faucet
- [x] Next.js web: Solana wallet connection, Dice screen, on-chain history, `/verify` pre-filled from the history
- [x] docker-compose (Postgres, `solana-test-validator`), Dockerized Anchor build, local deploy/bootstrap and an end-to-end smoke script (`e2e:local`)

- [x] **More games:** Plinko (8/12/16 rows, 3 risk levels, fixed tables with exact RTP checks) and European Roulette (up to 8 chips per spin as 37-bit masks), on the same commit-reveal settlement
- [x] Settlement never depends on the player's token account: payouts are credited to `owed` and withdrawn with `withdraw_owed`
- [x] Game UI: lobby, animated Dice, Plinko and Roulette (PixiJS stages) that only replay the on-chain result; friendly Anchor error messages; multi-game verifier

The click-through flow with a real browser wallet has not been tested yet; it is the first item of phase 1.

---

## Phase 1: Local MVP robustness

**Goal:** the local flow becomes reliable and pleasant to use.

- [ ] Manual browser test with Phantom/Solflare/Backpack (connect → faucet → bet → settle → verify → timeout claim) + E2E tests with Playwright
- [ ] DTO validation (`zod`) and standardized error responses on the API
- [x] Sound effects and a WebGL renderer (PixiJS)
- [ ] Simple auto-bet (N bets, stop on profit or loss); consider session keys to avoid one wallet prompt per bet
- [ ] Program tests for admin paths (`set_params`, `set_house`, pause, two-step admin) and fuzzing of amounts, targets, Plinko configs and Roulette masks
- [ ] Lint, format and CI (GitHub Actions running `npm test` and `npm run build:program`)

**Exit:** stable local demo with green CI.

---

## Phase 2: House hardening and indexing

**Goal:** the house is robust and the history does not depend on RPC log scanning.

- [ ] Rate limiting on `open_player` (it costs the house rent) and on the faucet
- [ ] Settler: priority fees, retries with backoff, alerting when a bet gets close to its timeout, and a health endpoint
- [ ] Run more than one settler safely (idempotent by `(player, nonce)`; the program already rejects double settlement)
- [ ] **Indexer** (Helius webhooks/Geyser or a custom log subscriber) writing `BetSettled`/`BetExpired` events to **PostgreSQL**, for history, stats and reconciliation
- [ ] WebSocket for real-time results instead of polling the player account

**Exit:** restarting or scaling the API loses nothing and no bet expires during normal operation.

---

## Phase 3: Key management and economics

**Goal:** remove the single hot key and make the bankroll sustainable.

- [ ] House key and `HOUSE_SEED_SECRET` in a **KMS/HSM**; seed secret rotation (commit with the new secret only after pending bets settle)
- [ ] Separate dev faucet from any non-local build (compile it out)
- [ ] Bankroll LP design: let third parties provide liquidity to the vault (shares, withdrawal queue)
- [ ] Reconciliation job: vault balance ≥ `reserved`, observed RTP vs. theoretical per game, house PnL
- [ ] Per-game exposure limits: cap the total `reserved` of high-multiplier bets (Plinko 1,000x) so a settler outage cannot drain the bankroll through timeout claims

**Exit:** no secret on disk, and reconciliation runs automatically.

---

## Phase 4: Public devnet

- [ ] Deploy to **Solana devnet** with deploy scripts parameterized by cluster (separate program ID and keys per cluster)
- [ ] Verifiable build (`solana-verify`) and published IDL
- [ ] Program upgrade authority and config admin become a **multisig (Squads)**, with a **timelock** on upgrades, `defund_house`, `set_house` and `set_params`
- [ ] Observability: structured logs, metrics (volume, actual vs. theoretical RTP, house PnL, settle latency) and alerts
- [ ] Public proof of reserves page (vault vs. reserved, straight from the chain)
- [ ] Closed beta with testers

**Exit:** weeks of devnet operation without incidents, with observed RTP converging to the theoretical value (99% with a 1% edge).

---

## 🔒 Phase 5: Production gates (mandatory before mainnet)

These items come from section 5 of the original architecture and **are not optional**.

### Security

- [ ] Static analysis and linting of the program (`cargo clippy`, Anchor `skip-lint = false`, tools such as Sec3 X-ray or Soteria), with every finding fixed or justified
- [ ] Invariant tests (e.g. `reserved` always covered by the vault, nonce only increases, no payout without a matching reveal)
- [ ] **External audit** of the program by a firm specialized in Solana
- [ ] API pentest (house key handling, settler races, rent-draining via `open_player`)
- [ ] Bug bounty program (e.g. Immunefi)

### Bankroll

- [ ] Risk model: enough initial capital for the **max payout** with headroom, using the Kelly criterion or Monte Carlo simulation
- [ ] Review `max_payout_bps` (currently 1%) based on the simulation
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

- [ ] Deploy to **Solana mainnet-beta** with initial liquidity
- [ ] **Crash:** shared rounds over WebSocket, with a pre-committed hash chain. It needs round accounts and timed cash-outs, a different design from the per-player commit-reveal of the other games (a single-player "auto cash-out" variant would be Dice with another skin)
- [x] Plinko and Roulette (done early, see phase 0)
- [ ] Evaluate an on-chain VRF (e.g. Switchboard or ORAO) for games where a house reveal is not wanted
- [ ] Advanced tokenomics: house staking (players as bankroll LPs), affiliate program
- [ ] Mobile app / PWA (Solana Mobile Wallet Adapter)
