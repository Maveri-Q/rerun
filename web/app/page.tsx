"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketTicker } from "@/components/MarketTicker";
import { PaperTape } from "@/components/PaperTape";
import { PrintedReceipt } from "@/components/PrintedReceipt";
import { RollingNumber } from "@/components/RollingNumber";
import { TryItNow } from "@/components/TryItNow";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab } from "@/lib/lab";
import { fmtUnits, rangeText, type Market, type Mode } from "@/lib/market";
import { provenanceOf } from "@/lib/provenance";

type Filter = "all" | Mode | "settled";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "points", label: "Points" },
  { key: "money", label: "tUSDC" },
  { key: "settled", label: "Finished" },
];

const FIRST_ROWS = 8;

/** The flagship, then other published papers, then demos. */
const rank = (m: Market) => {
  const p = provenanceOf(m.spec.spec_hash);
  return p?.flagship ? 0 : p ? 1 : 2;
};

const live = (m: Market) => m.state !== "Final";

export default function Home() {
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const markets = usePoll(() => chain.markets(), [], 15_000, "markets");
  const stats = usePoll(() => chain.stats(), [], 30_000, "stats");
  const feed = usePoll(() => lab.recentRuns(), [], 10_000);

  // Pipeline checks are labelled [TEST]; they stay on-chain and reachable by link, but off the front page.
  const listed = useMemo(() => (markets.data ?? []).filter((m) => m.state !== "Draft" && !m.spec.title.startsWith("[TEST]")), [markets.data]);
  const shown = useMemo(() => {
    const rows = listed.filter((m) => (filter === "all" ? true : filter === "settled" ? m.state === "Final" : m.mode === filter));
    return [...rows].sort((a, b) => rank(a) - rank(b) || Number(live(b)) - Number(live(a)) || b.id - a.id);
  }, [listed, filter]);

  const latest = useMemo(() => [...listed].filter((m) => m.outcome === "REPRODUCED").sort((a, b) => rank(a) - rank(b) || (b.finalized_at ?? 0) - (a.finalized_at ?? 0))[0], [listed]);
  const receipts = usePoll(() => (latest ? chain.receipts(latest.id) : Promise.resolve([])), [latest?.id], 0, latest ? `receipts.${latest.id}` : undefined);
  const measured = receipts.data?.at(-1)?.measured_value ?? null;

  const s = stats.data;
  const rate = s?.reproduction_rate_bps === null || !s ? "0" : (s.reproduction_rate_bps / 100).toFixed(0);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Will this research hold up?</h1>
          <p className="lede">
            Many published results don&apos;t. Here you predict which ones will, then an AI lab re-runs the authors&apos; own code and data and prints public proof.
          </p>
          <p className="hero-steps">Predict, we rerun the study, then see the proof and collect.</p>
          <div className="hero-actions">
            <TryItNow />
            <a className="btn quiet" href="#claims">
              See the claims
            </a>
            <Link className="btn quiet" href="/check">
              Check a paper&apos;s numbers
            </Link>
          </div>
          <div className="figures">
            <div className="figure">
              <b>
                <RollingNumber value={`${rate}%`} />
              </b>
              <span>of checked claims held up</span>
            </div>
            <div className="figure">
              <b>
                <RollingNumber value={String(s?.markets ?? 0)} />
              </b>
              <span>claims opened</span>
            </div>
            <div className="figure">
              <b>
                <RollingNumber value={s ? fmtUnits(s.volume_points, 0) : "0"} />
              </b>
              <span>points predicted</span>
            </div>
          </div>
        </div>
        {latest?.outcome && (
          <PrintedReceipt
            marketId={latest.id}
            title={latest.spec.title}
            outcome={latest.outcome}
            reported={latest.spec.reported_value}
            range={rangeText(latest.spec.reported_value, latest.spec.tolerance_kind, latest.spec.tolerance_value)}
            measured={measured}
            hash={latest.spec.spec_hash}
            when={latest.finalized_at}
            print
            href={`/market/${latest.id}`}
          />
        )}
      </section>

      <PaperTape markets={listed} />

      <section className="band">
        <div className="band-inner">
          <div className="section-head">
            <h2>From a published claim to printed proof, in four steps.</h2>
            <Link className="band-cta" href="/how">Watch the machine run</Link>
          </div>
          <ol className="how-short">
            <li>
              <h3>Pick a claim</h3>
              <p>A published result, such as &quot;this model is 93% accurate&quot;.</p>
            </li>
            <li>
              <h3>Make a forecast</h3>
              <p>Buy YES if you think it holds up, NO if you don&apos;t. Points are free.</p>
            </li>
            <li>
              <h3>The Lab checks it</h3>
              <p>An AI lab re-runs the original code. You can watch it live.</p>
            </li>
            <li>
              <h3>Winners collect</h3>
              <p>The receipt goes on the blockchain and right forecasts pay out.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="claims">
        <div className="section-head">
          <h2>Claims you can forecast</h2>
          <div className="filters" role="group" aria-label="Filter claims">
            {FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {markets.error && !markets.data && <p className="notice notice--error">Unable to load claims from the blockchain. This page keeps trying.</p>}
        {markets.loading && !markets.data && <p className="empty">Loading claims…</p>}
        {markets.data && shown.length === 0 && (
          <p className="empty">
            No claims match this filter. <Link href="/create">Open the first one</Link>.
          </p>
        )}
        <div className="ticker-list">
          {(showAll ? shown : shown.slice(0, FIRST_ROWS)).map((m) => (
            <MarketTicker key={m.id} market={m} />
          ))}
        </div>
        {!showAll && shown.length > FIRST_ROWS && (
          <button className="quiet show-all" onClick={() => setShowAll(true)}>
            Show all {shown.length} claims
          </button>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What the Lab is doing</h2>
          <Link href="/lab">How the Lab works</Link>
        </div>
        {feed.data && feed.data.length > 0 ? (
          <ul className="feed">
            {feed.data.map(({ run, event }) => (
              <li key={run}>
                <Link className="mono" href={`/market/${run}`}>
                  Claim {run}
                </Link>
                <span>{event.message}</span>
                <time className="mono">{new Date(event.at).toLocaleTimeString(undefined, { hour12: false })}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{feed.loading ? "Checking on the Lab…" : "The Lab's live feed is offline. Verdicts still appear above."}</p>
        )}
      </section>
    </>
  );
}
