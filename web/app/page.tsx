"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketTicker } from "@/components/MarketTicker";
import { PaperTape } from "@/components/PaperTape";
import { PrintedReceipt } from "@/components/PrintedReceipt";
import { RollingNumber } from "@/components/RollingNumber";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab } from "@/lib/lab";
import { isPractice, rangeText, type Market } from "@/lib/market";
import { claimName, provenanceOf } from "@/lib/provenance";

type Filter = "all" | "open" | "settled";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "settled", label: "Finished" },
];

const FIRST_ROWS = 8;

/** Findings people have heard of first, and the ones that need background last. */
const rank = (m: Market) => {
  const p = provenanceOf(m.spec.spec_hash);
  return p?.famous ? 0 : p?.technical ? 2 : 1;
};
const technical = (m: Market) => Boolean(provenanceOf(m.spec.spec_hash)?.technical);

const live = (m: Market) => m.state !== "Final";

export default function Home() {
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const markets = usePoll(() => chain.markets(), [], 15_000, "markets");
  const feed = usePoll(() => lab.recentRuns(), [], 10_000);

  // Only real research is listed. Demos and pipeline checks stay on-chain, reachable by direct link.
  const listed = useMemo(() => (markets.data ?? []).filter((m) => m.state !== "Draft" && !isPractice(m)), [markets.data]);
  const shown = useMemo(() => {
    const rows = listed.filter((m) => (filter === "all" ? true : filter === "settled" ? m.state === "Final" : m.state !== "Final"));
    return [...rows].sort((a, b) => rank(a) - rank(b) || Number(live(b)) - Number(live(a)) || b.id - a.id);
  }, [listed, filter]);

  const latest = useMemo(() => [...listed].filter((m) => m.outcome === "REPRODUCED").sort((a, b) => rank(a) - rank(b) || (b.finalized_at ?? 0) - (a.finalized_at ?? 0))[0], [listed]);
  const receipts = usePoll(() => (latest ? chain.receipts(latest.id) : Promise.resolve([])), [latest?.id], 0, latest ? `receipts.${latest.id}` : undefined);
  const measured = receipts.data?.at(-1)?.measured_value ?? null;

  const papers = listed;
  const stillOpen = papers.filter((m) => m.state === "Open").length;
  const checked = papers.filter((m) => m.state === "Final" && (m.outcome === "REPRODUCED" || m.outcome === "NOT_REPRODUCED"));
  const held = checked.filter((m) => m.outcome === "REPRODUCED");
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Will this research hold up?</h1>
          <p className="lede">
            Many published results don&apos;t. Here you predict which ones will, then an AI lab re-runs the code and data behind them and prints public proof.
          </p>
          <div className="hero-actions">
            <a className="btn" href="#claims">
              See the claims
            </a>
            <Link className="btn quiet" href="/check">
              Check a paper&apos;s numbers
            </Link>
          </div>
          <div className="figures">
            <div className="figure">
              <b>
                <RollingNumber value={markets.data ? `${held.length}/${checked.length}` : "\u2013"} />
              </b>
              <span>checked papers held up</span>
            </div>
            <div className="figure">
              <b>
                <RollingNumber value={markets.data ? String(papers.length) : "\u2013"} />
              </b>
              <span>real papers posted</span>
            </div>
            <div className="figure">
              <b>
                <RollingNumber value={markets.data ? String(stillOpen) : "\u2013"} />
              </b>
              <span>open for forecasts</span>
            </div>
          </div>
        </div>
        {latest?.outcome && (
          <PrintedReceipt
            marketId={latest.id}
            title={claimName(latest)}
            unit={provenanceOf(latest.spec.spec_hash)?.plain?.unit}
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

      <PaperTape markets={[...listed].sort((a, b) => Math.min(rank(a), 1) - Math.min(rank(b), 1) || b.id - a.id)} />

      <section className="band">
        <div className="band-inner">
          <div className="section-head">
            <h2>How a claim gets settled</h2>
            <Link className="band-cta" href="/how">Watch the machine run</Link>
          </div>
          <ol className="how-short">
            <li>
              <h3>Pick a claim</h3>
              <p>A published finding, such as &quot;raising the minimum wage didn&apos;t cost jobs&quot;.</p>
            </li>
            <li>
              <h3>Make a forecast</h3>
              <p>Buy YES if you think it holds up, NO if you don&apos;t. Points are free.</p>
            </li>
            <li>
              <h3>The Lab checks it</h3>
              <p>An AI lab re-runs the code with the internet cut off. You can watch it live.</p>
            </li>
            <li>
              <h3>Winners collect</h3>
              <p>The verdict goes on the blockchain. Anyone can challenge it, and when that time is up, right forecasts pay out.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="claims">
        <div className="section-head">
          <h2>The claims</h2>
          <div className="filters" role="group" aria-label="Filter claims">
            {FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {markets.error && !markets.data && <p className="notice notice--error">Unable to load claims from the blockchain. This page keeps trying.</p>}
        {markets.loading && !markets.data && <p className="empty">Reading the open claims from the blockchain…</p>}
        {markets.data && shown.length === 0 && (
          <p className="empty">
            No claims match this filter. <Link href="/create">Open the first one</Link>.
          </p>
        )}
        <div className="ticker-list">
          {(showAll ? shown : shown.filter((m) => !technical(m)).slice(0, FIRST_ROWS)).map((m) => (
            <MarketTicker key={m.id} market={m} />
          ))}
        </div>
        {!showAll && shown.some(technical) && (
          <button className="quiet show-all" onClick={() => setShowAll(true)}>
            Show the more technical papers too
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
