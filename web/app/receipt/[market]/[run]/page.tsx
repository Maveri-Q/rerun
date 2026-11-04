"use client";

import Link from "next/link";
import { use } from "react";
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
        Market {marketId} has no receipt for run {runIndex + 1} yet. <Link href={`/market/${marketId}`}>Back to the market</Link>.
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
        Reproduction receipt, run {r.run_index + 1}
      </p>
      <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>
        <Link href={`/market/${m.id}`} className="plain-link">
          {m.spec.title}
        </Link>
      </h1>
      <div className="verdict-line">
        <Stamp outcome={r.outcome} size="xl" />
        <div className="mono">
          Measured {r.measured_value ?? "nothing"}
          <br />
          Reported {r.reported_value}, tolerance {r.tolerance.replace(":", " ")}
          {r.invalid_reason && (
            <>
              <br />
              Reason {r.invalid_reason}
            </>
          )}
        </div>
      </div>

      <div className="two-col">
        <VerifiedPanel market={m} receipt={r} />
        <section>
          <h2>What the Lab reported</h2>
          {report.data ? <div className="report">{report.data}</div> : <p className="dim">The written report is not available right now. Its hash is below.</p>}
          {r.patches.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Environment patches</h3>
              <pre className="diff">{r.patches_diff_excerpt}</pre>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Every field on-chain</h2>
          <a href={accountLink(CONTRACT)}>See the contract on the explorer</a>
        </div>
        <dl className="defs mono">
          <dt>Outcome</dt>
          <dd>{r.outcome}</dd>
          <dt>Claim hash</dt>
          <dd>{r.spec_hash}</dd>
          <dt>Commit</dt>
          <dd>{r.commit}</dd>
          <dt>Data hashes</dt>
          <dd>{r.data_hashes.length ? r.data_hashes.join(", ") : "None"}</dd>
          <dt>Environment lock hash</dt>
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
          <dt>Lab code hash</dt>
          <dd>{r.lab_codehash}</dd>
          <dt>AI model</dt>
          <dd>{r.nearai.model_id}</dd>
          <dt>Attestation digest</dt>
          <dd>{r.nearai.attestation_digest}</dd>
          <dt>Signed AI replies</dt>
          <dd>{r.nearai.response_signature_refs.join(", ") || "None"}</dd>
          <dt>Log hash</dt>
          <dd>
            {r.full_log_uri ? <a href={`${LAB_URL}/logs/${r.log_hash}`}>{r.log_hash}</a> : r.log_hash}
          </dd>
          <dt>Report hash</dt>
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
          m.spec.private_data && <p className="hint">This claim uses private data, so no log content is published. Only the log&apos;s hash is on-chain.</p>
        )}
      </section>
    </>
  );
}
