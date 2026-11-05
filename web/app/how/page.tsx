import Link from "next/link";
import { VerdictFan, WordPrinter } from "@/components/HowExtras";
import { Machine } from "@/components/Machine";

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

      <section className="truth">
        <div>
          <h2>What a verdict tells you</h2>
          <p>Whether the authors&apos; own code and data produce the number they published. Each receipt also shows extra evidence: a stress test for luck, and an experimental rebuild from the paper&apos;s description.</p>
        </div>
        <div>
          <h2>What it can&apos;t tell you</h2>
          <p>Whether the science is true. A study can reproduce and still reach a wrong conclusion. It also can&apos;t re-run a physical experiment like a drug trial, though it can re-check the analysis when the data and code are available.</p>
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
