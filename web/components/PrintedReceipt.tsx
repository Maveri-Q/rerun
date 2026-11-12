"use client";

import { APP_NAME } from "@rerun/shared/browser";
import Link from "next/link";
import { PunchGlyph, type PunchTone } from "./PunchMark";
import { verdictWords, type Outcome } from "@/lib/market";

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
 * The verdict, punched through the receipt like a ticket. The hole is shaped like the verdict: a tick
 * when the result holds up, a cross when it doesn't, a dash when there's no verdict. The punched-out
 * chip falls away, and the words print beside it in plain thermal black.
 */
function Punch({ tone, words }: { tone: PunchTone; words: string }) {
  return (
    <span className="punch">
      <PunchGlyph tone={tone} className="punch-hole" chip />
      <strong className="punch-words">{words}</strong>
    </span>
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
  invalidReason,
  reported,
  range,
  measured,
  hash,
  when,
  print,
  href,
  unit,
}: {
  marketId?: number;
  title: string;
  outcome: Outcome | null;
  invalidReason?: string | null;
  reported: string;
  range: string;
  measured: string | null;
  hash: string;
  when?: number | null;
  print?: boolean;
  href?: string;
  /** What the numbers count. */
  unit?: string;
}) {
  const words = verdictWords(outcome, invalidReason);
  const paper = (
    <div className={`receipt-paper ${print ? "receipt-paper--print" : ""}`}>
      <div className="receipt-top">
        <b>{APP_NAME}</b>
        <span>{marketId === undefined ? "NEW CLAIM" : `CLAIM #${String(marketId).padStart(4, "0")}`}</span>
      </div>
      <p className="receipt-title">{title.replace(/^\[DEMO\]\s*/, "")}</p>
      <dl className="receipt-lines">
        {unit && (
          <div>
            <dt>Measured in</dt>
            <dd>{unit}</dd>
          </div>
        )}
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
        {words ? <Punch tone={words.tone} words={words.words} /> : <strong>NOT CHECKED YET</strong>}
        {words?.tone === "unsure" && <span className="receipt-reason">{words.reason}</span>}
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
