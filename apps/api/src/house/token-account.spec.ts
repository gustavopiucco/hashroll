import { Keypair, SystemProgram, type AccountInfo } from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, AccountState, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { isUsableTokenAccount } from './token-account.js';

const mint = Keypair.generate().publicKey;
const player = Keypair.generate().publicKey;

function tokenAccount(over: Partial<{ mint: typeof mint; owner: typeof player; state: AccountState }> = {}, programOwner = TOKEN_PROGRAM_ID): AccountInfo<Buffer> {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: over.mint ?? mint,
      owner: over.owner ?? player,
      amount: 0n,
      delegateOption: 0,
      delegate: SystemProgram.programId,
      state: over.state ?? AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: SystemProgram.programId,
    },
    data,
  );
  return { data, owner: programOwner, lamports: 2_039_280, executable: false };
}

describe('isUsableTokenAccount', () => {
  it('accepts an initialized token account of the mint owned by the player', () => {
    expect(isUsableTokenAccount(tokenAccount(), mint, player)).toBe(true);
  });

  it('rejects accounts that would make the settlement fail', () => {
    // Missing (closed) account.
    expect(isUsableTokenAccount(null, mint, player)).toBe(false);
    // Closed ATA re-created by sending lamports to the address: system-owned, no data.
    expect(isUsableTokenAccount({ data: Buffer.alloc(0), owner: SystemProgram.programId, lamports: 1, executable: false }, mint, player)).toBe(false);
    // Owner moved away with SetAuthority.
    expect(isUsableTokenAccount(tokenAccount({ owner: Keypair.generate().publicKey }), mint, player)).toBe(false);
    // Wrong mint, frozen, or not owned by the token program.
    expect(isUsableTokenAccount(tokenAccount({ mint: Keypair.generate().publicKey }), mint, player)).toBe(false);
    expect(isUsableTokenAccount(tokenAccount({ state: AccountState.Frozen }), mint, player)).toBe(false);
    expect(isUsableTokenAccount(tokenAccount({}, SystemProgram.programId), mint, player)).toBe(false);
  });
});
