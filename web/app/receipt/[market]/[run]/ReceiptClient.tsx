"use client";

import { VerifiedOnNear } from "@/components/VerifiedOnNear";
import Link from "next/link";
import { use } from "react";
import { EvidenceLadder } from "@/components/EvidenceLadder";
import { PrintedReceipt } from "@/components/PrintedReceipt";
import { claimName, provenanceOf } from "@/lib/provenance";
import { usePoll } from "@/components/usePoll";
import { APP_NAME } from "@rerun/shared/browser";
import { VerifiedPanel } from "@/components/VerifiedPanel";
import { chain } from "@/lib/chain";
import { accountLink } from "@/lib/config";
import { lab, labFileHref } from "@/lib/lab";
import { Hint } from "@/components/Hint";
import { CHECK_OUT_NOTE, outcomeMeaning, patchAuthors, rangeText, verdictWords, readableReport, isTest } from "@/lib/market";

const when = (t: number) => new Date(t * 1000).toLocaleString();

const BY: Record<string, string> = { ai: "AI", system: "System", human: "Human" };

export default function ReceiptPage({ params }: { params: Promise<{ market: string; run: string }> }) {
  const p = use(params);
  const marketId = Number(p.market);
  const runIndex = Number(p.run);
  const market = usePoll(() => chain.market(marketId), [marketId], 0, `market.${marketId}`);
  const receipts = usePoll(() => chain.receipts(marketId), [marketId], 0, `receipts.${marketId}`);
  const receipt = receipts.data?.find((r) => r.run_index === runIndex);
  const report = usePoll(() => (receipt ? lab.report(receipt.report_hash) : Promise.resolve(null)), [receipt?.report_hash]);

  if (receipts.loading && !receipts.data) return <p className="empty dim">Reading the receipt from the chain…</p>;
  if (receipts.error && !receipts.data) return <p className="notice notice--error">The chain did not answer: {receipts.error}</p>;
  if (!receipt || !market.data) {
    return (
      <p className="empty">
        Claim {marketId} has no receipt for run {runIndex + 1} yet. <Link href={`/market/${marketId}`}>Back to the claim</Link>.
      </p>
    );
  }
  const r = receipt;
  const m = market.data;
  if (isTest(m)) {
    return (
      <p className="empty">
        This was a test of our own system, so it isn&apos;t shown here. <Link href="/">See all claims</Link>.
      </p>
    );
  }
  return (
    <>
      <span className="page-no" style={{ marginTop: 36 }}>Claim {m.id}</span>
      <p className="dim" style={{ margin: "0 0 8px" }}>
        Receipt for run {r.run_index + 1}: the Lab&apos;s permanent record of what it did
      </p>
      <h1 className="market-title">
        <Link href={`/market/${m.id}`} className="plain-link">
          {claimName(m)}
        </Link>
      </h1>
      <div className="verdict-line">
        <PrintedReceipt
          marketId={m.id}
          title={claimName(m)}
          unit={provenanceOf(m.spec.spec_hash)?.plain?.unit}
          outcome={r.outcome}
          invalidReason={r.invalid_reason}
          reported={r.reported_value}
          range={rangeText(m.spec.reported_value, m.spec.tolerance_kind, m.spec.tolerance_value)}
          measured={r.measured_value}
          hash={r.spec_hash}
          when={r.finished_at}
          print
        />
        <div style={{ paddingTop: 20 }}>
          <p className="statement" style={{ margin: 0 }}>{verdictWords(r.outcome, r.invalid_reason, r.measured_value, r.reported_value)?.reason || outcomeMeaning(r.outcome)}</p>
          {r.outcome === "REPRODUCED" && <p className="hint">{CHECK_OUT_NOTE}</p>}
          {r.outcome === "INVALID" && <p className="hint"><Hint term="inconclusive">What does Inconclusive mean?</Hint></p>}
          {r.invalid_reason && <p className="hint">Why: {r.invalid_reason.replaceAll("_", " ").toLowerCase()}</p>}
        </div>
      </div>

      <section className="verify-yourself">
        <h2>Check this yourself</h2>
        <p>You don&apos;t have to trust us or the <Hint term="hardware">secure hardware</Hint>. With Docker and Node installed, this reruns the claim on your own computer and compares the number:</p>
        <pre className="log">{`git clone <this repository> && cd ${APP_NAME.toLowerCase()} && pnpm install && pnpm sandbox:build\npnpm verify-claim ${m.id}`}</pre>
      </section>

      <EvidenceLadder receipt={r} reportHash={r.report_hash} />

      <div className="two-col" style={{ marginTop: 32 }}>
        <VerifiedPanel market={m} receipt={r} />
        <section>
          <h2>The write-up</h2>
          {report.data ? (
            <>
              <div className="report">{readableReport(report.data).text}</div>
              {readableReport(report.data).trimmed && <p className="hint">The stored file also holds the AI&apos;s working notes, which are left out here. The fingerprint below covers the whole file.</p>}
            </>
          ) : (
            <p className="dim">The write-up isn&apos;t available right now. Its fingerprint is below.</p>
          )}
          {r.patches.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Setup changes, and who made them</h3>
              <ul className="patch-list">
                {patchAuthors(r.patches_diff_excerpt).map((p, i) => (
                  <li key={i}>
                    <span className="chip">{BY[p.by] ?? p.by}</span> {p.file}: {p.why}
                  </li>
                ))}
              </ul>
              <pre className="diff">{r.patches_diff_excerpt}</pre>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>The full record (technical)</h2>
        </div>
        <VerifiedOnNear />
        <dl className="defs mono">
          <dt>Outcome</dt>
          <dd>{r.outcome}</dd>
          <dt><Hint term="fingerprint">Claim fingerprint</Hint></dt>
          <dd>{r.spec_hash}</dd>
          <dt>Commit</dt>
          <dd>{r.commit}</dd>
          <dt>Data fingerprints</dt>
          <dd>{r.data_hashes.length ? r.data_hashes.join(", ") : "None"}</dd>
          <dt>Software versions fingerprint</dt>
          <dd>{r.env_lock_hash || "None"}</dd>
          <dt>Runtime</dt>
          <dd>
            {r.runtime_secs}s, exit code {r.exit_code}
          </dd>
          <dt>Started, finished</dt>
          <dd>
            {when(r.started_at)}, {when(r.finished_at)}
          </dd>
          <dt>Lab</dt>
          <dd>
            <a href={accountLink(r.lab_account)}>{r.lab_account}</a>
          </dd>
          <dt>Lab code fingerprint</dt>
          <dd>{r.lab_codehash}</dd>
          <dt>AI used</dt>
          <dd>{r.nearai.model_id}</dd>
          <dt><Hint term="proof">Hardware proof fingerprint</Hint></dt>
          <dd>{r.nearai.attestation_digest}</dd>
          <dt>Signed AI replies</dt>
          <dd>{r.nearai.response_signature_refs.join(", ") || "None"}</dd>
          <dt>Log fingerprint</dt>
          <dd>
            {r.full_log_uri ? <a href={labFileHref("logs", r.log_hash)}>{r.log_hash}</a> : r.log_hash}
          </dd>
          <dt>Write-up fingerprint</dt>
          <dd>
            <a href={labFileHref("reports", r.report_hash)}>{r.report_hash}</a>
          </dd>
        </dl>
        {r.log_tail ? (
          <details style={{ marginTop: 12 }}>
            <summary>Show the end of the run log</summary>
            <pre className="log">{r.log_tail}</pre>
          </details>
        ) : (
          m.spec.private_data && <p className="hint">This claim uses private data, so no log content is published. Only the log&apos;s fingerprint is on-chain.</p>
        )}
      </section>
    </>
  );
}
