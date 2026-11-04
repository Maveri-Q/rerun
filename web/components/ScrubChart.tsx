"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface PricePoint {
  t: number;
  yes_ppm: number;
}

/**
 * The YES price over time. Drag or hover to scrub: the line keeps its colour up to the cursor and
 * goes quiet after it. `compact` is the small version inside a closed pill, with no interaction.
 */
export function ScrubChart({
  points,
  height,
  compact,
  onScrub,
}: {
  points: PricePoint[];
  height: number;
  compact?: boolean;
  onScrub?: (p: PricePoint | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const clip = useId();
  const fill = useId();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  // The chart covers the forecasts themselves, not the quiet days around them, so its shape stays readable.
  const first = points[0]?.t ?? 0;
  const newest = points.at(-1)?.t ?? first;
  const last = newest + Math.max((newest - first) * 0.08, 1);
  // A pill spaces its forecasts evenly: on a true time scale, one early forecast reads as a sharp corner.
  const x = (t: number) => ((t - first) / (last - first)) * width;
  // The forecast closest to the cursor, so the reading is always a real price.
  const nearest = (px: number, across: number) => {
    const t = first + (px / Math.max(across, 1)) * (last - first);
    return points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]!);
  };

  // A compact view zooms to the prices seen, so small moves are visible; the full view is 0 to 100%.
  const values = points.map((p) => p.yes_ppm);
  const lo = compact ? Math.min(...values, 500_000) - 40_000 : 0;
  const hi = compact ? Math.max(...values, 500_000) + 40_000 : 1_000_000;
  const pad = 4;
  const y = (ppm: number) => pad + (1 - (ppm - lo) / (hi - lo)) * (height - pad * 2);

  let line = "";
  points.forEach((p, i) => {
    const px = compact ? (points.length > 1 ? (i / (points.length - 1)) * width : 0) : x(p.t);
    line += `${i === 0 ? "M" : "L"}${px.toFixed(1)},${y(p.yes_ppm).toFixed(1)}`;
  });
  const lastPoint = points.at(-1);
  if (lastPoint) line += `L${width},${y(lastPoint.yes_ppm).toFixed(1)}`;
  const area = `${line}L${width},${height}L0,${height}Z`;

  const scrub = (clientX: number) => {
    if (!box.current || compact || points.length === 0) return;
    const rect = box.current.getBoundingClientRect();
    const px = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    setCursor(px);
    onScrub?.(nearest(px, rect.width));
  };
  const release = () => {
    setCursor(null);
    onScrub?.(null);
  };

  const cutoff = cursor ?? width;
  const held = cursor === null || points.length === 0 ? null : nearest(cursor, width);

  return (
    <div
      ref={box}
      className={`scrub ${compact ? "scrub--compact" : ""}`}
      style={{ height }}
      onPointerMove={(e) => scrub(e.clientX)}
      onPointerDown={(e) => scrub(e.clientX)}
      onPointerLeave={release}
    >
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={0} width={cutoff} height={height} />
            </clipPath>
            <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--mint)" stopOpacity={compact ? 0.28 : 0.22} />
              <stop offset="1" stopColor="var(--mint)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {!compact && <line x1={0} x2={width} y1={y(500_000)} y2={y(500_000)} stroke="var(--line-strong)" strokeDasharray="2 5" />}
          <path d={line} fill="none" stroke="var(--line-strong)" strokeWidth={compact ? 1.25 : 1.75} strokeLinejoin="round" />
          <g clipPath={`url(#${clip})`}>
            <path d={area} fill={`url(#${fill})`} />
            <path d={line} fill="none" stroke="var(--mint)" strokeWidth={compact ? 1.25 : 1.75} strokeLinejoin="round" />
          </g>
          {held && cursor !== null && (
            <g>
              <line x1={cursor} x2={cursor} y1={0} y2={height} stroke="var(--ink-3)" />
              <circle cx={x(held.t)} cy={y(held.yes_ppm)} r={4.5} fill="var(--mint)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
