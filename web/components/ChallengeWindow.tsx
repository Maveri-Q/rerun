"use client";

import Link from "next/link";
import { challengeBond, durationWords, fmtUnits, modeUnit, relativeTime, type Config, type Market } from "@/lib/market";

const REASON: Record<string, string> = {
  WRONG_EXTRACTION: "the wrong number was read from the output",
  SCIENCE_PATCHED: "a patch changed the science",
  NONDETERMINISTIC: "the result changes from run to run",
  SPEC_AMBIGUOUS: "the claim is ambiguous",
  OTHER: "something else was wrong",
};

/** The time anyone has to dispute a verdict, shown at every stage of a claim. While it's open, MarketActions takes over. */
export function ChallengeWindow({ market, config }: { market: Market; config: Config }) {
  if (market.state === "Proposed") return null;
  const unit = modeUnit(market.mode);
  const length = durationWords(market.challenge_window);
  const c = market.challenge;

  if (market.state === "Challenged") {
    return (
      <section className="panel window">
        <h2>Someone challenged this verdict</h2>
        <p className="hint">{c ? `They say ${REASON[c.reason] ?? "something is wrong"}. ` : ""}The Lab is running it again with a different AI. If the two runs disagree, the claim ends with no verdict.</p>
      </section>
    );
  }

  if (market.state === "Final") {
    const short = market.challenge_window < 3600;
    return (
      <section className="panel window">
        <h2>{c ? "This verdict was challenged" : "Nobody challenged this verdict"}</h2>
        <p className="hint">
          {c
            ? `Someone said ${REASON[c.reason] ?? "something was wrong"}, so the Lab ran it again with a different AI. ${market.outcome === "INVALID" ? "The runs disagreed, so it ended with no verdict." : "Both runs agreed, so the verdict stood."}`
            : `Anyone had ${length} to dispute it${market.finalized_at ? `, and it became final ${relativeTime(market.finalized_at)}` : ""}.`}
          {short && " This claim had a short window because it was a showcase or a test. Claims open for forecasts get 24 hours."}
        </p>
      </section>
    );
  }

  return (
    <section className="panel window">
      <h2>Think the verdict could be wrong?</h2>
      <ol className="window-steps" aria-label="How a challenge works">
        <li>
          <b>The verdict posts</b>
          <span>Nothing pays out yet.</span>
        </li>
        <li className="is-open">
          <b>{length} to challenge</b>
          <span>
            Put down {fmtUnits(challengeBond(market, config))} {unit} and say what looks wrong.
          </span>
        </li>
        <li>
          <b>The Lab runs it again</b>
          <span>With a different AI. If it agrees, you lose the deposit. If not, there&apos;s no verdict and you get the deposit back, plus a reward.</span>
        </li>
      </ol>
      <p className="hint">
        <Link href="/how#challenge">See challenges that really happened</Link>
      </p>
    </section>
  );
}
