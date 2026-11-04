"use client";

import Link from "next/link";
import type { Outcome } from "@/lib/market";

const VERDICT: Record<Outcome, string> = {
  REPRODUCED: "HELD UP",
  NOT_REPRODUCED: "DID NOT HOLD UP",
  BROKEN: "CODE BROKEN",
  INVALID: "NO VERDICT",
};

/** Bars taken from the claim's real fingerprint, so every receipt's barcode is its own. */
function Barcode({ hash }: { hash: string }) {
  let x = 0;
  const bars: { x: number; w: number }[] = [];
  for (const ch of hash.slice(0, 52)) {
    const n = parseInt(ch, 16);
    const w = 1 + (n % 3);
    const gap = 1 + ((n >> 2) % 2);
    bars.push({ x, w });
    x += w + gap;
  }
  return (
    <svg className="receipt-barcode" viewBox={`0 0 ${x} 34`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={34} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * The verdict as a thermal receipt. RERUN's whole output is a receipt, so this is the one loud thing
 * on the page: white paper against black. `print` feeds it out line by line.
 */
export function PrintedReceipt({
  marketId,
  title,
  outcome,
  reported,
  range,
  measured,
  hash,
  when,
  print,
  href,
}: {
  marketId?: number;
  title: string;
  outcome: Outcome | null;
  reported: string;
  range: string;
  measured: string | null;
  hash: string;
  when?: number | null;
  print?: boolean;
  href?: string;
}) {
  const paper = (
    <div className={`receipt-paper ${print ? "receipt-paper--print" : ""}`}>
      <div className="receipt-top">
        <b>RERUN</b>
        <span>{marketId === undefined ? "NEW CLAIM" : `CLAIM #${String(marketId).padStart(4, "0")}`}</span>
      </div>
      <p className="receipt-title">{title.replace(/^\[DEMO\]\s*/, "")}</p>
      <dl className="receipt-lines">
        <div>
          <dt>Paper says</dt>
          <dd>{reported}</dd>
        </div>
        <div>
          <dt>Counts if</dt>
          <dd>{range}</dd>
        </div>
        <div>
          <dt>Lab got</dt>
          <dd>{measured ?? "no number"}</dd>
        </div>
      </dl>
      <div className="receipt-verdict">
        <span>Verdict</span>
        <strong>{outcome ? VERDICT[outcome] : "NOT CHECKED YET"}</strong>
      </div>
      {hash && <Barcode hash={hash} />}
      <div className="receipt-foot">
        <span>{hash ? hash.slice(0, 20) : "The fingerprint appears when the form is complete"}</span>
        {when ? <span>{new Date(when * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</span> : null}
      </div>
    </div>
  );
  return (
    <div className="receipt">
      <div className="receipt-slot" aria-hidden="true" />
      <div className="receipt-feed">{href ? <Link href={href} className="receipt-link" aria-label={`Open the claim: ${title}`}>{paper}</Link> : paper}</div>
    </div>
  );
}
