import { IDL } from "@hashroll/program";

const PROGRAM_ERRORS = new Map<number, string>(IDL.errors.map((e) => [e.code, e.msg]));

/** Turns wallet, RPC and Anchor errors into a message a player can act on. */
export function friendlyError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const logs: string[] = (e as { logs?: string[] } | null)?.logs ?? [];
  const all = [text, ...logs].join("\n");

  if (/user rejected|rejected the request|declined/i.test(all)) return "Signature cancelled in the wallet.";

  // Anchor logs "Error Code: X. Error Number: N. Error Message: ...".
  const anchor = all.match(/Error Number: (\d+)/);
  const hex = all.match(/custom program error: 0x([0-9a-f]+)/i);
  const code = anchor ? Number(anchor[1]) : hex ? parseInt(hex[1], 16) : null;
  if (code !== null && PROGRAM_ERRORS.has(code)) return PROGRAM_ERRORS.get(code)!;

  if (/insufficient funds/i.test(all)) return "Not enough HROLL in the wallet for this bet.";
  if (/AccountNotInitialized|could not find account|Account does not exist/i.test(all)) {
    return "Your HROLL token account does not exist yet: use the dev faucet first.";
  }
  if (/Attempt to debit an account but found no record of a prior credit/i.test(all)) {
    return "This wallet has no SOL on the local cluster to pay fees: use the dev faucet.";
  }
  return text;
}
