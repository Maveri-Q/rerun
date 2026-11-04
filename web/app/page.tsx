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
  { key: "settled", label: "Settled" },
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
          <h1>Will this research result reproduce? Forecast it, then watch it get re-run.</h1>
          <p className="lede">
            Many published results don&apos;t hold up, and checking takes people months. Here an AI lab re-runs the authors&apos; own code and data in a sandbox, then posts a receipt anyone can verify on NEAR. Forecasters who called it right get paid.
          </p>
          <div className="figures">
            <div className="figure">
              <b>{s ? (s.reproduction_rate_bps === null ? "None yet" : `${(s.reproduction_rate_bps / 100).toFixed(0)}%`) : "…"}</b>
              <span>of settled claims reproduced</span>
            </div>
            <div className="figure">
              <b>{s ? s.markets : "…"}</b>
              <span>claims opened</span>
            </div>
            <div className="figure">
              <b>{s ? fmtUnits(s.volume_points, 0) : "…"}</b>
              <span>points forecast</span>
            </div>
            <div className="figure">
              <b>{s ? fmtUnits(s.volume_money, 0) : "…"}</b>
              <span>tUSDC forecast</span>
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
          <h2>Claims under the microscope</h2>
          <div className="filters" role="group" aria-label="Filter claims">
            {FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {markets.error && !markets.data && <p className="notice notice--error">The chain did not answer: {markets.error}. This page retries by itself.</p>}
        {markets.loading && !markets.data && <p className="empty dim">Reading claims from the chain…</p>}
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
          <h2>On the bench</h2>
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
          <p className="empty dim">{feed.loading ? "Asking the Lab what it's working on…" : "The Lab's activity feed is offline. Verdicts still appear above, because they come from the chain."}</p>
        )}
      </section>
    </>
  );
}
