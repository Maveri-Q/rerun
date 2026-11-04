"use client";

import { checkPaperText, type MeanFinding, type PaperCheck, type StatFinding } from "@rerun/shared/browser";
import { useState } from "react";

const SAMPLE = `Students taught with the new method scored higher than the control group, t(28) = 2.20, p = .036. The effect of practice time was significant, F(2, 30) = 1.00, p < .01. Students rated the course highly (M = 3.47, SD = 1.20, n = 20).`;

type Tone = "good" | "minor" | "serious";

interface Finding {
  tone: Tone;
  headline: string;
  explanation: string;
  printed: string;
  detail?: string;
}

const percent = (p: number) => {
  const value = p * 100;
  if (value < 0.1) return "under 0.1%";
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`;
};

function fromStatistic(s: StatFinding): Finding {
  const detail = `Worked out from the paper's other numbers, the chance this is just luck is about ${percent(s.computedP)}.`;
  switch (s.result) {
    case "consistent":
      return { tone: "good", headline: "Adds up", explanation: "These numbers agree with each other.", printed: s.text, detail };
    case "one_sided":
      return { tone: "good", headline: "Adds up, with a condition", explanation: "These numbers agree if the authors used a less common type of test. The paper should say that it did.", printed: s.text, detail };
    case "inconsistent":
      return { tone: "minor", headline: "Doesn't add up", explanation: "These numbers don't quite agree, though the paper's conclusion would probably stay the same. It may just be a typo.", printed: s.text, detail };
    case "changes_conclusion":
      return {
        tone: "serious",
        headline: "Doesn't add up, and it matters",
        explanation:
          s.computedP < 0.05
            ? "The paper treats this as possibly just luck, but its own numbers point to a real effect."
            : "The paper presents this as a real effect, but its own numbers suggest it could easily be luck.",
        printed: s.text,
        detail,
      };
  }
}

function fromMean(m: MeanFinding): Finding {
  return m.possible
    ? { tone: "good", headline: "Adds up", explanation: "This average is possible.", printed: m.text }
    : {
        tone: "minor",
        headline: "Looks impossible",
        explanation: `If ${m.n} people answered in whole numbers, such as ratings from 1 to 5, their average can't come out as ${m.mean}. This is fine if the answers weren't whole numbers.`,
        printed: m.text,
      };
}

const ORDER: Record<Tone, number> = { serious: 0, minor: 1, good: 2 };
const MARK: Record<Tone, string> = { good: "✓", minor: "!", serious: "!" };
const TONE_CLASS: Record<Tone, string> = { good: "check-pass", minor: "check-warn", serious: "check-fail" };

function summarize(found: number, flagged: number): string {
  if (found === 0) return "No numbers found to check";
  if (flagged === 0) return found === 1 ? "The 1 result we checked adds up" : `All ${found} results we checked add up`;
  return `${found - flagged} of ${found} results add up. ${flagged} ${flagged === 1 ? "needs" : "need"} a closer look.`;
}

export default function CheckPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PaperCheck | null>(null);

  const findings = result ? [...result.statistics.map(fromStatistic), ...result.means.map(fromMean)].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]) : [];

  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Do a paper&apos;s numbers add up?</h1>
      <p className="lede prose">
        A research paper prints numbers that depend on each other, like the items and the total on a receipt. Paste some text from a paper and this checks that they agree. You don&apos;t need the code or the data, and what you paste stays in your browser.
      </p>

      <section style={{ marginTop: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => { setText(SAMPLE); setResult(checkPaperText(SAMPLE)); }}>Try an example</button>
        </div>
        <label className="field">
          <span>Or paste the results section of a paper</span>
          <textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} />
        </label>
        <button className="quiet" disabled={!text.trim()} onClick={() => setResult(checkPaperText(text))}>
          Check the numbers
        </button>
      </section>

      {result && (
        <section className="section" aria-live="polite">
          <div className="section-head">
            <h2>{summarize(findings.length, result.flagged)}</h2>
          </div>
          {findings.length === 0 && <p className="prose">This check reads results in the format most science papers use. Try pasting the paragraphs where the paper reports its results.</p>}
          {findings.length > 0 && (
            <ul className="paper-results">
              {findings.map((f, i) => (
                <li key={i}>
                  <span className={`paper-mark ${TONE_CLASS[f.tone]}`} aria-hidden="true">
                    {MARK[f.tone]}
                  </span>
                  <div>
                    <h3>{f.headline}</h3>
                    <p>{f.explanation}</p>
                    <details>
                      <summary>Show the numbers</summary>
                      <p>
                        <code className="mono">{f.printed}</code>
                      </p>
                      {f.detail && <p>{f.detail}</p>}
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {findings.length > 0 && (
            <p className="notice prose">
              A warning means someone should take a closer look. It&apos;s often just a typo, and it doesn&apos;t prove the research is wrong. A tick only means these numbers agree with each other, not that the research is right.
            </p>
          )}
        </section>
      )}
    </>
  );
}
