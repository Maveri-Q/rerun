"use client";

import { motion, useReducedMotion } from "motion/react";
import { linePositions } from "@/lib/line";

export interface NumberLineProps {
  reported: string;
  kind: string;
  margin: string;
  /** What the Lab got, or null when there's no number yet. */
  measured: string | null;
  tone?: "good" | "bad" | "unsure";
  /** Shown in place of the Lab's marker when it has no number. */
  noNumber?: string;
}

/**
 * The whole idea of a claim on one line: the paper's number, the range that counts, and where the
 * Lab's number landed. The Lab's marker travels along the line and stops at its real value.
 */
export function NumberLine({ reported, kind, margin, measured, tone, noNumber = "The Lab hasn't run this yet" }: NumberLineProps) {
  const reduce = useReducedMotion();
  const r = Number(reported);
  const t = Number(margin);
  const width = kind === "rel" ? Math.abs(r) * t : t;
  const m = measured === null ? null : Number(measured);
  if (!Number.isFinite(r) || !Number.isFinite(width) || (m !== null && !Number.isFinite(m))) return null;
  const p = linePositions(r, width, m);
  const align = (x: number) => (x > 72 ? "is-end" : x < 28 ? "is-start" : "");
  const seen = { once: true, amount: 0.6 };
  const summary = m === null ? `The paper says ${reported}. ${noNumber}.` : `The paper says ${reported}. The Lab got ${measured}.`;
  return (
    <div className={`line line--${tone ?? "waiting"}`} role="img" aria-label={summary}>
      <div className="line-marks line-marks--top">
        <motion.span className={`line-mark line-mark--paper ${align(p.paper)}`} style={{ left: `${p.paper}%` }} initial={reduce ? false : { opacity: 0, y: -18 }} whileInView={{ opacity: 1, y: 0 }} viewport={seen} transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}>
          <b>{reported}</b> the paper
        </motion.span>
      </div>
      <div className="line-track">
        <motion.i className="line-band" style={{ left: `${p.low}%`, width: `${p.high - p.low}%`, transformOrigin: `${((p.paper - p.low) / (p.high - p.low)) * 100}% 50%` }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={seen} transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }} />
        <i className="line-pin line-pin--paper" style={{ left: `${p.paper}%` }} />
        {p.lab !== null && <motion.i className="line-pin line-pin--lab" initial={reduce ? false : { left: "0%" }} whileInView={{ left: `${p.lab}%` }} style={{ left: `${p.lab}%` }} viewport={seen} transition={{ type: "spring", stiffness: 55, damping: 11, delay: 0.75 }} />}
      </div>
      <div className="line-marks line-marks--bottom">
        {p.lab !== null ? (
          <motion.span className={`line-mark line-mark--lab ${align(p.lab)}`} style={{ left: `${p.lab}%` }} initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={seen} transition={{ duration: 0.3, delay: 1.5 }}>
            <b>{measured}</b> the Lab
          </motion.span>
        ) : (
          <span className="line-waiting">{noNumber}</span>
        )}
      </div>
      <p className="line-key">
        <i /> Counts as holding up
      </p>
    </div>
  );
}
