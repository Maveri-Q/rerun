"use client";

import { useState } from "react";
import { RollingNumber } from "./RollingNumber";
import { ScrubChart, type PricePoint } from "./ScrubChart";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;

/** The chance over time. Drag across it to read any moment. */
export function OddsChart({ points }: { points: PricePoint[] }) {
  const [held, setHeld] = useState<PricePoint | null>(null);
  const [asTable, setAsTable] = useState(false);

  if (points.length < 2) return <p className="empty">No forecasts yet. The first one starts this chart.</p>;

  const current = points.at(-1)!;
  const shown = held ?? current;
  const change = (shown.yes_ppm - points[0]!.yes_ppm) / 10_000;
  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontWeight: 400, color: "var(--ink-2)", fontSize: 14.5 }}>Chance it holds up, according to forecasters</h3>
          <RollingNumber value={pct(shown.yes_ppm)} className="ticker-big" />
          <span className={`ticker-change ${change >= 0 ? "is-up" : "is-down"}`}>
            {change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)} points since it opened
          </span>
          <span className="ticker-when">{fmtTime(shown.t)}</span>
        </div>
        <button className="quiet btn--small" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div className="scroll-x" style={{ maxHeight: 240, overflowY: "auto" }}>
          <table className="mono">
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">Chance of YES</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={`${p.t}-${p.yes_ppm}`}>
                  <td>{fmtTime(p.t)}</td>
                  <td className="num">{pct(p.yes_ppm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ScrubChart points={points} height={220} onScrub={setHeld} />
      )}
    </div>
  );
}
