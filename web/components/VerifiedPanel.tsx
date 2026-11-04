"use client";

import type { Market, Receipt } from "@/lib/market";
import { verifyReceipt, type CheckState } from "@/lib/verify";
import { usePoll } from "./usePoll";

const MARK: Record<CheckState, string> = { pass: "✓ yes", fail: "✕ no", warn: "! note" };

/** A lab notebook's "witnessed by" block: each line is checked again here, in this browser. */
export function VerifiedPanel({ market, receipt }: { market: Market; receipt: Receipt }) {
  const { data, error, loading } = usePoll(() => verifyReceipt(market, receipt), [market.id, receipt.run_index]);
  return (
    <section className="witness" aria-label="Verification">
      <h2>Verified</h2>
      <p>Your browser just re-checked these itself, so you don&apos;t have to trust this site.</p>
      {loading && !data && <p style={{ marginTop: 12 }}>Checking…</p>}
      {error && <p className="notice notice--error">The checks could not run: {error}</p>}
      {data && (
        <ul>
          {data.checks.map((c) => (
            <li key={c.label}>
              <span className={`check-mark check-${c.state}`}>{MARK[c.state]}</span>
              <div>
                <h3>{c.label}</h3>
                <p>{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
