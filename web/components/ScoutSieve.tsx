"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ScoutCandidate } from "@/lib/lab";
import { BINS, binOf } from "@/lib/scout-bins";

/** A slip's resting tilt, fixed per position so the pile looks hand-dropped but never jumps between renders. */
const tilt = (i: number) => ((i * 37) % 11) - 5;

/** Every paper the scout read, as a slip of paper dropping into the tray for the reason it stopped there. */
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
  const slip = (c: ScoutCandidate, i: number, cls = "") => {
    const delay = order++ * 0.03;
    return (
      <motion.i
        key={c.id}
        className={`sieve-slip ${cls}`}
        title={c.title}
        initial={reduce ? false : { y: -60, opacity: 0, rotate: -20 }}
        whileInView={{ y: 0, opacity: 1, rotate: tilt(i) }}
        style={reduce ? { rotate: tilt(i) } : undefined}
        viewport={{ once: true }}
        transition={{ type: "spring", stiffness: 340, damping: 19, delay }}
      />
    );
  };
  const tray = (key: string, label: string, why: string, papers: ScoutCandidate[], cls = "", slipCls = "") => (
    <div className={`tray ${cls}`} key={key}>
      <div className="tray-head">
        <span className="tray-count">{papers.length}</span>
        <div>
          <h3>{label}</h3>
          <p>{why}</p>
        </div>
      </div>
      <div className="tray-slips" aria-hidden="true">
        {papers.map((c, i) => slip(c, i, slipCls))}
      </div>
    </div>
  );
  return (
    <div className="trays">
      {tray("pass", "Ready for review", "Two AIs found the same number.", passed, "tray--pass", "is-pass")}
      {bins.map((b) => tray(b.label, b.label, b.why, b.papers))}
      {waiting.length > 0 && tray("wait", "Still being checked", "Another look next scan.", waiting, "tray--wait", "is-wait")}
    </div>
  );
}
