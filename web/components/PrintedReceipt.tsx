"use client";

import { APP_NAME } from "@rerun/shared/browser";
import Link from "next/link";
import type { CSSProperties } from "react";
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

const number = (s: string) => [...s.replace(/,/g, "").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/**
 * How far out of register the Lab's impression lands, in pixels: none when its number falls inside the
 * allowed range, and further the further it misses, measured in widths of that range. A range or number
 * that can't be read gets a middling offset, so a miss still looks like a miss.
 */
export function misregister(range: string, measured: string | null): number {
  const [lo, hi] = number(range);
  const [got] = measured ? number(measured) : [];
  if (lo === undefined || hi === undefined || got === undefined) return 9;
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  if (got >= a && got <= b) return 0;
  const width = Math.max(b - a, Math.abs(b) * 1e-6, 1e-9);
  const out = (got < a ? a - got : got - b) / width;
  return Math.round(Math.min(14, 4 + 3 * Math.log2(1 + out)));
}

/**
 * The verdict, printed like a two-pass press run. The pale first impression is what the paper claimed;
 * the Lab's rerun is the second pass of ink. When the result holds up, the second pass lands exactly
 * on the first ("in register"). When it doesn't, it lands off by an amount that grows with the miss, and
 * the two crosshairs beside it don't meet. An inconclusive run smears.
 */
function RegisterStamp({ tone, text, miss }: { tone: "good" | "bad" | "unsure"; text: string; miss: number }) {
  const off = tone === "good" ? 0 : tone === "bad" ? Math.max(miss, 4) : 0;
  const style = { "--dx": `${off}px`, "--dy": `${-Math.round(off * 0.6)}px` } as CSSProperties;
  const cross = (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 1v22M1 12h22" />
    </>
  );
  return (
    <span className={`register register--${tone}`} style={style}>
      <span className="register-pass">
        <span className="register-ghost" aria-hidden="true">
          {text}
        </span>
        <strong className="register-ink">{text}</strong>
      </span>
      <svg className="register-mark" viewBox="0 0 24 24" aria-hidden="true">
        <g className="register-mark-paper">{cross}</g>
        {tone !== "unsure" && <g className="register-mark-ink">{cross}</g>}
      </svg>
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
        {words ? <RegisterStamp tone={words.tone} text={`${words.mark} ${words.words.toUpperCase()}`} miss={misregister(range, measured)} /> : <strong>NOT CHECKED YET</strong>}
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
