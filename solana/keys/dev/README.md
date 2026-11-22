# Local development keypairs

⚠️ These keypairs are **public** (committed to the repository). Use them **only** on a local
`solana-test-validator`. Never fund them on devnet/mainnet and never reuse them in production.

| File | Role |
|---|---|
| `program.json` | Program ID of `hashroll` (must match `declare_id!` and `Anchor.toml`) |
| `admin.json` | Program upgrade authority and config admin; also holds the HROLL treasury used by the dev faucet |
| `house.json` | House settler: opens player accounts, commits server seeds and settles bets (used by the API) |
| `mint.json` | Address of the local HROLL mint |

Committing them keeps every address deterministic across machines, the same way Anvil's
well-known accounts did in the EVM version.
