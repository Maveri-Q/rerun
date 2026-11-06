"use client";

import { checkPaperText, type MeanFinding, type PaperCheck, type StatFinding } from "@rerun/shared/browser";
import { motion, useReducedMotion } from "motion/react";
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

/** Splits the text around each number found, so it can be marked where it was printed. */
function markUp(text: string, findings: Finding[]): { text: string; finding?: Finding; order: number }[] {
  const spots = findings
    .map((finding) => ({ finding, at: text.indexOf(finding.printed) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at);
  const pieces: { text: string; finding?: Finding; order: number }[] = [];
  let from = 0;
  spots.forEach(({ finding, at }) => {
    if (at < from) return;
    if (at > from) pieces.push({ text: text.slice(from, at), order: 0 });
    pieces.push({ text: finding.printed, finding, order: findings.indexOf(finding) });
    from = at + finding.printed.length;
  });
  if (from < text.length) pieces.push({ text: text.slice(from), order: 0 });
  return pieces;
}

export default function CheckPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PaperCheck | null>(null);
  const [scanning, setScanning] = useState(false);
  const reduce = useReducedMotion();

  const findings = result ? [...result.statistics.map(fromStatistic), ...result.means.map(fromMean)].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]) : [];

  const check = (value: string) => {
    setResult(null);
    setScanning(true);
    window.setTimeout(() => {
      setResult(checkPaperText(value));
      setScanning(false);
    }, 500);
  };

  const pieces = result ? markUp(text, findings) : [];

  return (
    <div className="check-page">
      <h1 className="check-title">Do a paper&apos;s numbers add up?</h1>
      <p className="lede">
        Science papers report their statistics in a set format, and some of those numbers can be worked out from the others. If they don&apos;t agree, there&apos;s a typo, or a conclusion that doesn&apos;t follow. You only need the paper&apos;s text, and it stays in your browser.
      </p>

      <section className="anatomy" aria-label="What to look for">
        <h2>What to paste</h2>
        <p className="hint">Sentences like this one, usually in the section called Results:</p>
        <p className="anatomy-sample">
          <span>t(<b>28</b>)</span> = <span><b>2.20</b></span>, <span>p = <b>.036</b></span>
        </p>
        <ul className="anatomy-key">
          <li><b>28</b> comes from how much data the study had</li>
          <li><b>2.20</b> is the size of the effect it found</li>
          <li><b>.036</b> is the chance of seeing this by luck alone, which can be worked out from the other two</li>
        </ul>
        <p className="hint">It also reads F(2, 30) = 1.00, p &lt; .01, and averages such as M = 3.47, n = 20. It can&apos;t check plain percentages, tables or figures like &quot;93% accurate&quot;.</p>
      </section>

      <div className="check-work">
        <div className="check-sheet">
          <div className="check-sheet-head">
            <label htmlFor="paper-text">The paper&apos;s text</label>
            <button className="quiet btn--small" onClick={() => { setText(SAMPLE); check(SAMPLE); }}>Try an example</button>
          </div>
          {result || scanning ? (
            <div className={`check-marked ${scanning ? "is-scanning" : ""}`}>
              {scanning && text}
              {!scanning && pieces.map((p, i) => (p.finding ? (
                <motion.mark key={i} className={`pen pen--${p.finding.tone}`} initial={reduce ? false : { backgroundSize: "0% 100%" }} animate={{ backgroundSize: "100% 100%" }} transition={{ duration: 0.4, delay: p.order * 0.35, ease: "easeOut" }}>
                  {p.text}
                </motion.mark>
              ) : (
                <span key={i}>{p.text}</span>
              )))}
            </div>
          ) : (
            <textarea id="paper-text" rows={8} value={text} placeholder="Paste a paragraph from the paper's Results section" onChange={(e) => setText(e.target.value)} />
          )}
          {result ? (
            <button className="quiet" onClick={() => { setResult(null); setText(""); }}>Check another paper</button>
          ) : (
            <button disabled={!text.trim() || scanning} onClick={() => check(text)}>Check the numbers</button>
          )}
        </div>

        <div className="check-findings" aria-live="polite">
          {!result && <p className="check-wait">{scanning ? "Reading the numbers…" : "Each number we can check gets marked in the text, and explained here."}</p>}
          {result && (
            <>
              <h2>{summarize(findings.length, result.flagged)}</h2>
              {findings.length === 0 && <p className="hint">Nothing here is in the format above. Try the paragraphs where the paper reports its tests.</p>}
              <ul className="paper-results">
                {findings.map((f, i) => (
                  <motion.li key={i} initial={reduce ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: i * 0.35 }}>
                    <span className={`paper-mark ${TONE_CLASS[f.tone]}`} aria-hidden="true">{MARK[f.tone]}</span>
                    <div>
                      <h3>{f.headline}</h3>
                      <p>{f.explanation}</p>
                      <details>
                        <summary>Show the numbers</summary>
                        <p><code className="mono">{f.printed}</code></p>
                        {f.detail && <p>{f.detail}</p>}
                      </details>
                    </div>
                  </motion.li>
                ))}
              </ul>
              {findings.length > 0 && <p className="check-note">A warning means someone should take a closer look. It&apos;s often a typo, and doesn&apos;t prove the research is wrong. A tick only means these numbers agree with each other.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
