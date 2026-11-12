"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { chain } from "@/lib/chain";
import { countsIf, isPractice, modeUnit, relativeTime, stateLabel, verdictWords, type Market, type Outcome } from "@/lib/market";
import { claimName, provenanceOf, studySaid } from "@/lib/provenance";
import { ChanceGauge, PunchTicket } from "./PunchMark";
import { RollingNumber } from "./RollingNumber";
import { ScrubChart, type PricePoint } from "./ScrubChart";
import { usePoll } from "./usePoll";

const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;

/** A claim as a slim pill that springs open into a chart you can scrub. */
export function MarketTicker({ market }: { market: Market }) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<PricePoint | null>(null);
  const reduce = useReducedMotion();
  const history = usePoll(() => chain.priceHistory(market.id), [market.id]);
  // A posted result is only on the receipt until the claim is final.
  const posted = market.state === "Proposed" || market.state === "Challenged";
  const receipts = usePoll(() => (posted ? chain.receipts(market.id) : Promise.resolve([])), [market.id, posted], 0, posted ? `receipts.${market.id}` : undefined);
  const points = history.data ?? [];

  const s = market.spec;
  const shown = held?.yes_ppm ?? market.yes_price_ppm;
  const start = points[0]?.yes_ppm ?? 500_000;
  const change = (shown - start) / 10_000;
  const up = change >= 0;
  const when = held
    ? new Date(held.t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : market.state === "Open"
      ? `Forecasting ends ${relativeTime(market.lock_time)}`
      : stateLabel(market.state);

  // The verdict shows once there is one: final, or posted and still open to challenge.
  const outcome = (market.outcome ?? receipts.data?.at(-1)?.outcome ?? null) as Outcome | null;
  const verdict = verdictWords(outcome);
  const status = verdict
    ? market.outcome
      ? "Final"
      : "Can still be challenged"
    : market.state === "Open"
      ? `Forecasting ends ${relativeTime(market.lock_time)}`
      : stateLabel(market.state);

  return (
    <article className={`ticker ${open ? "ticker--open" : ""} ${verdict ? "ticker--done" : ""}`}>
      <button className="ticker-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ticker-badge">
          {verdict ? <PunchTicket tone={verdict.tone} label={verdict.words} /> : <ChanceGauge ppm={market.yes_price_ppm} />}
        </span>
        <span className="ticker-title">
          <span className="ticker-name">
            {provenanceOf(s.spec_hash)?.flagship && <em className="start-here">Start here</em>}
            {provenanceOf(s.spec_hash)?.fragile && <em className="start-here fragile-chip">Fragile</em>}
            {claimName(market)}
          </span>
          <span className="ticker-meta">{isPractice(market) ? `Claim ${market.id}, made-up practice data` : studySaid(market) ?? countsIf(s.reported_value, s.tolerance_kind, s.tolerance_value)}</span>
        </span>
        {!open && !verdict && (
          <span className="ticker-spark">
            <ScrubChart points={points} height={40} compact />
          </span>
        )}
        <span className="ticker-value">
          {verdict ? <b className={`verdict-word verdict-word--${verdict.tone}`}>{verdict.words}</b> : <b className="verdict-word">{market.state === "Open" ? "Open" : stateLabel(market.state)}</b>}
          <small>{verdict ? status : market.state === "Open" ? status.replace("Forecasting ends ", "Ends ") : "The Lab is on it"}</small>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            className="ticker-body"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={SPRING}
          >
            <div className="ticker-reading">
              <RollingNumber value={pct(shown)} className="ticker-big" />
              <span className={`ticker-change ${up ? "is-up" : "is-down"}`}>
                {up ? "↑" : "↓"} {Math.abs(change).toFixed(1)} points since it opened
              </span>
              <span className="ticker-when">{when}</span>
            </div>
            <ScrubChart points={points} height={190} onScrub={setHeld} />
            <div className="ticker-foot">
              <span className="ticker-when">
                {market.state === "Open" ? `Forecast with ${modeUnit(market.mode)}` : market.outcome ? "Result is final" : stateLabel(market.state)}
              </span>
              <Link className="btn btn--small" href={`/market/${market.id}`}>
                {market.state === "Open" ? "Make a forecast" : "See the evidence"}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
