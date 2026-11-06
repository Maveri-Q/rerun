"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Market, Receipt } from "@/lib/market";
import { verifyReceipt, type CheckState } from "@/lib/verify";
import { usePoll } from "./usePoll";

const MARK: Record<CheckState, string> = { pass: "✓ yes", fail: "✕ no", warn: "! note" };

/** A lab notebook's "witnessed by" block: each line is checked again here, in this browser. */
export function VerifiedPanel({ market, receipt }: { market: Market; receipt: Receipt }) {
  const { data, error, loading } = usePoll(() => verifyReceipt(market, receipt), [market.id, receipt.run_index]);
  const reduce = useReducedMotion();
  return (
    <section className="witness" aria-label="Verification">
      <h2>Verified</h2>
      <p>Your browser just re-checked these itself, so you don&apos;t have to trust this site.</p>
      {loading && !data && <p style={{ marginTop: 12 }}>Checking…</p>}
      {error && <p className="notice notice--error">The checks could not run: {error}</p>}
      {data && (
        <ul>
          {data.checks.map((c, i) => (
            <motion.li key={c.label} initial={reduce ? false : { opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.28, delay: i * 0.16 }}>
              <motion.span className={`check-mark check-${c.state}`} initial={reduce ? false : { scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 520, damping: 18, delay: i * 0.16 + 0.1 }}>
                {MARK[c.state]}
              </motion.span>
              <div>
                <h3>{c.label}</h3>
                <p>{c.detail}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
