"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ScoutCandidate } from "@/lib/lab";
import { BINS, binOf } from "@/lib/scout-bins";

/** Every paper the scout read, as a slip of paper dropping into the reason it stopped there. */
export function ScoutSieve({ candidates }: { candidates: ScoutCandidate[] }) {
  const reduce = useReducedMotion();
  const turnedDown = candidates.filter((c) => c.status === "rejected");
  const passed = candidates.filter((c) => c.status === "pending" || c.status === "approved" || c.status === "waiting");
  const waiting = candidates.filter((c) => c.status === "retry");
  const bins = [...BINS, { label: "Something else", why: "See the list below.", test: /$^/ }]
    .map((b, i) => ({ ...b, papers: turnedDown.filter((c) => binOf(c.reasons) === i) }))
    .filter((b) => b.papers.length > 0)
    .sort((a, b) => b.papers.length - a.papers.length);
  let order = 0;
  const slip = (c: ScoutCandidate, cls = "") => {
    const delay = order++ * 0.035;
    return <motion.i key={c.id} className={`sieve-slip ${cls}`} title={c.title} initial={reduce ? false : { y: -46, opacity: 0, rotate: -14 }} whileInView={{ y: 0, opacity: 1, rotate: 0 }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 340, damping: 19, delay }} />;
  };
  return (
    <div className="sieve">
      <div className="sieve-row sieve-row--pass">
        <div>
          <h3>Ready for a person to review</h3>
          <p>Passed every check, including two AIs finding the same number in the paper.</p>
        </div>
        <span className="sieve-count">{passed.length}</span>
        <div className="sieve-slips">{passed.map((c) => slip(c, "is-pass"))}</div>
      </div>
      {bins.map((b) => (
        <div className="sieve-row" key={b.label}>
          <div>
            <h3>{b.label}</h3>
            <p>{b.why}</p>
          </div>
          <span className="sieve-count">{b.papers.length}</span>
          <div className="sieve-slips">{b.papers.map((c) => slip(c))}</div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="sieve-row">
          <div>
            <h3>Still being checked</h3>
            <p>It gets another look on the next scan.</p>
          </div>
          <span className="sieve-count">{waiting.length}</span>
          <div className="sieve-slips">{waiting.map((c) => slip(c, "is-wait"))}</div>
        </div>
      )}
    </div>
  );
}
