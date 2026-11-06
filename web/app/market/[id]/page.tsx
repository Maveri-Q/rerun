"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { ClaimSpec } from "@rerun/shared/browser";
import { JumpToForecast } from "@/components/JumpToForecast";
import { MarketActions } from "@/components/MarketActions";
import { EvidenceLadder } from "@/components/EvidenceLadder";
import { MiniScale } from "@/components/MiniScale";
import { OddsChart } from "@/components/OddsChart";
import { RunTerminal } from "@/components/RunTerminal";
import { PrintedReceipt } from "@/components/PrintedReceipt";
import { TradePanel } from "@/components/TradePanel";
import { usePoll } from "@/components/usePoll";
import { ClaimNotes } from "@/components/ClaimNotes";
import { VerifiedPanel } from "@/components/VerifiedPanel";
import { chain } from "@/lib/chain";
import { Hint } from "@/components/Hint";
import { citedByText, factsFor } from "@/lib/facts";
import { accountLink, CONTRACT } from "@/lib/config";
import { lab, useRunStream } from "@/lib/lab";
import { NEVER_CHECKED, ORIGIN_LABEL, PRICE_RULE, provenanceOf } from "@/lib/provenance";
import { APP_NAME } from "@rerun/shared/browser";
import { CHECK_OUT_NOTE, fmtUnits, modeUnit, verdictWords, outcomeMeaning, rangeText, relativeTime, stateLabel, toleranceText, type State } from "@/lib/market";
import { useWallet } from "@/lib/wallet";

const SEQUENCE: { state: State; label: string }[] = [
  { state: "Open", label: "People forecast" },
  { state: "Locked", label: "Forecasting ends" },
  { state: "Running", label: "The Lab re-runs it" },
  { state: "Proposed", label: "Verdict posted" },
  { state: "Final", label: "Winners collect" },
];

/** The chain's text can't be edited, so old demo wording is corrected for display only. */
function readableStatement(statement?: string) {
  return statement?.replace(/^DEMO FIXTURE,\s*/i, "A demo, ").replace(/That is a real finding: the result did not reproduce because the code is broken\.?/, "The Lab can't install it, so this comes out inconclusive.");
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const wallet = useWallet();
  const market = usePoll(() => chain.market(id), [id], 5_000, `market.${id}`);
  const config = usePoll(() => chain.config(), []);
  const specRaw = usePoll(() => chain.spec(id), [id]);
  const history = usePoll(() => chain.priceHistory(id), [id], 15_000);
  const receipts = usePoll(() => chain.receipts(id), [id], 8_000);
  const position = usePoll(() => (wallet.accountId ? chain.position(wallet.accountId, id) : Promise.resolve(null)), [wallet.accountId, id], 15_000);
  const stream = useRunStream(String(id));
  const reportHash = receipts.data?.at(-1)?.report_hash;
  const evidence = usePoll(() => (reportHash ? lab.evidenceForReport(reportHash) : Promise.resolve(null)), [reportHash]);

  const spec = useMemo(() => {
    if (!specRaw.data) return null;
    const parsed = ClaimSpec.safeParse(JSON.parse(specRaw.data));
    return parsed.success ? parsed.data : null;
  }, [specRaw.data]);

  const refreshAll = () => {
    void market.refresh();
    void position.refresh();
    void history.refresh();
    void receipts.refresh();
  };

  if (market.error && !market.data) return <p className="notice notice--error">The chain did not answer: {market.error}. This page retries by itself.</p>;
  if (market.loading && market.data === undefined) return <p className="empty dim">Reading this claim from the blockchain…</p>;
  if (!market.data) {
    return (
      <p className="empty">
        There is no claim {id}. <Link href="/">See all claims</Link>.
      </p>
    );
  }

  const m = market.data;
  const s = m.spec;
  const origin = provenanceOf(s.spec_hash);
  const unit = modeUnit(m.mode);
  const trading = m.state === "Open" && Date.now() / 1000 < m.lock_time;
  const latestReceipt = receipts.data?.at(-1);
  const stepIndex = m.state === "Challenged" ? 3 : SEQUENCE.findIndex((x) => x.state === m.state);
  const shownOutcome = m.outcome ?? latestReceipt?.outcome ?? null;

  return (
    <div className="market-grid">
      <div>
        <span className="page-no">Claim {m.id}</span>
        <h1 className="market-title">{s.title.replace(/^\[DEMO\]\s*/, "")}</h1>
        {origin && (
          <p className="origin-chips">
            {origin.flagship && <span className="chip chip--REPRODUCED">Flagship claim</span>}
            <span className={`chip origin-chip--${origin.origin}`}>{ORIGIN_LABEL[origin.origin]}</span>
          </p>
        )}
        {spec?.statement.endsWith("Suggested by the scout agent.") && (
          <p className="origin-chips">
            <Link className="chip" href="/scout">Suggested by the scout agent</Link>
          </p>
        )}
        <p className="statement">{readableStatement(spec?.statement)}</p>
        {origin && (
          <div className="origin">
            <h2>{origin.why.heading}</h2>
            <p>{origin.why.text}</p>
            {origin.why.link && <a href={origin.why.link.href}>{origin.why.link.label}</a>}
          </div>
        )}
        {origin?.numbers && (
          <dl className="both-numbers">
            {origin.numbers.map((n) => (
              <div key={n.value}>
                <dt>{n.value}</dt>
                <dd>
                  <strong>{n.label}</strong>
                  <span>{n.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {origin?.sources && (
          <p className="origin-sources">
            On the acknowledgement:{" "}
            {origin.sources.map((source, i) => (
              <span key={source.href}>
                {i > 0 && ", "}
                <a href={source.href}>{source.label}</a>
              </span>
            ))}
          </p>
        )}
        {origin?.paperSays && (
          <blockquote className="paper-says">
            <span>Paper says</span>
            <code>{origin.paperSays.quote}</code>
            <a href={origin.paperSays.href}>{origin.paperSays.where}</a>
          </blockquote>
        )}
        {origin?.whyItMatters && <p className="why-matters">{origin.whyItMatters}</p>}
        {citedByText(factsFor(s.spec_hash).citedBy) && <p className="test-run-note">{citedByText(factsFor(s.spec_hash).citedBy)}</p>}
        {origin && m.state === "Final" && <p className="test-run-note"><Link href={`/facts/${m.id}`}>Read the plain-English entry</Link></p>}
        {origin?.testRunEarly && <p className="test-run-note">Test-run during development.</p>}
        <p className="hint scope-note">{APP_NAME} checks whether the published numbers can be reproduced from the code and data. It does not judge whether the science is correct. {PRICE_RULE}</p>

        <div className="claim-figure">
          <span className="claim-value">{s.reported_value}</span>
          <span className="claim-tol"><Hint term="margin">{toleranceText(s.tolerance_kind, s.tolerance_value)}</Hint></span>
          <span className="dim">
            The paper reports this {spec?.metric.name}. The claim holds up if the Lab gets {rangeText(s.reported_value, s.tolerance_kind, s.tolerance_value)}.
          </span>
        </div>

        {shownOutcome && (
          <div className="verdict-line">
            <PrintedReceipt
              marketId={m.id}
              title={s.title}
              outcome={shownOutcome}
              invalidReason={m.invalid_reason ?? latestReceipt?.invalid_reason}
              reported={s.reported_value}
              range={rangeText(s.reported_value, s.tolerance_kind, s.tolerance_value)}
              measured={latestReceipt?.measured_value ?? null}
              hash={s.spec_hash}
              when={m.finalized_at ?? latestReceipt?.finished_at}
              print
            />
            {latestReceipt && (
              <div style={{ paddingTop: 20 }}>
                <h3>{m.outcome ? "This result is final" : "This can still be challenged"}</h3>
                <p className="hint" style={{ maxWidth: "38ch", fontSize: 15 }}>{verdictWords(latestReceipt.outcome, latestReceipt.invalid_reason, latestReceipt.measured_value, latestReceipt.reported_value)?.reason || outcomeMeaning(latestReceipt.outcome)}</p>
                {latestReceipt.outcome === "REPRODUCED" && <p className="hint" style={{ maxWidth: "38ch" }}>{CHECK_OUT_NOTE}</p>}
                {latestReceipt.outcome === "INVALID" && <p className="hint"><Hint term="inconclusive">What does Inconclusive mean?</Hint></p>}
                <p className="hint">This slip is the Lab&apos;s <Hint term="receipt">receipt</Hint>.</p>
                {evidence.data?.robustness.status === "sensitive" && <p className="hint fragile" style={{ maxWidth: "38ch" }}>{"\u26A0"} Fragile: the number changed when the random seed changed.</p>}
                <p style={{ marginTop: 14 }}>
                  <Link className="btn quiet btn--small" href={`/receipt/${m.id}/${latestReceipt.run_index}`}>See the full receipt</Link>
                </p>
              </div>
            )}
          </div>
        )}

        {trading && (
          <JumpToForecast />
        )}

        <ol className="steps" aria-label="Market progress">
          {SEQUENCE.map((step, i) => (
            <li key={step.state} data-done={i < stepIndex} aria-current={i === stepIndex ? "step" : undefined}>
              {step.label}
            </li>
          ))}
        </ol>

        <section className="not-checked">
          <h2>What we didn&apos;t check</h2>
          <ul>
            {[...NEVER_CHECKED, ...(origin?.notChecked ?? [])].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="section">
          {origin?.settledShowcase ? <p className="empty">No forecasting on this claim. It was posted with the result already known.</p> : history.data ? <OddsChart points={history.data} /> : <p className="empty dim">Reading how the odds moved…</p>}
        </section>

        {(m.state !== "Final" || stream.events.length > 0) && <section className="section">
          <div className="section-head">
            <h2>Watch the Lab work</h2>
            <span className="dim">{stateLabel(m.state)}</span>
          </div>
          <RunTerminal
            events={stream.events}
            status={stream.status}
            waitingText={
              m.state === "Open"
                ? `The Lab starts when this market locks, ${relativeTime(m.lock_time)}. Stay here to watch it live.`
                : latestReceipt
                  ? "No live log was kept for this run. Its receipt below has the log hash and the end of the output."
                  : "Waiting for the Lab to pick this up."
            }
          />
        </section>}

        {latestReceipt && (
          <section className="section">
            <div className="section-head">
              <h2>The evidence</h2>
              <Link href={`/receipt/${m.id}/${latestReceipt.run_index}`}>See the full receipt</Link>
            </div>
            <EvidenceLadder receipt={latestReceipt} reportHash={latestReceipt.report_hash} />
            <div style={{ marginTop: 24 }}>
              <VerifiedPanel market={m} receipt={latestReceipt} />
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <h2>What the Lab re-runs</h2>
          </div>
          {spec ? (
            <dl className="defs">
              <dt>Source</dt>
              <dd>
                {spec.source.url.includes(".invalid") ? "A demo, not real research" : <a href={spec.source.url}>{spec.source.url}</a>}
                <br />
                <span className="dim">
                  {spec.source.authors}, {spec.source.license}
                </span>
              </dd>
              <dt>Code, at this exact version</dt>
              <dd className="mono">
                {spec.artifact.repo_url.includes(".invalid") ? spec.artifact.repo_url : <a href={spec.artifact.repo_url}>{spec.artifact.repo_url}</a>}
                <br />
                commit {spec.artifact.commit}
              </dd>
              <dt>Commands</dt>
              <dd className="mono">
                {spec.artifact.runtime}
                <br />
                {spec.artifact.setup.map((c) => (
                  <span key={c}>
                    $ {c}
                    <br />
                  </span>
                ))}
                $ {spec.artifact.entrypoint}
              </dd>
              <dt>Where the result is read</dt>
              <dd className="mono">
                {spec.artifact.output.path} using {spec.artifact.output.extractor.type} {spec.artifact.output.extractor.expr}
              </dd>
              <dt>Data files</dt>
              <dd className="mono">
                {spec.artifact.data.length === 0 && !spec.private_data && "None"}
                {spec.artifact.data.map((d) => (
                  <span key={d.path}>
                    {d.path}
                    <br />
                    <span className="dim">fingerprint {d.sha256}</span>
                    <br />
                  </span>
                ))}
                {spec.private_data && (
                  <span>
                    Private data, encrypted so only the Lab can read it, and never revealed
                    <br />
                    <span className="dim">fingerprint {spec.private_data.sha256_plain}</span>
                  </span>
                )}
              </dd>
              <dt>Limits</dt>
              <dd className="mono">
                {spec.resources.cpu} CPU, {spec.resources.mem_gb} GB, {spec.resources.max_minutes} minutes
              </dd>
              <dt><Hint term="fingerprint">Claim fingerprint</Hint></dt>
              <dd className="mono">{s.spec_hash}</dd>
            </dl>
          ) : (
            <p className="dim">Reading the claim as it was stored…</p>
          )}
          <details style={{ marginTop: 12 }}>
            <summary>Show the claim exactly as stored on the blockchain</summary>
            <pre className="log">{specRaw.data}</pre>
          </details>
        </section>

        <ClaimNotes market={m} />
      </div>

      <aside className="sticky" id="forecast">
        {trading && config.data && <TradePanel market={m} config={config.data} position={position.data} contract={CONTRACT} onDone={refreshAll} />}
        {config.data && <MarketActions market={m} config={config.data} position={position.data} onDone={refreshAll} />}
        <div className="panel">
          <MiniScale market={m} />
          <dl className="defs" style={{ gridTemplateColumns: "1fr auto", marginTop: 16, fontSize: 14 }}>
            <dt>Forecast so far</dt>
            <dd>
              {fmtUnits(m.volume)} {unit}
            </dd>
            <dt>Forecasts</dt>
            <dd>{m.trades}</dd>
            <dt>{m.state === "Open" ? "Forecasting ends" : "Forecasting ended"}</dt>
            <dd>{relativeTime(m.lock_time)}</dd>
          </dl>
          <p className="hint" style={{ marginTop: 12 }}>
            Opened by <a href={accountLink(m.creator)}>{m.creator}</a>. Creators can forecast on their own claims, so keep that in mind when reading the odds.
          </p>
          {position.data && (
            <p className="hint">
              Your position: {fmtUnits(position.data.yes)} YES, {fmtUnits(position.data.no)} NO
              {BigInt(position.data.lp) > 0n ? `, ${fmtUnits(position.data.lp)} in the prize pool (earned ${fmtUnits(position.data.pending_lp_fees)})` : ""}.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
