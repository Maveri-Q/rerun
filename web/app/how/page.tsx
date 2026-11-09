import { pageMeta } from "@/lib/meta";
import Link from "next/link";
import { ChallengeStory, ClaimSources, SelfCheck, VerdictFan, WhoDoesWhat, WordPrinter } from "@/components/HowExtras";
import { Machine } from "@/components/Machine";

export const metadata = pageMeta("How it works", "How a claim becomes a forecast, a rerun, a public receipt and a payout, and what each word on this site means.", "/how");

export default function HowPage() {
  return (
    <>
      <Machine />

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Three ways it can end</h2>
        </div>
        <VerdictFan />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Where claims come from</h2>
        </div>
        <ClaimSources />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Who does what</h2>
        </div>
        <p className="lede">The AI is never the judge. Each job goes to whoever can&apos;t cheat at it.</p>
        <WhoDoesWhat />
      </section>

      <section className="section" id="challenge">
        <div className="section-head">
          <h2 className="big-head">If you think a verdict is wrong</h2>
        </div>
        <ChallengeStory />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">You don&apos;t have to take our word for it</h2>
        </div>
        <SelfCheck />
      </section>

      <section className="truth">
        <div>
          <h2>What a verdict tells you</h2>
          <p>Whether the code and data named in the claim produce the published number. The label on each claim says whose code it is. Each receipt also shows extra evidence: a stress test for luck, and an experimental rebuild from the paper&apos;s description.</p>
        </div>
        <div>
          <h2>What it can&apos;t tell you</h2>
          <p>Whether the science is true. A study can reproduce and still reach a wrong conclusion. It also can&apos;t rerun a physical experiment like a drug trial, though it can re-check the analysis when the data and code are available.</p>
          <p>
            Only have the paper? <Link href="/check">Check its printed numbers</Link> with no code at all.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Words you&apos;ll see</h2>
        </div>
        <WordPrinter />
      </section>
    </>
  );
}
