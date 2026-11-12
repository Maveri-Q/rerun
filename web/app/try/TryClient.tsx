"use client";

import Link from "next/link";
import { MarketTicker } from "@/components/MarketTicker";
import { TryItNow } from "@/components/TryItNow";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab } from "@/lib/lab";
import { DEMO_LABEL, isPlainDemo } from "@/lib/market";

/** The only place demo claims are listed. They run in minutes, so anyone can follow one from start to finish. */
export default function TryPage() {
  const markets = usePoll(() => chain.markets(), [], 30_000, "markets");
  const health = usePoll(() => lab.health(), [], 30_000);
  const demos = (markets.data ?? []).filter(isPlainDemo).sort((a, b) => b.id - a.id);
  return (
    <div className="section">
      <h1 className="page-title">Try it now</h1>
      <p className="notice">{DEMO_LABEL}.</p>
      <p className="lede">
        Every demo uses made-up practice data, like a pretend shop&apos;s ice cream sales. Make a forecast, watch the Lab retrace it, and see the receipt, all within a few minutes.
      </p>
      {health.data ? (
        <TryItNow />
      ) : (
        !health.loading && <p className="dim">New demos start while the Lab is on, and it&apos;s off right now. In the meantime, see <Link href="/">the real claims</Link>.</p>
      )}
      {demos.length > 0 && (
        <div className="ticker-list try-list">
          {demos.map((m) => (
            <MarketTicker key={m.id} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}
