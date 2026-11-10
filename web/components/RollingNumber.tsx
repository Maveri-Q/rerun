"use client";

import { useEffect, useState } from "react";

const DIGITS = "0123456789";

/**
 * Digits roll to their new value like an odometer. Other characters (%, ., commas) stay put.
 * The first HTML holds the plain number, so a reader without JavaScript sees "1,060" rather than ten
 * digits per slot; the reels take over once the page is running.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const [running, setRunning] = useState(false);
  useEffect(() => setRunning(true), []);
  if (!running) return <span className={`roll ${className ?? ""}`}>{value}</span>;
  return (
    <span className={`roll ${className ?? ""}`} role="text" aria-label={value}>
      {[...value].map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        // Keyed from the right, so a new leading digit doesn't make the others re-roll.
        const key = value.length - i;
        if (d < 0) {
          return (
            <span key={key} className="roll-char" aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={key} className="roll-slot" aria-hidden="true">
            <span className="roll-reel" style={{ transform: `translateY(${-d * 10}%)` }}>
              {[...DIGITS].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
