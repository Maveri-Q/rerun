"use client";

import { nearToYocto } from "near-api-js";
import { useEffect, useState } from "react";
import { CONTRACT } from "@/lib/config";
import { challengeBond, fmtUnits, modeUnit, relativeTime, type Config, type Market, type Position } from "@/lib/market";
import { sha256Hex } from "@/lib/seal";
import { explainError, useWallet } from "@/lib/wallet";
import { ftTransferCall, prepareMoney } from "./TradePanel";

const REASONS = [
  { value: "WRONG_EXTRACTION", label: "The wrong number was read from the output" },
  { value: "SCIENCE_PATCHED", label: "A patch changed the science, not just the environment" },
  { value: "NONDETERMINISTIC", label: "The result changes from run to run" },
  { value: "SPEC_AMBIGUOUS", label: "The claim is ambiguous" },
  { value: "OTHER", label: "Something else" },
];

const STORAGE = () => nearToYocto("0.02").toString();

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function countdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** What can be done with this market right now: lock, challenge, finalize, refund, redeem. */
export function MarketActions({ market, config, position, onDone }: { market: Market; config: Config; position: Position | null | undefined; onDone: () => void }) {
  const wallet = useWallet();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("WRONG_EXTRACTION");
  const [note, setNote] = useState("");

  const unit = modeUnit(market.mode);
  const run = async (done: string, fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: done });
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  };

  const bond = challengeBond(market, config);

  const stale =
    (["Open", "Locked"].includes(market.state) && now > market.lock_time + config.run_timeout_secs) ||
    (["Running", "Challenged"].includes(market.state) && market.run_deadline !== null && now > market.run_deadline);
  const needsLock = market.state === "Open" && now >= market.lock_time;
  const windowOpen = market.state === "Proposed" && market.challenge_deadline !== null && now < market.challenge_deadline;
  const canFinalize = market.state === "Proposed" && !windowOpen;
  const hasPosition = position && (BigInt(position.yes) > 0n || BigInt(position.no) > 0n || BigInt(position.lp) > 0n);
  const canRedeem = market.state === "Final" && hasPosition;

  const needsWallet = !wallet.accountId;
  const connect = <button onClick={wallet.signIn}>Connect wallet</button>;

  if (!needsLock && !windowOpen && !canFinalize && !stale && !canRedeem) {
    if (message) return <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status" style={{ marginBottom: 24 }}>{message.text}</p>;
    return market.state === "Final" && wallet.accountId ? <p className="hint" style={{ marginBottom: 24 }}>You have nothing to collect from this claim.</p> : null;
  }

  return (
    <section className="panel" aria-label="Actions">
      {stale && (
        <>
          <h2>The Lab missed its deadline</h2>
          <p className="hint">Anyone can close this claim as invalid, so money never gets stuck. Every share then pays back half.</p>
          <div style={{ marginTop: 12 }}>{needsWallet ? connect : <button disabled={busy} onClick={() => void run("Closed as invalid.", () => wallet.call("refund_stale", { market_id: market.id }))}>Close as invalid</button>}</div>
        </>
      )}
      {needsLock && !stale && (
        <>
          <h2>Forecasting has ended</h2>
          <p className="hint">The Lab normally starts by itself. Anyone can lock the claim to help it along.</p>
          <div style={{ marginTop: 12 }}>{needsWallet ? connect : <button disabled={busy} onClick={() => void run("Locked. The Lab can start now.", () => wallet.call("lock", { market_id: market.id }))}>Lock this claim</button>}</div>
        </>
      )}
      {windowOpen && (
        <>
          <h2>Think this result is wrong?</h2>
          <div className="window-clock" role="img" aria-label="Time left to challenge">
            <i style={{ transform: `scaleX(${Math.max(0, (market.challenge_deadline! - now) / Math.max(market.challenge_window, 1))})` }} />
          </div>
          <p className="hint">
            <span className="mono">{countdown(market.challenge_deadline! - now)}</span> left to challenge it. Put down {fmtUnits(bond)} {unit} and the Lab must run it again with a different AI. If both runs agree, you lose that deposit. If they disagree, the claim becomes invalid and you get it back plus a reward.
          </p>
          {needsWallet ? (
            <div style={{ marginTop: 12 }}>{connect}</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <label className="field">
                <span>What looks wrong?</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Your reasoning (only a fingerprint of it goes on-chain)</span>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button
                disabled={busy || note.trim().length === 0}
                onClick={() =>
                  void run("Challenge posted. The Lab will run again.", async () => {
                    const note_hash = await sha256Hex(note);
                    if (market.mode === "points") await wallet.call("challenge", { market_id: market.id, reason, note_hash }, { deposit: STORAGE() });
                    else {
                      await prepareMoney(wallet);
                      await ftTransferCall(wallet, CONTRACT, bond, { action: "challenge", market_id: market.id, reason, note_hash });
                    }
                  })
                }
              >
                Challenge for {fmtUnits(bond)} {unit}
              </button>
            </div>
          )}
        </>
      )}
      {canFinalize && (
        <>
          <h2>No challenges came in</h2>
          <p className="hint">The time to challenge ended {market.challenge_deadline ? relativeTime(market.challenge_deadline, now * 1000) : ""}. Anyone can make this result final so winners can collect.</p>
          <div style={{ marginTop: 12 }}>{needsWallet ? connect : <button disabled={busy} onClick={() => void run("The result is final. Winners can collect now.", () => wallet.call("finalize", { market_id: market.id }))}>Make it final</button>}</div>
        </>
      )}
      {canRedeem && (
        <>
          <h2>Collect your payout</h2>
          <p className="hint">
            {market.outcome === "INVALID" ? "This claim is invalid, so each YES and NO share pays back half." : `Winning ${market.outcome === "REPRODUCED" ? "YES" : "NO"} shares pay 1 ${unit} each.`} Anything you added to the prize pool comes back too.
          </p>
          <button style={{ marginTop: 12 }} disabled={busy} onClick={() => void run("Collected. It's in your balance.", () => wallet.call("redeem", { market_id: market.id }, { deposit: STORAGE(), gasFree: market.mode === "points" }))}>
            Collect
          </button>
        </>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}
    </section>
  );
}
