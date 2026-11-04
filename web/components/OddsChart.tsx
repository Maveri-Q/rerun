"use client";

import { useEffect, useRef, useState } from "react";

/** YES price over time: one thin ballpoint step line drawn on the notebook's own grid. */

interface Point {
  t: number;
  yes_ppm: number;
}

const CELL = 24;
const HEIGHT = CELL * 10;
const LABEL_RIGHT = 64;
const AXIS_BOTTOM = 26;

export function OddsChart({ points, endTime }: { points: Point[]; endTime: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) return <p className="empty dim">No forecasts yet. The first one starts this chart.</p>;

  const first = points[0]!.t;
  const last = Math.max(endTime, points.at(-1)!.t, first + 1);
  const plotW = Math.max(width - LABEL_RIGHT, 80);
  const plotH = HEIGHT - AXIS_BOTTOM;
  const x = (t: number) => ((t - first) / (last - first)) * plotW;
  const y = (ppm: number) => plotH - (ppm / 1_000_000) * plotH;

  let path = `M${x(points[0]!.t)},${y(points[0]!.yes_ppm)}`;
  for (const p of points.slice(1)) path += `H${x(p.t)}V${y(p.yes_ppm)}`;
  path += `H${x(last)}`;

  const current = points.at(-1)!;
  const shown = hover === null ? null : points[hover]!;
  const fmtTime = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;

  const onMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = first + ((e.clientX - rect.left) / plotW) * (last - first);
    let best = 0;
    points.forEach((p, i) => {
      if (p.t <= t) best = i;
    });
    setHover(best);
  };

  return (
    <div>
      <div className="row" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <h3>Chance it holds up, according to forecasters</h3>
        <button className="quiet" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div className="scroll-x" style={{ maxHeight: HEIGHT, overflowY: "auto" }}>
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
        <div className="chart" ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg width={width} height={HEIGHT} role="img" aria-label={`YES price over time, now ${pct(current.yes_ppm)}`}>
            {[0, 500_000, 1_000_000].map((ppm) => (
              <g key={ppm}>
                <line x1={0} x2={plotW} y1={y(ppm)} y2={y(ppm)} stroke={ppm === 500_000 ? "var(--rule)" : "var(--ink)"} strokeWidth={ppm === 0 ? 1.5 : 1} strokeDasharray={ppm === 500_000 ? "2 4" : undefined} />
                <text x={plotW + 8} y={y(ppm) + 4} fontSize={12} fill="var(--ink-2)" fontFamily="var(--font-spline-mono)">
                  {ppm / 10_000}%
                </text>
              </g>
            ))}
            <path d={path} fill="none" stroke="var(--yes)" strokeWidth={2} strokeLinejoin="round" />
            <circle cx={x(last)} cy={y(current.yes_ppm)} r={4} fill="var(--yes)" stroke="var(--paper)" strokeWidth={2} />
            <text x={0} y={plotH + 18} fontSize={12} fill="var(--ink-2)" fontFamily="var(--font-spline-mono)">
              {fmtTime(first)}
            </text>
            <text x={plotW} y={plotH + 18} fontSize={12} textAnchor="end" fill="var(--ink-2)" fontFamily="var(--font-spline-mono)">
              {fmtTime(last)}
            </text>
            {shown && (
              <g>
                <line x1={x(shown.t)} x2={x(shown.t)} y1={0} y2={plotH} stroke="var(--ink)" strokeWidth={1} />
                <circle cx={x(shown.t)} cy={y(shown.yes_ppm)} r={5} fill="var(--yes)" stroke="var(--paper)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {shown && (
            <div className="chart-tip" style={{ left: Math.min(x(shown.t) + 10, Math.max(plotW - 170, 0)) }}>
              YES {pct(shown.yes_ppm)}, {fmtTime(shown.t)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
