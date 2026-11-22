//! Hashroll: provably fair dice, fully on-chain on Solana.
//!
//! Flow (one pending bet per player):
//!   1. `open_player`: the house creates the player's account with a commitment = SHA256(serverSeed).
//!   2. `place_bet`: the player escrows the stake in the vault and supplies a fresh client seed.
//!      The maximum payout is reserved against the vault so the house can always pay.
//!   3. `settle_bet`: the house reveals serverSeed. The program checks it against the commitment,
//!      computes the roll with exactly the same rules as `packages/fair`, pays out and stores
//!      the commitment for the next bet. Every server seed is used for a single bet.
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

        let over = ps.bet_direction == Direction::Over;
        let roll = fair::compute_roll(server_seed.as_bytes(), &ps.bet_client_seed, ps.nonce);
        let win = fair::is_win(roll, ps.bet_target, over);
        let paid = if win { ps.bet_payout } else { 0 };

        if paid > 0 {
            // Required only to pay a win. Losses settle without it, so a player cannot block the
            // reveal of a losing roll by closing their token account and then claim the timeout.
            let player_token = ctx.accounts.player_token.as_ref().ok_or(HashrollError::MissingPlayerToken)?;
            pay_from_vault(
                &ctx.accounts.config,
                &ctx.accounts.vault,
                &ctx.accounts.mint,
                player_token,
                &ctx.accounts.token_program,
                paid,
            )?;
        }

        let config = &mut ctx.accounts.config;
        config.reserved = config.reserved.checked_sub(ps.bet_payout).ok_or(HashrollError::MathOverflow)?;

        emit!(BetSettled {
            player: ps.player,
            nonce: ps.nonce,
            commitment: ps.commitment,
            server_seed,
            client_seed: ps.bet_client_seed.clone(),
            amount: ps.bet_amount,
            target: ps.bet_target,
            direction: ps.bet_direction,
            roll,
            win,
            payout: paid,
            next_commitment,
        });

        let ps = &mut ctx.accounts.player_state;
        ps.nonce = ps.nonce.checked_add(1).ok_or(HashrollError::MathOverflow)?;
        ps.commitment = next_commitment;
        ps.clear_bet();
        Ok(())
    }

    // ----------------------------------------------------------------- player

    /// Escrows the stake and locks the bet against the current commitment.
    /// `expected_commitment` must match, so the bet fails instead of silently using another seed.
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        amount: u64,
        target: u16,
        direction: Direction,
        client_seed: String,
        expected_commitment: [u8; 32],
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let ps = &ctx.accounts.player_state;
        require!(!config.paused, HashrollError::Paused);
        require!(!ps.pending, HashrollError::BetPending);
        require!(ps.commitment != NO_COMMITMENT, HashrollError::NoCommitment);
        require!(ps.commitment == expected_commitment, HashrollError::CommitmentMismatch);
        require!(amount > 0, HashrollError::ZeroAmount);
        require!(fair::is_valid_target(target), HashrollError::InvalidTarget);
        require!(fair::is_valid_client_seed(&client_seed), HashrollError::InvalidClientSeed);

        let payout = fair::payout_for(amount, target, config.house_edge_bps).ok_or(HashrollError::MathOverflow)?;
        let free = ctx.accounts.vault.amount.saturating_sub(config.reserved);
        let max_profit = (free as u128 * config.max_payout_bps as u128 / fair::BPS as u128) as u64;
        require!(payout.saturating_sub(amount) <= max_profit, HashrollError::ProfitTooHigh);

        let decimals = ctx.accounts.mint.decimals;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.player_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        let config = &mut ctx.accounts.config;
        config.reserved = config.reserved.checked_add(payout).ok_or(HashrollError::MathOverflow)?;

        let ps = &mut ctx.accounts.player_state;
        ps.pending = true;
        ps.bet_amount = amount;
        ps.bet_target = target;
        ps.bet_direction = direction;
        ps.bet_payout = payout;
        ps.bet_placed_at = Clock::get()?.unix_timestamp;
        ps.bet_client_seed = client_seed.clone();

        emit!(BetPlaced {
            player: ps.player,
            nonce: ps.nonce,
            commitment: ps.commitment,
            client_seed,
            amount,
            target,
            direction,
            potential_payout: payout,
        });
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

        let payout = ps.bet_payout;
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
    pub bet_amount: u64,
    pub bet_target: u16,
    pub bet_direction: Direction,
    pub bet_payout: u64,
    pub bet_placed_at: i64,
    #[max_len(32)]
    pub bet_client_seed: String,
    pub bump: u8,
}

impl PlayerState {
    fn clear_bet(&mut self) {
        self.pending = false;
        self.bet_amount = 0;
        self.bet_target = 0;
        self.bet_direction = Direction::Under;
        self.bet_payout = 0;
        self.bet_placed_at = 0;
        self.bet_client_seed = String::new();
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Direction {
    Under,
    Over,
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
    /// Optional: only needed when the roll wins (see `settle_bet`).
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
    pub amount: u64,
    pub target: u16,
    pub direction: Direction,
    pub potential_payout: u64,
}

#[event]
pub struct BetSettled {
    pub player: Pubkey,
    pub nonce: u64,
    pub commitment: [u8; 32],
    pub server_seed: String,
    pub client_seed: String,
    pub amount: u64,
    pub target: u16,
    pub direction: Direction,
    pub roll: u16,
    pub win: bool,
    pub payout: u64,
    pub next_commitment: [u8; 32],
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
    #[msg("The player's token account is required to pay a win")]
    MissingPlayerToken,
}
