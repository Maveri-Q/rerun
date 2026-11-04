"use client";

const DIGITS = "0123456789";

/** Digits roll to their new value like an odometer. Other characters (%, ., commas) stay put. */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
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
