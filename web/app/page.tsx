"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketRow } from "@/components/MarketRow";
import { Stamp } from "@/components/Stamp";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab } from "@/lib/lab";
import { fmtUnits, type Market, type Mode } from "@/lib/market";

type Filter = "all" | Mode | "settled";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "points", label: "Points" },
  { key: "money", label: "tUSDC" },
  { key: "settled", label: "Finished" },
];

const live = (m: Market) => m.state !== "Final";

export default function Home() {
  const [filter, setFilter] = useState<Filter>("all");
  const markets = usePoll(() => chain.markets(), [], 15_000);
  const stats = usePoll(() => chain.stats(), [], 30_000);
  const feed = usePoll(() => lab.recentRuns(), [], 10_000);

  // Pipeline checks are labelled [TEST]; they stay on-chain and reachable by link, but off the front page.
  const listed = useMemo(() => (markets.data ?? []).filter((m) => m.state !== "Draft" && !m.spec.title.startsWith("[TEST]")), [markets.data]);
  const shown = useMemo(() => {
    const rows = listed.filter((m) => (filter === "all" ? true : filter === "settled" ? m.state === "Final" : m.mode === filter));
    return [...rows].sort((a, b) => Number(live(b)) - Number(live(a)) || b.id - a.id);
  }, [listed, filter]);
  const latest = useMemo(() => [...listed].filter((m) => m.outcome).sort((a, b) => (b.finalized_at ?? 0) - (a.finalized_at ?? 0))[0], [listed]);

  const s = stats.data;
  return (
    <>
      <section className="hero">
        <div>
          <h1>Will this research hold up? Predict it, then watch an AI check it.</h1>
          <p className="lede">
            Many published results don&apos;t hold up, but checking takes months, so it rarely happens. Here you predict whether a result will hold up. Then an AI lab re-runs the authors&apos; own code and data and posts public proof of what it found. If you called it right, you win.
          </p>
          <div className="figures">
            <div className="figure">
              <b>{s ? (s.reproduction_rate_bps === null ? "None yet" : `${(s.reproduction_rate_bps / 100).toFixed(0)}%`) : "…"}</b>
              <span>of checked claims held up</span>
            </div>
            <div className="figure">
              <b>{s ? s.markets : "…"}</b>
              <span>claims opened</span>
            </div>
            <div className="figure">
              <b>{s ? fmtUnits(s.volume_points, 0) : "…"}</b>
              <span>points predicted</span>
            </div>
            <div className="figure">
              <b>{s ? fmtUnits(s.volume_money, 0) : "…"}</b>
              <span>test tUSDC predicted</span>
            </div>
          </div>
        </div>
        {latest?.outcome && (
          <Link className="specimen" href={`/market/${latest.id}`} aria-label={`Latest verdict on ${latest.spec.title}`}>
            <p>{latest.spec.title}</p>
            <Stamp outcome={latest.outcome} />
          </Link>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
          <Link href="/how">Read the full guide</Link>
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
            <p>The verdict goes on the blockchain and right forecasts pay out.</p>
          </li>
        </ol>
      </section>

      <section className="section">
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
        {markets.loading && !markets.data && <p className="empty dim">Loading claims…</p>}
        {markets.data && shown.length === 0 && (
          <p className="empty">
            No claims match this filter. <Link href="/create">Open the first one</Link>.
          </p>
        )}
        {shown.map((m) => (
          <MarketRow key={m.id} market={m} />
        ))}
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
                  p.{run}
                </Link>
                <span>{event.message}</span>
                <time className="mono dim">{new Date(event.at).toLocaleTimeString(undefined, { hour12: false })}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty dim">{feed.loading ? "Checking on the Lab…" : "The Lab's live feed is offline. Verdicts still appear above."}</p>
        )}
      </section>
    </>
  );
}
