"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { chain } from "@/lib/chain";
import { rangeText, type Market } from "@/lib/market";
import { PrintedReceipt } from "./PrintedReceipt";

const LOG = ["Fetching the authors' exact code", "Cutting off the internet", "Running their code again", "Reading the final number"];
const RUN_MS = 4200;

type Phase = "idle" | "running" | "done";

const clean = (t: string) => t.replace(/^\[DEMO\]\s*/, "");

/** A small game on the front page: replay a finished claim and make your own call before the verdict prints. */
export function CallIt({ markets }: { markets: Market[] }) {
  const reduce = useReducedMotion();
  const cases = useMemo(() => {
    const seen = new Set<string>();
    return markets
      .filter((m) => m.outcome === "REPRODUCED" || m.outcome === "NOT_REPRODUCED")
      .sort((a, b) => (b.finalized_at ?? 0) - (a.finalized_at ?? 0))
      .filter((m) => (seen.has(m.spec.title) ? false : (seen.add(m.spec.title), true)));
  }, [markets]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [call, setCall] = useState<boolean | null>(null);
  const [measured, setMeasured] = useState<string | null>(null);
  const [flicker, setFlicker] = useState<number | null>(null);
  const [line, setLine] = useState(0);
  const [score, setScore] = useState({ right: 0, played: 0 });
  const timers = useRef<number[]>([]);

  const market = cases[index % Math.max(cases.length, 1)];

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  if (!market) {
    return (
      <div className="call call--empty">
        <div className="receipt-slot" aria-hidden="true" />
        <p>Warming up the printer…</p>
      </div>
    );
  }

  const s = market.spec;
  const range = rangeText(s.reported_value, s.tolerance_kind, s.tolerance_value);
  const [lo, hi] = (range.match(/-?\d+(\.\d+)?/g) ?? ["0", "1"]).map(Number) as [number, number];
  const pad = Math.max(hi - lo, 0.001) * 1.6;
  const min = lo - pad;
  const max = hi + pad;
  const at = (v: number) => `${Math.min(Math.max(((v - min) / (max - min)) * 100, 1), 99)}%`;
  const held = market.outcome === "REPRODUCED";

  const run = (mine: boolean) => {
    setCall(mine);
    setPhase("running");
    setLine(0);
    setMeasured(null);
    const receipts = chain.receipts(market.id);
    const total = reduce ? 600 : RUN_MS;
    LOG.forEach((_, i) => timers.current.push(window.setTimeout(() => setLine(i), (total / LOG.length) * i)));
    if (!reduce) {
      const started = Date.now();
      const tick = () => {
        // The needle hunts around the range, narrowing as the run nears its end. The final number is the real one.
        const left = 1 - (Date.now() - started) / total;
        if (left <= 0) return;
        const centre = (lo + hi) / 2;
        setFlicker(centre + (Math.random() - 0.5) * (max - min) * Math.max(left, 0.2));
        timers.current.push(window.setTimeout(tick, 110));
      };
      tick();
    }
    timers.current.push(
      window.setTimeout(async () => {
        const all = await receipts.catch(() => []);
        setMeasured(all.at(-1)?.measured_value ?? null);
        setFlicker(null);
        setScore((p) => ({ right: p.right + (mine === held ? 1 : 0), played: p.played + 1 }));
        setPhase("done");
      }, total),
    );
  };

  const next = () => {
    setIndex((i) => i + 1);
    setPhase("idle");
    setCall(null);
  };

  return (
    <div className="call">
      <div className="receipt-slot" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        {phase !== "done" ? (
          <motion.div key={`console-${index}`} className="call-console" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <span className="call-kicker">{phase === "idle" ? "Your call" : "The Lab is on it"}</span>
            <p className="call-claim">{clean(s.title)}</p>
            <div className={`call-range ${phase === "idle" ? "call-range--idle" : ""}`} aria-hidden="true">
              <div className="call-track">
                <i className="call-band" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }} />
                <b className="call-needle" style={phase === "running" && flicker !== null ? { left: at(flicker) } : undefined} />
              </div>
              <div className="call-scale">
                <span style={{ left: at(lo) }}>{lo}</span>
                <span style={{ left: at(hi) }}>{hi}</span>
              </div>
            </div>
            {phase === "idle" ? (
              <>
                <p className="call-ask">The paper says {s.reported_value}. It holds up if a re-run lands in the green. Will it?</p>
                <div className="call-buttons">
                  <button className="call-yes" onClick={() => run(true)}>
                    It will hold up
                  </button>
                  <button className="call-no" onClick={() => run(false)}>
                    It won&apos;t
                  </button>
                </div>
              </>
            ) : (
              <ol className="call-log" aria-live="polite">
                {LOG.slice(0, line + 1).map((l, i) => (
                  <li key={l} data-current={i === line}>
                    {l}
                  </li>
                ))}
              </ol>
            )}
          </motion.div>
        ) : (
          <motion.div key={`done-${index}`} className="call-done" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <PrintedReceipt marketId={market.id} title={s.title} outcome={market.outcome!} reported={s.reported_value} range={range} measured={measured} hash={s.spec_hash} when={market.finalized_at} print />
            <motion.div className="call-result" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : 1.3 }}>
              <p className={call === held ? "call-won" : "call-lost"}>{call === held ? "You called it." : "Not this time."}</p>
              <p className="hint">
                {score.right} of {score.played} right so far. This replayed a finished demo claim.
              </p>
              <div className="call-buttons">
                {cases.length > 1 && <button onClick={next}>Try another</button>}
                <Link className="btn quiet" href={`/market/${market.id}`}>
                  See its proof
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A strip of paper tape running across the page, printing what really happened to each claim. */
export function PaperTape({ markets }: { markets: Market[] }) {
  const items = markets.slice(0, 14).map((m) => {
    const verdict = m.outcome === "REPRODUCED" ? "held up" : m.outcome === "NOT_REPRODUCED" ? "did not hold up" : m.outcome === "BROKEN" ? "code broken" : m.outcome === "INVALID" ? "no verdict" : `${(m.yes_price_ppm / 10_000).toFixed(0)}% chance`;
    return `Claim ${String(m.id).padStart(4, "0")}: ${verdict}`;
  });
  if (items.length === 0) return <div className="tape tape--empty" aria-hidden="true" />;
  return (
    <div className="tape" aria-hidden="true">
      <div className="tape-run">
        {[0, 1].map((copy) => (
          <div key={copy} className="tape-copy">
            {items.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
