"use client";

import { useMemo, useState } from "react";
import { computeDigest, digestToRoll, verifyCommitment } from "@hashroll/fair";

/** 100% client-side verifier: uses exactly the same code as the server, without calling the API. */
export default function VerifyPage() {
  const [serverSeed, setServerSeed] = useState("");
  const [commitment, setCommitment] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("0");

  const out = useMemo(() => {
    if (!serverSeed || !clientSeed) return null;
    try {
      const digest = computeDigest(serverSeed, clientSeed, Number(nonce));
      return { digest, roll: digestToRoll(digest), ok: commitment ? verifyCommitment(serverSeed, commitment) : null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [serverSeed, commitment, clientSeed, nonce]);

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-white/60">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value.trim())} className="rounded bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs" />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Verify roll</h1>
      <p className="text-sm text-white/60">
        roll = floor(uint32(HMAC_SHA256(serverSeed, clientSeed + &quot;:&quot; + nonce)[0..4]) × 10000 / 2³²) / 100
      </p>
      {field("Server seed (revealed)", serverSeed, setServerSeed)}
      {field("Previously published hash (optional)", commitment, setCommitment)}
      {field("Client seed", clientSeed, setClientSeed)}
      {field("Nonce", nonce, setNonce)}
      {out && "error" in out && <p className="text-rose-400 text-sm">{out.error}</p>}
      {out && "digest" in out && (
        <div className="rounded-xl border border-white/10 p-4 font-mono text-sm flex flex-col gap-2 break-all">
          <div>HMAC: {out.digest}</div>
          <div className="text-3xl">{(out.roll! / 100).toFixed(2)}</div>
          {out.ok !== null && (
            <div className={out.ok ? "text-emerald-400" : "text-rose-400"}>
              {out.ok ? "✓ SHA256(serverSeed) matches the published hash" : "✗ Hash does NOT match — seed tampered with"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
