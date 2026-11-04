import { yesPercent, type Market } from "@/lib/market";

export function OddsBar({ market }: { market: Market }) {
  const yes = yesPercent(market);
  return (
    <div>
      <div className="odds-text">
        <span style={{ color: "var(--mint)" }}>YES {yes.toFixed(0)}%</span>
        <span className="dim">NO {(100 - yes).toFixed(0)}%</span>
      </div>
      <div className="odds-bar" aria-hidden="true">
        <i style={{ width: `${yes}%` }} />
        <i style={{ width: `${100 - yes}%` }} />
      </div>
    </div>
  );
}
