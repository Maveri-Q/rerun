"use client";

import Link from "next/link";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { factsFor } from "@/lib/facts";
import { verdictWords } from "@/lib/market";
import { provenanceOf } from "@/lib/provenance";

export default function FactsPage() {
  const markets = usePoll(() => chain.markets(), [], 30_000, "markets");
  const real = (markets.data ?? []).filter((m) => provenanceOf(m.spec.spec_hash));
  const checked = real.filter((m) => m.state === "Final").sort((a, b) => b.id - a.id);
  const waiting = real.length - checked.length;

  return (
    <div className="facts" style={{ paddingTop: 36 }}>
      <h1 className="page-title">Verified facts</h1>
      <p className="lede">Published results we re-ran, in plain English. Each entry links to the proof, so you can check it yourself.</p>
      {markets.error && !markets.data && <p className="notice notice--error" role="status">The blockchain didn&apos;t answer, so the entries can&apos;t be read. This page keeps trying.</p>}
      {!markets.data && !markets.error && <p className="empty dim">Reading the finished claims from the blockchain…</p>}
      <ul className="facts-list">
        {checked.map((m) => {
          const p = provenanceOf(m.spec.spec_hash)!;
          const words = verdictWords(m.outcome, m.invalid_reason);
          return (
            <li key={m.id}>
              <Link href={`/facts/${m.id}`}>
                <h2>{p.question ?? m.spec.title}</h2>
                <span className={`fact-verdict fact-verdict--${words?.tone}`}>{words?.mark} {words?.words}</span>
                {factsFor(m.spec.spec_hash).entry && <p>{factsFor(m.spec.spec_hash).entry!.summary}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
      {waiting > 0 && <p className="hint">{waiting === 1 ? "One more published paper is" : `${waiting} more published papers are`} still open for forecasts. Entries appear here once they&apos;re settled.</p>}
    </div>
  );
}
