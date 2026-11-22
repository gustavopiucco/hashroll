"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  configPda,
  fetchBetHistory,
  fetchPlayer,
  isZeroCommitment,
  fromHex,
  placeBetInstruction,
  playerAccounts,
  playerTokenAccount,
  vaultPda,
  type BetHistoryEntry,
  type BetInput,
  type PlayerView,
} from "@hashroll/program";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { getConnection, getProgram } from "@/lib/solana";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function randomClientSeed(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface HouseState {
  mint: PublicKey;
  houseEdgeBps: number;
  settleTimeoutSecs: number;
  maxProfit: bigint;
  paused: boolean;
}

/**
 * Shared state and actions of every game screen. Everything is read straight from the chain;
 * the API is only used to open the player's account and for the dev faucet.
 */
export function useHashroll() {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const address = publicKey?.toBase58();

  const [house, setHouse] = useState<HouseState | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [hroll, setHroll] = useState<bigint>(0n);
  const [sol, setSol] = useState(0);
  const [history, setHistory] = useState<BetHistoryEntry[]>([]);
  const [clientSeed, setClientSeed] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setClientSeed(randomClientSeed()), []);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    const connection = getConnection();
    const program = getProgram();
    const cfg = await program.account.config.fetch(configPda());
    const vault = BigInt((await connection.getTokenAccountBalance(vaultPda())).value.amount);
    const reserved = BigInt(cfg.reserved.toString());
    const free = vault > reserved ? vault - reserved : 0n;
    setHouse({
      mint: cfg.mint,
      houseEdgeBps: cfg.houseEdgeBps,
      settleTimeoutSecs: cfg.settleTimeoutSecs.toNumber(),
      maxProfit: (free * BigInt(cfg.maxPayoutBps)) / 10_000n,
      paused: cfg.paused,
    });
    const [p, tokenBal, lamports, bets] = await Promise.all([
      fetchPlayer(program, publicKey),
      connection.getTokenAccountBalance(playerTokenAccount(cfg.mint, publicKey)).then((b) => BigInt(b.value.amount)).catch(() => 0n),
      connection.getBalance(publicKey),
      fetchBetHistory(connection, publicKey),
    ]);
    setPlayer(p);
    setHroll(tokenBal);
    setSol(lamports / 1e9);
    setHistory(bets);
  }, [publicKey]);

  // On connect: make sure the house opened our account and committed a seed, then load the state.
  useEffect(() => {
    if (!address) return;
    setError(null);
    api
      .open(address)
      .catch((e) => setError(`API: ${friendlyError(e)}`))
      .then(() => refresh())
      .catch((e) => setError(friendlyError(e)));
  }, [address, refresh]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
      setStatus(null);
      refresh().catch(() => {});
    }
  };

  /** Signs with the wallet and submits through our own RPC, so the wallet's network setting does not matter. */
  const submit = async (ix: TransactionInstruction) => {
    if (!publicKey) throw new Error("wallet not connected");
    const connection = getConnection();
    const tx = new Transaction().add(ix);
    tx.feePayer = publicKey;
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = signTransaction
      ? await connection.sendRawTransaction((await signTransaction(tx)).serialize())
      : await sendTransaction(tx, connection);
    const res = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
    return signature;
  };

  /**
   * Places a bet, waits for the house to reveal the seed and returns the settled bet as read from
   * the chain. `onPlaced` fires once the stake is escrowed (start the "rolling" animation there).
   */
  const play = (bet: BetInput, onPlaced?: () => void) =>
    run(async () => {
      if (!publicKey || !house) throw new Error("not ready");
      // Read the player's state fresh: the commitment and nonce must be the ones on-chain right now.
      const current = await fetchPlayer(getProgram(), publicKey);
      if (!current) throw new Error("your player account is not open yet; reconnect the wallet");
      if (current.pending) throw new Error("you already have a pending bet");
      if (isZeroCommitment(fromHex(current.commitment))) throw new Error("the house has not committed a seed yet; try again in a moment");
      const ix = await placeBetInstruction(getProgram(), publicKey, house.mint, bet, clientSeed, current.commitment);
      setStatus("Waiting for wallet signature…");
      await submit(ix);
      onPlaced?.();

      setStatus("Bet escrowed on-chain. Waiting for the house to reveal the seed…");
      const nonce = current.nonce;
      for (let i = 0; i < 120; i++) {
        const p = await fetchPlayer(getProgram(), publicKey);
        if (p && p.nonce > nonce) break;
        await sleep(500);
      }
      const bets = await fetchBetHistory(getConnection(), publicKey, 5);
      setClientSeed(randomClientSeed());
      const entry = bets.find((b) => b.nonce === nonce);
      if (!entry) throw new Error("the bet is still pending; if the house does not settle it, claim it after the timeout");
      return entry;
    });

  const claimExpired = () =>
    run(async () => {
      if (!publicKey || !house) throw new Error("not ready");
      await submit(await getProgram().methods.claimExpired().accountsPartial(playerAccounts(publicKey, house.mint)).instruction());
    });

  const withdrawOwed = () =>
    run(async () => {
      if (!publicKey || !house) throw new Error("not ready");
      await submit(await getProgram().methods.withdrawOwed().accountsPartial(playerAccounts(publicKey, house.mint)).instruction());
    });

  const faucet = () =>
    run(async () => {
      if (!address) throw new Error("wallet not connected");
      await api.faucet(address);
    });

  return {
    address,
    house,
    player,
    hroll,
    sol,
    history,
    clientSeed,
    setClientSeed,
    status,
    error,
    setError,
    busy,
    play,
    claimExpired,
    withdrawOwed,
    faucet,
    refresh,
  };
}

export type Hashroll = ReturnType<typeof useHashroll>;
