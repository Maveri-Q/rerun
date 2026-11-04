"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { ClaimSpec } from "@rerun/shared/browser";
import { MarketActions } from "@/components/MarketActions";
import { OddsBar } from "@/components/MarketRow";
import { OddsChart } from "@/components/OddsChart";
import { RunTerminal } from "@/components/RunTerminal";
import { Stamp } from "@/components/Stamp";
import { TradePanel } from "@/components/TradePanel";
import { usePoll } from "@/components/usePoll";
import { VerifiedPanel } from "@/components/VerifiedPanel";
import { chain } from "@/lib/chain";
import { accountLink, CONTRACT } from "@/lib/config";
import { useRunStream } from "@/lib/lab";
import { fmtUnits, modeUnit, relativeTime, stateLabel, toleranceText, type State } from "@/lib/market";
import { useWallet } from "@/lib/wallet";

const SEQUENCE: { state: State; label: string }[] = [
  { state: "Open", label: "Forecasting" },
  { state: "Locked", label: "Locked" },
  { state: "Running", label: "Lab re-runs it" },
  { state: "Proposed", label: "Receipt posted" },
  { state: "Final", label: "Settled, winners redeem" },
];

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const wallet = useWallet();
  const market = usePoll(() => chain.market(id), [id], 5_000);
  const config = usePoll(() => chain.config(), []);
  const specRaw = usePoll(() => chain.spec(id), [id]);
  const history = usePoll(() => chain.priceHistory(id), [id], 15_000);
  const receipts = usePoll(() => chain.receipts(id), [id], 8_000);
  const position = usePoll(() => (wallet.accountId ? chain.position(wallet.accountId, id) : Promise.resolve(null)), [wallet.accountId, id], 15_000);
  const stream = useRunStream(String(id));

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
  if (market.loading && market.data === undefined) return <p className="empty dim">Opening page {id} of the notebook…</p>;
  if (!market.data) {
    return (
      <p className="empty">
        There is no market {id}. <Link href="/">See all claims</Link>.
      </p>
    );
  }

  const m = market.data;
  const s = m.spec;
  const unit = modeUnit(m.mode);
  const trading = m.state === "Open" && Date.now() / 1000 < m.lock_time;
  const latestReceipt = receipts.data?.at(-1);
  const stepIndex = m.state === "Challenged" ? 3 : SEQUENCE.findIndex((x) => x.state === m.state);
  const chartEnd = m.finalized_at ?? Math.min(Math.floor(Date.now() / 1000), m.lock_time);
  // Only play the stamp when this viewer watched the run finish live.
  const reveal = stream.liveSeen && stream.events.at(-1)?.stage === "done";
  const shownOutcome = m.outcome ?? latestReceipt?.outcome ?? null;

  return (
    <div className="market-grid">
      <div>
        <span className="page-no" style={{ marginTop: 6 }}>
          p.{m.id}
        </span>
        <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>{s.title}</h1>
        <p className="statement">{spec?.statement}</p>

        <div className="claim-figure">
          <span className="claim-value">{s.reported_value}</span>
          <span className="claim-tol">{toleranceText(s.tolerance_kind, s.tolerance_value)}</span>
          <span className="dim">{spec?.metric.name}, as reported. It reproduces if the re-run lands inside this range.</span>
        </div>

        {shownOutcome && (
          <div className="verdict-line">
            <Stamp outcome={shownOutcome} size="xl" reveal={reveal} />
            {latestReceipt && (
              <div>
                <div className="mono">
                  Measured {latestReceipt.measured_value ?? "nothing"}
                  <br />
                  {m.outcome ? "Final" : "Proposed, can still be challenged"}
                </div>
                <Link href={`/receipt/${m.id}/${latestReceipt.run_index}`}>Open the receipt</Link>
              </div>
            )}
          </div>
        )}

        {trading && (
          <a className="btn jump-to-forecast" href="#forecast">
            Make a forecast
          </a>
        )}

        <ol className="steps" aria-label="Market progress">
          {SEQUENCE.map((step, i) => (
            <li key={step.state} data-done={i < stepIndex} aria-current={i === stepIndex ? "step" : undefined}>
              {step.label}
            </li>
          ))}
        </ol>

        <section className="section">
          {history.data ? <OddsChart points={history.data} endTime={chartEnd} /> : <p className="empty dim">Loading the price history…</p>}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Watch the re-run</h2>
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
        </section>

        {latestReceipt && (
          <section className="section">
            <div className="section-head">
              <h2>Receipt</h2>
              <Link href={`/receipt/${m.id}/${latestReceipt.run_index}`}>All fields</Link>
            </div>
            <VerifiedPanel market={m} receipt={latestReceipt} />
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <h2>What exactly gets re-run</h2>
          </div>
          {spec ? (
            <dl className="defs">
              <dt>Source</dt>
              <dd>
                {spec.source.url.includes(".invalid") ? "Demo fixture, not real research" : <a href={spec.source.url}>{spec.source.url}</a>}
                <br />
                <span className="dim">
                  {spec.source.authors}, {spec.source.license}
                </span>
              </dd>
              <dt>Code</dt>
              <dd className="mono">
                {spec.artifact.repo_url.includes(".invalid") ? spec.artifact.repo_url : <a href={spec.artifact.repo_url}>{spec.artifact.repo_url}</a>}
                <br />
                commit {spec.artifact.commit}
              </dd>
              <dt>Runs with</dt>
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
              <dt>Result is read from</dt>
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
                    <span className="dim">sha256 {d.sha256}</span>
                    <br />
                  </span>
                ))}
                {spec.private_data && (
                  <span>
                    Private data, encrypted to the Lab and never revealed
                    <br />
                    <span className="dim">sha256 of the plaintext {spec.private_data.sha256_plain}</span>
                  </span>
                )}
              </dd>
              <dt>Limits</dt>
              <dd className="mono">
                {spec.resources.cpu} CPU, {spec.resources.mem_gb} GB, {spec.resources.max_minutes} minutes
              </dd>
              <dt>Claim hash</dt>
              <dd className="mono">{s.spec_hash}</dd>
            </dl>
          ) : (
            <p className="dim">Loading the claim…</p>
          )}
          <details style={{ marginTop: 12 }}>
            <summary>Show the claim exactly as stored on-chain</summary>
            <pre className="log">{specRaw.data}</pre>
          </details>
        </section>
      </div>

      <aside className="sticky" id="forecast">
        {trading && config.data && <TradePanel market={m} config={config.data} position={position.data} contract={CONTRACT} onDone={refreshAll} />}
        {config.data && <MarketActions market={m} config={config.data} position={position.data} onDone={refreshAll} />}
        <div className="panel">
          <OddsBar market={m} />
          <dl className="defs mono" style={{ gridTemplateColumns: "1fr auto", marginTop: 16 }}>
            <dt>Volume</dt>
            <dd>
              {fmtUnits(m.volume)} {unit}
            </dd>
            <dt>Trades</dt>
            <dd>{m.trades}</dd>
            <dt>{m.state === "Open" ? "Locks" : "Locked"}</dt>
            <dd>{relativeTime(m.lock_time)}</dd>
          </dl>
          <p className="hint" style={{ marginTop: 12 }}>
            Opened by <a href={accountLink(m.creator)}>{m.creator}</a>. Creators may trade their own claims, so weigh the odds with that in mind.
          </p>
          {position.data && (
            <p className="hint">
              Your position: {fmtUnits(position.data.yes)} YES, {fmtUnits(position.data.no)} NO
              {BigInt(position.data.lp) > 0n ? `, ${fmtUnits(position.data.lp)} liquidity (fees ${fmtUnits(position.data.pending_lp_fees)})` : ""}.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
