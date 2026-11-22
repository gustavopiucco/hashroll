/**
 * Local bootstrap (idempotent): run after the program is deployed to solana-test-validator.
 *   1. Creates the HROLL mint (9 decimals) at the dev mint address, mints the fixed supply to
 *      the admin treasury and revokes the mint authority (no more minting, ever).
 *   2. Initializes the program config (house key, edge, payout cap, settle timeout).
 *   3. Funds the house bankroll and gives the house key SOL for rent and fees.
 *
 * Usage: npm run deploy:local (from the repo root), or `npm run bootstrap:local -w @hashroll/program`.
 */
import { readFileSync } from "node:fs";
import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN, BPF_LOADER_UPGRADEABLE_ID, HROLL_UNIT, PROGRAM_ID, configPda, formatHroll, getProgram, vaultPda } from "../client/src/index.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const TOTAL_SUPPLY = 1_000_000_000n * HROLL_UNIT;
const HOUSE_BANKROLL = 100_000_000n * HROLL_UNIT;
const PARAMS = { houseEdgeBps: 100, maxPayoutBps: 100, settleTimeoutSecs: new BN(60) };

const key = (name: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL(`../keys/dev/${name}.json`, import.meta.url), "utf8"))));

const admin = key("admin");
const house = key("house");
const mint = key("mint");

const connection = new Connection(RPC_URL, "confirmed");
const wallet: Wallet = {
  publicKey: admin.publicKey,
  payer: admin,
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
    if (tx instanceof VersionedTransaction) tx.sign([admin]);
    else tx.partialSign(admin);
    return tx;
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
    for (const tx of txs) await wallet.signTransaction(tx);
    return txs;
  },
};
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
const program = getProgram(provider);

async function airdrop(to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) });
}

async function main() {
  if (!(await connection.getAccountInfo(PROGRAM_ID))) {
    throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC_URL}`);
  }
  const treasury = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);

  if (!(await connection.getAccountInfo(mint.publicKey))) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(mint.publicKey, 9, admin.publicKey, null),
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasury, admin.publicKey, mint.publicKey),
        createMintToInstruction(mint.publicKey, treasury, admin.publicKey, TOTAL_SUPPLY),
        createSetAuthorityInstruction(mint.publicKey, admin.publicKey, AuthorityType.MintTokens, null),
      ),
      [mint],
    );
    console.log(`HROLL mint created: ${formatHroll(TOTAL_SUPPLY)} HROLL, mint authority revoked`);
  }

  if (!(await connection.getAccountInfo(configPda()))) {
    const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);
    await program.methods
      .initialize(house.publicKey, PARAMS)
      .accountsPartial({ admin: admin.publicKey, config: configPda(), mint: mint.publicKey, vault: vaultPda(), program: PROGRAM_ID, programData })
      .rpc();
    console.log("Program config initialized");
  }

  const vault = await connection.getTokenAccountBalance(vaultPda());
  if (BigInt(vault.value.amount) === 0n) {
    await program.methods
      .fundHouse(new BN(HOUSE_BANKROLL.toString()))
      .accountsPartial({ funder: admin.publicKey, config: configPda(), mint: mint.publicKey, vault: vaultPda(), funderToken: treasury })
      .rpc();
    console.log(`House funded with ${formatHroll(HOUSE_BANKROLL)} HROLL`);
  }

  if ((await connection.getBalance(house.publicKey)) < 10 * LAMPORTS_PER_SOL) {
    await airdrop(house.publicKey, 100);
    console.log("House key funded with 100 SOL (rent + fees)");
  }

  console.log(`
Program:  ${PROGRAM_ID.toBase58()}
Config:   ${configPda().toBase58()}
Vault:    ${vaultPda().toBase58()}
Mint:     ${mint.publicKey.toBase58()}
Admin:    ${admin.publicKey.toBase58()}
House:    ${house.publicKey.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
