import Link from "next/link";
import { modeUnit, rangeText, relativeTime, stateLabel, yesPercent, type Market } from "@/lib/market";
import { Stamp } from "./Stamp";

export function OddsBar({ market }: { market: Market }) {
  const yes = yesPercent(market);
  return (
    <div>
      <div className="odds-text">
        <span style={{ color: "var(--yes)" }}>YES {yes.toFixed(0)}%</span>
        <span style={{ color: "var(--no)" }}>NO {(100 - yes).toFixed(0)}%</span>
      </div>
      <div className="odds-bar" aria-hidden="true">
        <i style={{ width: `${yes}%` }} />
        <i style={{ width: `${100 - yes}%` }} />
      </div>
    </div>
  );
}

/** One claim as a notebook entry. The page number in the margin is the market's on-chain id. */
export function MarketRow({ market }: { market: Market }) {
  const s = market.spec;
  const when = market.state === "Open" ? `Forecasting ends ${relativeTime(market.lock_time)}` : stateLabel(market.state);
  return (
    <Link href={`/market/${market.id}`} className="ledger-row">
      <div>
        <span className="page-no">p.{market.id}</span>
        <h3>{s.title}</h3>
        <div className="ledger-meta">
            {when}. {market.state === "Open" ? `Forecast with ${modeUnit(market.mode)}. ` : ""}{s.private_data ? "Uses private data." : ""}
        </div>
      </div>
      <div className="claimed">
        {s.reported_value}
        <small style={{ display: "block" }}>counts if {rangeText(s.reported_value, s.tolerance_kind, s.tolerance_value)}</small>
      </div>
      <div>{market.outcome ? <Stamp outcome={market.outcome} size="sm" /> : <OddsBar market={market} />}</div>
    </Link>
  );
}
