"use client";

import Link from "next/link";
import { use } from "react";
import { ClaimNotes } from "@/components/ClaimNotes";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { citedByText, factsFor } from "@/lib/facts";
import { CHECK_OUT_NOTE, verdictWords } from "@/lib/market";
import { NEVER_CHECKED, ORIGIN_LABEL, PRICE_RULE, provenanceOf } from "@/lib/provenance";

export default function FactPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const market = usePoll(() => chain.market(id), [id], 30_000, `market.${id}`);
  const receipts = usePoll(() => chain.receipts(id), [id], 30_000);
  const m = market.data;

  if (market.error && !m) return <p className="notice notice--error" role="status">The blockchain didn&apos;t answer, so this entry can&apos;t be read. This page keeps trying.</p>;
  if (m === undefined) return <p className="empty dim">Reading this entry from the blockchain…</p>;
  const p = m && provenanceOf(m.spec.spec_hash);
  if (!m || !p || m.state !== "Final") {
    return <p className="empty">Claim {id} has no entry yet. Entries are written once a published paper&apos;s claim is settled. <Link href="/facts">See all entries</Link>.</p>;
  }

  const receipt = receipts.data?.at(-1);
  const measured = receipt?.measured_value ?? null;
  const words = verdictWords(m.outcome, m.invalid_reason, measured, m.spec.reported_value);
  const { entry, citedBy } = factsFor(m.spec.spec_hash);
  const cited = citedByText(citedBy);

  return (
    <article className="facts fact" style={{ paddingTop: 36 }}>
      <p className="hint"><Link href="/facts">Verified facts</Link></p>
      <h1 className="page-title">{p.question ?? m.spec.title}</h1>
      <p className={`fact-verdict fact-verdict--${words?.tone}`}>{words?.mark} {words?.words}</p>
      {words?.reason && <p className="fact-numbers">{words.reason}</p>}
      {m.outcome === "REPRODUCED" && <p className="hint">{CHECK_OUT_NOTE}</p>}

      {entry ? (
        <>
          <p className="fact-summary">{entry.summary}</p>
          <p>{entry.background}</p>
          <p>{entry.result}</p>
          <p className="hint">The text was written by a private AI model on NEAR AI ({entry.model}). The verdict and numbers come straight from the blockchain, and the AI can&apos;t change them.</p>
        </>
      ) : (
        <p className="hint">The plain-English write-up for this entry hasn&apos;t been written yet. The verdict and numbers above are final.</p>
      )}

      <dl className="fact-table">
        <dt>What the paper said</dt>
        <dd>
          {p.paperSays ? <>{p.paperSays.quote}. <a href={p.paperSays.href}>{p.paperSays.where}</a></> : m.spec.reported_value}
        </dd>
        <dt>What we got</dt>
        <dd>{measured ?? "No number came out of this run."}</dd>
        <dt>Whose code</dt>
        <dd>{ORIGIN_LABEL[p.origin]}</dd>
        {cited && (<><dt>Attention</dt><dd>{cited}</dd></>)}
        <dt>What forecasters thought</dt>
        <dd>{p.settledShowcase ? "Nobody forecast this one. It was posted as a settled showcase, with the result already known." : `${(m.yes_price_ppm / 10_000).toFixed(0)}% expected it to hold up when forecasting closed. ${PRICE_RULE}`}</dd>
        <dt>Proof</dt>
        <dd>
          {receipt ? <Link href={`/receipt/${m.id}/${receipt.run_index}`}>Read the receipt</Link> : "Reading the receipt…"}{" "}
          or see <Link href={`/market/${m.id}`}>claim {m.id}</Link>
        </dd>
      </dl>

      <section className="not-checked">
        <h2>What we didn&apos;t check</h2>
        <ul>
          {[...NEVER_CHECKED, ...(p.notChecked ?? [])].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <ClaimNotes market={m} />
    </article>
  );
}
