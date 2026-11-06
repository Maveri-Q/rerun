import type { Market } from "@/lib/market";
import { claimName } from "@/lib/provenance";

/** A strip of paper tape running across the page, printing what really happened to each claim. */
export function PaperTape({ markets }: { markets: Market[] }) {
  const items = markets.slice(0, 14).map((m) => {
    const verdict = m.outcome === "REPRODUCED" ? "held up" : m.outcome === "NOT_REPRODUCED" ? "did not hold up" : m.outcome === "BROKEN" ? "code broken" : m.outcome === "INVALID" ? "no verdict" : `${(m.yes_price_ppm / 10_000).toFixed(0)}% chance`;
    return `${claimName(m)}: ${verdict}`;
  });
  if (items.length === 0) return <div className="tape-clip" aria-hidden="true"><div className="tape tape--empty" /></div>;
  return (
    <div className="tape-clip" aria-hidden="true">
      <div className="tape">
      <div className="tape-run">
        {[0, 1].map((copy) => (
          <div key={copy} className="tape-copy">
            {items.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
