"use client";

import Link from "next/link";
import { use } from "react";
import { EvidenceLadder } from "@/components/EvidenceLadder";
import { Stamp } from "@/components/Stamp";
import { usePoll } from "@/components/usePoll";
import { VerifiedPanel } from "@/components/VerifiedPanel";
import { chain } from "@/lib/chain";
import { accountLink, CONTRACT, LAB_URL } from "@/lib/config";
import { lab } from "@/lib/lab";

const when = (t: number) => new Date(t * 1000).toLocaleString();

export default function ReceiptPage({ params }: { params: Promise<{ market: string; run: string }> }) {
  const p = use(params);
  const marketId = Number(p.market);
  const runIndex = Number(p.run);
  const market = usePoll(() => chain.market(marketId), [marketId]);
  const receipts = usePoll(() => chain.receipts(marketId), [marketId]);
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
  return (
    <>
      <span className="page-no" style={{ marginTop: 6 }}>
        p.{m.id}
      </span>
      <p className="dim" style={{ margin: 0 }}>
        Receipt for run {r.run_index + 1}: the Lab&apos;s permanent record of what it did
      </p>
      <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>
        <Link href={`/market/${m.id}`} className="plain-link">
          {m.spec.title}
        </Link>
      </h1>
      <div className="verdict-line">
        <Stamp outcome={r.outcome} size="xl" />
        <div className="mono">
          The Lab got {r.measured_value ?? "no number"}
          <br />
          The paper reports {r.reported_value}, allowed margin {r.tolerance.split(":")[1]}{r.tolerance.startsWith("rel") ? " (as a fraction)" : ""}
          {r.invalid_reason && (
            <>
              <br />
              Why: {r.invalid_reason.replaceAll("_", " ").toLowerCase()}
            </>
          )}
        </div>
      </div>

      <EvidenceLadder receipt={r} reportHash={r.report_hash} />

      <div className="two-col" style={{ marginTop: 32 }}>
        <VerifiedPanel market={m} receipt={r} />
        <section>
          <h2>The write-up</h2>
          {report.data ? <div className="report">{report.data}</div> : <p className="dim">The write-up isn't available right now. Its fingerprint is below.</p>}
          {r.patches.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Setup fixes the AI made</h3>
              <pre className="diff">{r.patches_diff_excerpt}</pre>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>The full record (technical)</h2>
          <a href={accountLink(CONTRACT)}>See it on the blockchain explorer</a>
        </div>
        <dl className="defs mono">
          <dt>Outcome</dt>
          <dd>{r.outcome}</dd>
          <dt>Claim fingerprint</dt>
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
          <dt>Hardware proof fingerprint</dt>
          <dd>{r.nearai.attestation_digest}</dd>
          <dt>Signed AI replies</dt>
          <dd>{r.nearai.response_signature_refs.join(", ") || "None"}</dd>
          <dt>Log fingerprint</dt>
          <dd>
            {r.full_log_uri ? <a href={`${LAB_URL}/logs/${r.log_hash}`}>{r.log_hash}</a> : r.log_hash}
          </dd>
          <dt>Write-up fingerprint</dt>
          <dd>
            <a href={`${LAB_URL}/reports/${r.report_hash}`}>{r.report_hash}</a>
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
