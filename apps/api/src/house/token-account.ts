import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, AccountState, TOKEN_PROGRAM_ID } from '@solana/spl-token';

/**
 * True only if `info` is an initialized, unfrozen SPL token account of `mint` owned by `owner`,
 * i.e. one the program would accept as the player's token account.
 *
 * "The address exists" is not enough: a player can close their ATA and send lamports to the address
 * (a system-owned account) or move its owner with SetAuthority. Passing such an account makes every
 * settlement fail, and the player would then claim the maximum payout at the timeout. Anything that
 * fails this check is left out, so the program credits the payout to `owed` instead.
 */
export function isUsableTokenAccount(info: AccountInfo<Buffer> | null, mint: PublicKey, owner: PublicKey): boolean {
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < ACCOUNT_SIZE) return false;
  const account = AccountLayout.decode(info.data.subarray(0, ACCOUNT_SIZE));
  return account.state === AccountState.Initialized && account.mint.equals(mint) && account.owner.equals(owner);
}
