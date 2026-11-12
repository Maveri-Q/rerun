"use client";

import { useId, type CSSProperties } from "react";

export type PunchTone = "good" | "bad" | "unsure";

/** The hole each verdict punches, drawn as a thick stroke in a 64 by 64 box. */
const PUNCH: Record<PunchTone, string> = {
  good: "M15 34 L27 46 L50 20",
  bad: "M19 19 L45 45 M45 19 L19 45",
  unsure: "M17 32 L47 32",
};

/** A tick is green and a cross red, so a verdict reads at a glance; no verdict is a dark slot. */
const HOLE: Record<PunchTone, string> = { good: "#1f9d57", bad: "#d6362b", unsure: "#3a3d3a" };

/**
 * A verdict-shaped hole punched through paper: a raised lip around it, a shadow on its top-left wall,
 * and, for the printing animation, the chip that was punched out.
 */
export function PunchGlyph({ tone, className, chip = false }: { tone: PunchTone; className?: string; chip?: boolean }) {
  const d = PUNCH[tone];
  const mask = `punch-${useId().replace(/:/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" style={{ "--hole": HOLE[tone] } as CSSProperties}>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <path d={d} className="punch-shape" />
        </mask>
      </defs>
      <path className="punch-lip" d={d} />
      <g mask={`url(#${mask})`} className="punch-cut">
        <path className="punch-shadow" d={d} />
        <path className="punch-void" d={d} />
      </g>
      {chip && <path className="punch-chip" d={d} />}
    </svg>
  );
}
