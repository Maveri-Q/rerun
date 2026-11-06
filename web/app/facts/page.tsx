"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { NumberLine } from "@/components/NumberLine";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { citedByText, factsFor } from "@/lib/facts";
import { verdictWords, yesPercent, type Market } from "@/lib/market";
import { ORIGIN_LABEL, provenanceOf } from "@/lib/provenance";

/** One finished paper: the question, the verdict stamped on it, and where the number landed. */
function FactCard({ market: m }: { market: Market }) {
  const reduce = useReducedMotion();
  const receipts = usePoll(() => chain.receipts(m.id), [m.id], 0, `receipts.${m.id}`);
  const p = provenanceOf(m.spec.spec_hash)!;
  const receipt = receipts.data?.at(-1);
  const measured = receipt?.measured_value ?? null;
  const words = verdictWords(m.outcome, m.invalid_reason);
  const { entry, citedBy } = factsFor(m.spec.spec_hash);
  const cited = citedByText(citedBy);
  return (
    <li className="fact-card">
      <div className="fact-card-head">
        <h2>
          <Link href={`/facts/${m.id}`}>{p.question ?? m.spec.title}</Link>
        </h2>
        <motion.span className={`fact-stamp fact-stamp--${words?.tone}`} initial={reduce ? false : { scale: 2.4, opacity: 0, rotate: 8 }} whileInView={{ scale: 1, opacity: 1, rotate: -4 }} viewport={{ once: true, amount: 0.8 }} transition={{ type: "spring", stiffness: 520, damping: 22, delay: 0.1 }}>
          {words?.mark} {words?.words}
        </motion.span>
      </div>
      {(p.plain || entry) && <p className="fact-card-summary">{p.plain?.claim ?? entry!.summary}</p>}
      {receipts.data && <NumberLine reported={m.spec.reported_value} kind={m.spec.tolerance_kind} margin={m.spec.tolerance_value} measured={measured} tone={words?.tone} noNumber="No number came out of this run" unit={p.plain?.unit} />}
      <p className="fact-card-foot">
        <span>{ORIGIN_LABEL[p.origin]}</span>
        {cited && <span>{cited}</span>}
        <Link href={`/facts/${m.id}`}>Read the whole story</Link>
      </p>
    </li>
  );
}

export default function FactsPage() {
  const markets = usePoll(() => chain.markets(), [], 30_000, "markets");
  const real = (markets.data ?? []).filter((m) => provenanceOf(m.spec.spec_hash));
  const checked = real.filter((m) => m.state === "Final").sort((a, b) => b.id - a.id);
  const open = real.filter((m) => m.state !== "Final" && !provenanceOf(m.spec.spec_hash)?.technical);
  const held = checked.filter((m) => m.outcome === "REPRODUCED").length;
  const fell = checked.filter((m) => m.outcome === "NOT_REPRODUCED" || m.outcome === "BROKEN").length;
  const unsure = checked.length - held - fell;

  return (
    <div className="facts-page">
      <h1 className="page-title">We re-ran the research. Here&apos;s what happened.</h1>
      <p className="lede">The paper&apos;s number, the range that counts, and where our re-run landed. Every result links to proof you can check yourself.</p>
      {markets.data && checked.length > 0 && (
        <p className="tally">
          <span><b>{checked.length}</b> re-run</span>
          <span className="tally--good"><b>{held}</b> held up</span>
          <span className="tally--bad"><b>{fell}</b> didn&apos;t</span>
          {unsure > 0 && <span><b>{unsure}</b> no verdict</span>}
        </p>
      )}
      {markets.error && !markets.data && <p className="notice notice--error" role="status">The blockchain didn&apos;t answer, so the results can&apos;t be read. This page keeps trying.</p>}
      {!markets.data && !markets.error && <p className="empty dim">Reading the finished claims from the blockchain…</p>}
      <ul className="fact-cards">
        {checked.map((m) => (
          <FactCard key={m.id} market={m} />
        ))}
      </ul>
      {open.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Still to be settled</h2>
          </div>
          <ul className="fact-next">
            {open.map((m) => (
              <li key={m.id}>
                <Link href={`/market/${m.id}`}>{provenanceOf(m.spec.spec_hash)?.question ?? m.spec.title}</Link>
                <span>{m.trades > 0 ? `${yesPercent(m).toFixed(0)}% expect it to hold up` : "Open for forecasts"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
