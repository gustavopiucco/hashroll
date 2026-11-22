//! Hashroll: provably fair casino games (Dice, Plinko, Roulette), fully on-chain on Solana.
//!
//! Flow (one pending bet per player, whatever the game):
//!   1. `open_player`: the house creates the player's account with a commitment = SHA256(serverSeed).
//!   2. `place_dice` / `place_plinko` / `place_roulette`: the player escrows the stake in the vault
//!      and supplies a fresh client seed. The maximum payout is reserved so the house can always pay.
//!   3. `settle_bet`: the house reveals serverSeed. The program checks it against the commitment,
//!      computes the outcome with exactly the same rules as `packages/fair`, pays out and stores
//!      the commitment for the next bet. Every server seed is used for a single bet. If the player's
//!      token account is missing, the payout is credited to `owed` (see `withdraw_owed`), so
//!      settlement never depends on an account the player controls.
//!   4. `claim_expired`: if the house does not settle within `settle_timeout_secs`, the player
//!      claims the full potential payout. Withholding a losing reveal never pays off for the house.
//!
//! The house never sees the client seed before committing, and the player never sees the
//! server seed before betting, so neither side can steer the roll.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod fair;

declare_id!("D6s76Umz4mQUoy9ySiU3vtb9cjWnHuGUBuBwmgbvwxxQ");

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PLAYER_SEED: &[u8] = b"player";

pub const MAX_HOUSE_EDGE_BPS: u16 = 500; // 5%
pub const MAX_PAYOUT_BPS_LIMIT: u16 = 1_000; // at most 10% of the free bankroll per bet
pub const MIN_SETTLE_TIMEOUT_SECS: i64 = 10;
pub const MAX_SETTLE_TIMEOUT_SECS: i64 = 86_400;

const NO_COMMITMENT: [u8; 32] = [0u8; 32];

#[program]
pub mod hashroll {
    use super::*;

    /// Creates the config and the vault. Only the program's upgrade authority can call it,
    /// so nobody can front-run the deploy and take over the admin role.
    pub fn initialize(ctx: Context<Initialize>, house: Pubkey, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.house = house;
        config.mint = ctx.accounts.mint.key();
        config.vault = ctx.accounts.vault.key();
        config.house_edge_bps = params.house_edge_bps;
        config.max_payout_bps = params.max_payout_bps;
        config.settle_timeout_secs = params.settle_timeout_secs;
        config.paused = false;
        config.reserved = 0;
        config.bump = ctx.bumps.config;
        config.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    // ------------------------------------------------------------------ admin

    pub fn set_params(ctx: Context<AdminOnly>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let config = &mut ctx.accounts.config;
        config.house_edge_bps = params.house_edge_bps;
        config.max_payout_bps = params.max_payout_bps;
        config.settle_timeout_secs = params.settle_timeout_secs;
        emit!(ParamsUpdated {
            house_edge_bps: params.house_edge_bps,
            max_payout_bps: params.max_payout_bps,
            settle_timeout_secs: params.settle_timeout_secs,
        });
        Ok(())
    }

    pub fn set_house(ctx: Context<AdminOnly>, house: Pubkey) -> Result<()> {
        require_keys_neq!(house, Pubkey::default(), HashrollError::ZeroAddress);
        ctx.accounts.config.house = house;
        emit!(HouseUpdated { house });
        Ok(())
    }

    /// Pausing blocks new bets only. Settlements and expiry claims keep working so funds are never stuck.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedUpdated { paused });
        Ok(())
    }

    /// Two-step admin transfer (step 1). Pass the default pubkey to cancel.
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    /// Two-step admin transfer (step 2), signed by the proposed admin.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        emit!(AdminUpdated { admin: config.admin });
        Ok(())
    }

    /// Anyone can add liquidity to the house bankroll.
    pub fn fund_house(ctx: Context<FundHouse>, amount: u64) -> Result<()> {
        require!(amount > 0, HashrollError::ZeroAmount);
        let decimals = ctx.accounts.mint.decimals;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;
        emit!(HouseFunded { from: ctx.accounts.funder.key(), amount });
        Ok(())
    }

    /// Withdraws house liquidity. Funds reserved for pending bets can never be withdrawn.
    pub fn defund_house(ctx: Context<DefundHouse>, amount: u64) -> Result<()> {
        require!(amount > 0, HashrollError::ZeroAmount);
        let free = ctx.accounts.vault.amount.saturating_sub(ctx.accounts.config.reserved);
        require!(amount <= free, HashrollError::InsufficientBankroll);
        pay_from_vault(
            &ctx.accounts.config,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.to,
            &ctx.accounts.token_program,
            amount,
        )?;
        emit!(HouseDefunded { to: ctx.accounts.to.key(), amount });
        Ok(())
    }

    // ------------------------------------------------------------------ house

    /// Creates a player's account with the first commitment. The house pays the rent.
    pub fn open_player(ctx: Context<OpenPlayer>, commitment: [u8; 32]) -> Result<()> {
        require!(commitment != NO_COMMITMENT, HashrollError::NoCommitment);
        let ps = &mut ctx.accounts.player_state;
        ps.player = ctx.accounts.player.key();
        ps.nonce = 0;
        ps.commitment = commitment;
        ps.bump = ctx.bumps.player_state;
        ps.clear_bet();
        emit!(SeedCommitted { player: ps.player, nonce: 0, commitment });
        Ok(())
    }

    /// Sets the commitment for the next bet. Only allowed while no bet is pending, so the
    /// house can never swap the seed after seeing a client seed.
    pub fn commit_seed(ctx: Context<CommitSeed>, commitment: [u8; 32]) -> Result<()> {
        require!(commitment != NO_COMMITMENT, HashrollError::NoCommitment);
        let ps = &mut ctx.accounts.player_state;
        require!(!ps.pending, HashrollError::BetPending);
        ps.commitment = commitment;
        emit!(SeedCommitted { player: ps.player, nonce: ps.nonce, commitment });
        Ok(())
    }

    /// Reveals the server seed of the pending bet, resolves it and commits the next seed.
    pub fn settle_bet(ctx: Context<SettleBet>, server_seed: String, next_commitment: [u8; 32]) -> Result<()> {
        require!(next_commitment != NO_COMMITMENT, HashrollError::NoCommitment);
        let ps = &ctx.accounts.player_state;
        require!(ps.pending, HashrollError::NoPendingBet);
        require!(server_seed.len() <= fair::MAX_SERVER_SEED_LEN, HashrollError::BadServerSeed);
        require!(fair::sha256(server_seed.as_bytes()) == ps.commitment, HashrollError::BadServerSeed);

        let digest = fair::compute_digest(server_seed.as_bytes(), &ps.bet_client_seed, ps.nonce);
        let (outcome, payout) = resolve(ps, &digest)?;
        // Never pay more than what was reserved (holds by construction; checked for defense in depth).
        require!(payout <= ps.bet_max_payout, HashrollError::MathOverflow);

        // The player's token account is optional. Without it the payout is credited to `owed`, so a
        // player cannot block the reveal of a bad outcome by closing the account and then claim the
        // full payout at the timeout.
        let credited = payout > 0 && ctx.accounts.player_token.is_none();
        if payout > 0 && !credited {
            pay_from_vault(
                &ctx.accounts.config,
                &ctx.accounts.vault,
                &ctx.accounts.mint,
                ctx.accounts.player_token.as_ref().unwrap(),
                &ctx.accounts.token_program,
                payout,
            )?;
        }

        let config = &mut ctx.accounts.config;
        config.reserved = config.reserved.checked_sub(ps.bet_max_payout).ok_or(HashrollError::MathOverflow)?;
        if credited {
            // Owed funds stay reserved until withdrawn.
            config.reserved = config.reserved.checked_add(payout).ok_or(HashrollError::MathOverflow)?;
        }

        emit!(BetSettled {
            player: ps.player,
            nonce: ps.nonce,
            commitment: ps.commitment,
            server_seed,
            client_seed: ps.bet_client_seed.clone(),
            game: ps.bet_game,
            amount: ps.bet_amount,
            target: ps.bet_target,
            direction: ps.bet_direction,
            rows: ps.bet_rows,
            risk: ps.bet_risk,
            chips: ps.bet_chips.clone(),
            outcome,
            payout,
            credited,
            next_commitment,
        });

        let ps = &mut ctx.accounts.player_state;
        if credited {
            ps.owed = ps.owed.checked_add(payout).ok_or(HashrollError::MathOverflow)?;
        }
        ps.nonce = ps.nonce.checked_add(1).ok_or(HashrollError::MathOverflow)?;
        ps.commitment = next_commitment;
        ps.clear_bet();
        Ok(())
    }

    // ----------------------------------------------------------------- player

    /// Dice: wins if the roll (0..9999) is under `target` (or at least 10000 - target for `Over`).
    /// `expected_commitment` must match the stored one, so the bet fails instead of silently using
    /// another seed. The same holds for every `place_*` instruction.
    pub fn place_dice(
        ctx: Context<PlaceBet>,
        amount: u64,
        target: u16,
        direction: Direction,
        client_seed: String,
        expected_commitment: [u8; 32],
    ) -> Result<()> {
        require!(fair::is_valid_target(target), HashrollError::InvalidTarget);
        let edge = ctx.accounts.config.house_edge_bps;
        let max_payout = fair::payout_for(amount, target, edge).ok_or(HashrollError::MathOverflow)?;
        escrow_bet(ctx.accounts, amount, max_payout, client_seed, expected_commitment)?;
        let ps = &mut ctx.accounts.player_state;
        ps.bet_game = Game::Dice;
        ps.bet_target = target;
        ps.bet_direction = direction;
        emit_placed(ps);
        Ok(())
    }

    /// Plinko: `rows` bounces (8, 12 or 16), one bit of the digest each; the slot is the number of
    /// right bounces and pays the multiplier of the fixed table for `rows` and `risk`.
    pub fn place_plinko(
        ctx: Context<PlaceBet>,
        amount: u64,
        rows: u8,
        risk: PlinkoRisk,
        client_seed: String,
        expected_commitment: [u8; 32],
    ) -> Result<()> {
        let table = fair::plinko_table(rows, risk as usize).ok_or(HashrollError::InvalidPlinko)?;
        // Both edges hold the largest multiplier.
        let max_payout = fair::plinko_payout(amount, table, 0).ok_or(HashrollError::MathOverflow)?;
        escrow_bet(ctx.accounts, amount, max_payout, client_seed, expected_commitment)?;
        let ps = &mut ctx.accounts.player_state;
        ps.bet_game = Game::Plinko;
        ps.bet_rows = rows;
        ps.bet_risk = risk;
        emit_placed(ps);
        Ok(())
    }

    /// European roulette: up to 8 chips, each covering a set of numbers (37-bit mask) and paying
    /// amount * 36 / covered. The stake is the sum of the chips; the reserve is the best case
    /// over the 37 numbers.
    pub fn place_roulette(
        ctx: Context<PlaceBet>,
        chips: Vec<RouletteChip>,
        client_seed: String,
        expected_commitment: [u8; 32],
    ) -> Result<()> {
        require!(!chips.is_empty() && chips.len() <= fair::ROULETTE_MAX_CHIPS, HashrollError::InvalidRouletteBet);
        let mut amount = 0u64;
        for c in &chips {
            require!(c.amount > 0 && fair::is_valid_roulette_mask(c.mask), HashrollError::InvalidRouletteBet);
            amount = amount.checked_add(c.amount).ok_or(HashrollError::MathOverflow)?;
        }
        let max_payout = (0..fair::ROULETTE_POCKETS as u8)
            .map(|n| fair::roulette_payout(chips.iter().map(|c| (c.mask, c.amount)), n))
            .max()
            .unwrap_or(0);
        require!(max_payout < u64::MAX, HashrollError::MathOverflow);
        escrow_bet(ctx.accounts, amount, max_payout, client_seed, expected_commitment)?;
        let ps = &mut ctx.accounts.player_state;
        ps.bet_game = Game::Roulette;
        ps.bet_chips = chips;
        emit_placed(ps);
        Ok(())
    }

    /// Withdraws payouts that were credited because the player's token account was missing at settlement.
    pub fn withdraw_owed(ctx: Context<WithdrawOwed>) -> Result<()> {
        let owed = ctx.accounts.player_state.owed;
        require!(owed > 0, HashrollError::NothingOwed);
        pay_from_vault(
            &ctx.accounts.config,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.player_token,
            &ctx.accounts.token_program,
            owed,
        )?;
        let config = &mut ctx.accounts.config;
        config.reserved = config.reserved.checked_sub(owed).ok_or(HashrollError::MathOverflow)?;
        ctx.accounts.player_state.owed = 0;
        emit!(OwedWithdrawn { player: ctx.accounts.player.key(), amount: owed });
        Ok(())
    }

    /// The house missed the settlement deadline: the player receives the full potential payout.
    /// The commitment is cleared because its seed was never revealed; the house must commit again.
    pub fn claim_expired(ctx: Context<ClaimExpired>) -> Result<()> {
        let ps = &ctx.accounts.player_state;
        require!(ps.pending, HashrollError::NoPendingBet);
        let deadline = ps
            .bet_placed_at
            .checked_add(ctx.accounts.config.settle_timeout_secs)
            .ok_or(HashrollError::MathOverflow)?;
        require!(Clock::get()?.unix_timestamp >= deadline, HashrollError::NotExpired);

        let payout = ps.bet_max_payout;
        pay_from_vault(
            &ctx.accounts.config,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.player_token,
            &ctx.accounts.token_program,
            payout,
        )?;
        let config = &mut ctx.accounts.config;
        config.reserved = config.reserved.checked_sub(payout).ok_or(HashrollError::MathOverflow)?;

        let ps = &mut ctx.accounts.player_state;
        emit!(BetExpired { player: ps.player, nonce: ps.nonce, commitment: ps.commitment, payout });
        ps.nonce = ps.nonce.checked_add(1).ok_or(HashrollError::MathOverflow)?;
        ps.commitment = NO_COMMITMENT;
        ps.clear_bet();
        Ok(())
    }
}

/// Checks shared by every game, escrows the stake and reserves the maximum payout.
fn escrow_bet(
    accounts: &mut PlaceBet,
    amount: u64,
    max_payout: u64,
    client_seed: String,
    expected_commitment: [u8; 32],
) -> Result<()> {
    let config = &accounts.config;
    let ps = &accounts.player_state;
    require!(!config.paused, HashrollError::Paused);
    require!(!ps.pending, HashrollError::BetPending);
    require!(ps.commitment != NO_COMMITMENT, HashrollError::NoCommitment);
    require!(ps.commitment == expected_commitment, HashrollError::CommitmentMismatch);
    require!(amount > 0, HashrollError::ZeroAmount);
    require!(fair::is_valid_client_seed(&client_seed), HashrollError::InvalidClientSeed);

    let free = accounts.vault.amount.saturating_sub(config.reserved);
    let max_profit = (free as u128 * config.max_payout_bps as u128 / fair::BPS as u128) as u64;
    require!(max_payout.saturating_sub(amount) <= max_profit, HashrollError::ProfitTooHigh);

    let decimals = accounts.mint.decimals;
    token::transfer_checked(
        CpiContext::new(
            accounts.token_program.to_account_info(),
            TransferChecked {
                from: accounts.player_token.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.vault.to_account_info(),
                authority: accounts.player.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    let config = &mut accounts.config;
    config.reserved = config.reserved.checked_add(max_payout).ok_or(HashrollError::MathOverflow)?;

    let ps = &mut accounts.player_state;
    ps.clear_bet();
    ps.pending = true;
    ps.bet_amount = amount;
    ps.bet_max_payout = max_payout;
    ps.bet_placed_at = Clock::get()?.unix_timestamp;
    ps.bet_client_seed = client_seed;
    Ok(())
}

fn emit_placed(ps: &PlayerState) {
    emit!(BetPlaced {
        player: ps.player,
        nonce: ps.nonce,
        commitment: ps.commitment,
        client_seed: ps.bet_client_seed.clone(),
        game: ps.bet_game,
        amount: ps.bet_amount,
        target: ps.bet_target,
        direction: ps.bet_direction,
        rows: ps.bet_rows,
        risk: ps.bet_risk,
        chips: ps.bet_chips.clone(),
        max_payout: ps.bet_max_payout,
    });
}

/// Game outcome and payout of the pending bet. `outcome` is the Dice roll, the Plinko path bits
/// (bit i = row i, 1 = right) or the Roulette number.
fn resolve(ps: &PlayerState, digest: &[u8; 32]) -> Result<(u32, u64)> {
    Ok(match ps.bet_game {
        Game::Dice => {
            let roll = fair::digest_to_roll(digest);
            let win = fair::is_win(roll, ps.bet_target, ps.bet_direction == Direction::Over);
            (roll as u32, if win { ps.bet_max_payout } else { 0 })
        }
        Game::Plinko => {
            let table = fair::plinko_table(ps.bet_rows, ps.bet_risk as usize).ok_or(HashrollError::InvalidPlinko)?;
            let path = fair::digest_to_plinko_path(digest, ps.bet_rows);
            let slot = path.count_ones() as usize;
            (path, fair::plinko_payout(ps.bet_amount, table, slot).ok_or(HashrollError::MathOverflow)?)
        }
        Game::Roulette => {
            let number = fair::digest_to_roulette_number(digest);
            (number as u32, fair::roulette_payout(ps.bet_chips.iter().map(|c| (c.mask, c.amount)), number))
        }
    })
}

fn pay_from_vault<'info>(
    config: &Account<'info, Config>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config.bump]]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}

// ===================================================================== state

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    /// Settler key: opens player accounts, commits and reveals server seeds.
    pub house: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub house_edge_bps: u16,
    /// Maximum profit per bet = free bankroll * max_payout_bps / 10000.
    pub max_payout_bps: u16,
    pub settle_timeout_secs: i64,
    pub paused: bool,
    /// Sum of the potential payouts of all pending bets (always covered by the vault).
    pub reserved: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Field order matters: the API filters pending bets with a memcmp on `pending`
/// (offset 8 discriminator + 32 player + 8 nonce + 32 commitment = 80).
#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub player: Pubkey,
    /// Nonce of the next (or pending) bet. Increments once per resolved bet.
    pub nonce: u64,
    /// SHA256(serverSeed) for the next (or pending) bet. All zeros = the house must commit.
    pub commitment: [u8; 32],
    pub pending: bool,
    pub bet_game: Game,
    /// Total stake (for Roulette, the sum of the chips).
    pub bet_amount: u64,
    /// Dice only.
    pub bet_target: u16,
    /// Dice only.
    pub bet_direction: Direction,
    /// Plinko only.
    pub bet_rows: u8,
    /// Plinko only.
    pub bet_risk: PlinkoRisk,
    /// Roulette only.
    #[max_len(8)]
    pub bet_chips: Vec<RouletteChip>,
    /// Best-case payout, reserved against the vault and paid in full by `claim_expired`.
    pub bet_max_payout: u64,
    pub bet_placed_at: i64,
    #[max_len(32)]
    pub bet_client_seed: String,
    /// Payouts credited when the player's token account was missing at settlement (still reserved).
    pub owed: u64,
    pub bump: u8,
}

impl PlayerState {
    fn clear_bet(&mut self) {
        self.pending = false;
        self.bet_game = Game::Dice;
        self.bet_amount = 0;
        self.bet_target = 0;
        self.bet_direction = Direction::Under;
        self.bet_rows = 0;
        self.bet_risk = PlinkoRisk::Low;
        self.bet_chips = Vec::new();
        self.bet_max_payout = 0;
        self.bet_placed_at = 0;
        self.bet_client_seed = String::new();
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Direction {
    Under,
    Over,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Game {
    Dice,
    Plinko,
    Roulette,
}

/// Index into the Plinko tables of `fair.rs` (low = 0, medium = 1, high = 2).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum PlinkoRisk {
    Low,
    Medium,
    High,
}

/// One roulette chip: covers the numbers set in `mask` (bit i = number i).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct RouletteChip {
    pub mask: u64,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct ConfigParams {
    pub house_edge_bps: u16,
    pub max_payout_bps: u16,
    pub settle_timeout_secs: i64,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.house_edge_bps <= MAX_HOUSE_EDGE_BPS, HashrollError::InvalidParams);
        require!(
            self.max_payout_bps > 0 && self.max_payout_bps <= MAX_PAYOUT_BPS_LIMIT,
            HashrollError::InvalidParams
        );
        require!(
            (MIN_SETTLE_TIMEOUT_SECS..=MAX_SETTLE_TIMEOUT_SECS).contains(&self.settle_timeout_secs),
            HashrollError::InvalidParams
        );
        Ok(())
    }
}

// ================================================================== accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ HashrollError::Unauthorized)]
    pub program: Program<'info, crate::program::Hashroll>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ HashrollError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ HashrollError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == new_admin.key() @ HashrollError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct FundHouse<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DefundHouse<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ HashrollError::Unauthorized,
        has_one = mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenPlayer<'info> {
    #[account(mut)]
    pub house: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = house @ HashrollError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: any wallet address; it only seeds the PDA and is recorded as the owner of the account.
    pub player: UncheckedAccount<'info>,
    #[account(
        init,
        payer = house,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, player.key().as_ref()],
        bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitSeed<'info> {
    pub house: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = house @ HashrollError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player_state.player.as_ref()], bump = player_state.bump)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player.key().as_ref()], bump = player_state.bump, has_one = player)]
    pub player_state: Account<'info, PlayerState>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleBet<'info> {
    pub house: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = house @ HashrollError::Unauthorized,
        has_one = mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player_state.player.as_ref()], bump = player_state.bump)]
    pub player_state: Account<'info, PlayerState>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// Optional: without it a payout is credited to `owed` (see `settle_bet`).
    #[account(mut, token::mint = mint, token::authority = player_state.player)]
    pub player_token: Option<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimExpired<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player.key().as_ref()], bump = player_state.bump, has_one = player)]
    pub player_state: Account<'info, PlayerState>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawOwed<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = mint, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PLAYER_SEED, player.key().as_ref()], bump = player_state.bump, has_one = player)]
    pub player_state: Account<'info, PlayerState>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ==================================================================== events

#[event]
pub struct SeedCommitted {
    pub player: Pubkey,
    pub nonce: u64,
    pub commitment: [u8; 32],
}

#[event]
pub struct BetPlaced {
    pub player: Pubkey,
    pub nonce: u64,
    pub commitment: [u8; 32],
    pub client_seed: String,
    pub game: Game,
    pub amount: u64,
    pub target: u16,
    pub direction: Direction,
    pub rows: u8,
    pub risk: PlinkoRisk,
    pub chips: Vec<RouletteChip>,
    pub max_payout: u64,
}

#[event]
pub struct BetSettled {
    pub player: Pubkey,
    pub nonce: u64,
    pub commitment: [u8; 32],
    pub server_seed: String,
    pub client_seed: String,
    pub game: Game,
    pub amount: u64,
    pub target: u16,
    pub direction: Direction,
    pub rows: u8,
    pub risk: PlinkoRisk,
    pub chips: Vec<RouletteChip>,
    /// Dice roll (0..9999), Plinko path bits (bit i = row i, 1 = right) or Roulette number (0..36).
    pub outcome: u32,
    /// Gross payout (0 on a loss; Plinko can pay less than the stake).
    pub payout: u64,
    /// True when the payout went to `owed` because the player's token account was missing.
    pub credited: bool,
    pub next_commitment: [u8; 32],
}

#[event]
pub struct OwedWithdrawn {
    pub player: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BetExpired {
    pub player: Pubkey,
    pub nonce: u64,
    pub commitment: [u8; 32],
    pub payout: u64,
}

#[event]
pub struct HouseFunded {
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct HouseDefunded {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ParamsUpdated {
    pub house_edge_bps: u16,
    pub max_payout_bps: u16,
    pub settle_timeout_secs: i64,
}

#[event]
pub struct HouseUpdated {
    pub house: Pubkey,
}

#[event]
pub struct PausedUpdated {
    pub paused: bool,
}

#[event]
pub struct AdminUpdated {
    pub admin: Pubkey,
}

// ==================================================================== errors

#[error_code]
pub enum HashrollError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Address cannot be the default pubkey")]
    ZeroAddress,
    #[msg("Signer is not authorized")]
    Unauthorized,
    #[msg("Invalid config parameters")]
    InvalidParams,
    #[msg("Betting is paused")]
    Paused,
    #[msg("The player already has a pending bet")]
    BetPending,
    #[msg("The player has no pending bet")]
    NoPendingBet,
    #[msg("No server seed commitment: the house must commit first")]
    NoCommitment,
    #[msg("The commitment changed: refresh and try again")]
    CommitmentMismatch,
    #[msg("Target must be between 100 and 9800")]
    InvalidTarget,
    #[msg("Client seed must have 1 to 32 bytes and no ':'")]
    InvalidClientSeed,
    #[msg("Potential profit exceeds the bankroll limit")]
    ProfitTooHigh,
    #[msg("Server seed does not match the commitment")]
    BadServerSeed,
    #[msg("The settlement deadline has not passed yet")]
    NotExpired,
    #[msg("Not enough free bankroll")]
    InsufficientBankroll,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Plinko rows must be 8, 12 or 16")]
    InvalidPlinko,
    #[msg("Roulette: 1 to 8 chips, each with an amount and a mask of 1 to 36 numbers (0-36)")]
    InvalidRouletteBet,
    #[msg("Nothing to withdraw")]
    NothingOwed,
}
