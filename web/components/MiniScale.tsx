"use client";

import { useEffect, useState } from "react";
import { yesPercent, type Market } from "@/lib/market";

/** The same scale as the machine on How it works, tipped by this claim's real forecasts. */
export function MiniScale({ market }: { market: Market }) {
  const yes = yesPercent(market);
  // Starts level, then settles to the real chance once the page is showing.
  const [shown, setShown] = useState(50);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(yes), 120);
    return () => window.clearTimeout(id);
  }, [yes]);
  const tilt = Math.max(Math.min((shown - 50) * 0.5, 16), -16);
  const drop = Math.sin((tilt * Math.PI) / 180) * 105;
  return (
    <div className="mini-scale" role="img" aria-label={`Forecasters give YES ${yes.toFixed(0)}% and NO ${(100 - yes).toFixed(0)}%`}>
      <svg viewBox="0 0 300 138" aria-hidden="true">
        <rect x={147} y={26} width={6} height={100} fill="var(--line-strong)" />
        <rect x={110} y={126} width={80} height={5} fill="var(--line-strong)" />
        <rect className="mini-beam" x={45} y={23} width={210} height={6} rx={3} fill="var(--ink)" style={{ transform: `rotate(${-tilt}deg)` }} />
        <circle cx={150} cy={26} r={7} fill="var(--mint)" />
        {[
          { x: 45, off: drop, label: `YES ${yes.toFixed(0)}%`, fill: "var(--mint)" },
          { x: 255, off: -drop, label: `NO ${(100 - yes).toFixed(0)}%`, fill: "var(--ink)" },
        ].map((pan) => (
          <g key={pan.x} className="mini-pan" style={{ transform: `translateY(${pan.off}px)` }}>
            <path d={`M${pan.x} 26L${pan.x - 38} 74M${pan.x} 26L${pan.x + 38} 74`} stroke="var(--line-strong)" />
            <path d={`M${pan.x - 42} 74h84a42 14 0 0 1-84 0z`} fill="var(--surface-2)" stroke="var(--ink-2)" />
            <text x={pan.x} y={108} fill={pan.fill} fontSize={15} fontWeight={600} textAnchor="middle" fontFamily="var(--font-funnel-sans)">
              {pan.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
