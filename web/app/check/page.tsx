"use client";

import { checkPaperText, type PaperCheck, type StatResult } from "@rerun/shared/browser";
import { useState } from "react";

const SAMPLE = `Participants in the training group scored higher than controls, t(28) = 2.20, p = .036. The effect of dose was significant, F(2, 30) = 1.00, p < .01. Ratings of the task were high (M = 3.47, SD = 1.20, n = 20).`;

const RESULT: Record<StatResult, { mark: string; tone: string; text: (p: string) => string }> = {
  consistent: { mark: "✓ matches", tone: "check-pass", text: () => "The printed numbers agree with each other." },
  one_sided: { mark: "✓ one-sided", tone: "check-pass", text: () => "This matches if the authors used a one-sided test. Check that the paper says so." },
  inconsistent: { mark: "! mismatch", tone: "check-warn", text: (p) => `Recalculating gives p = ${p}, which doesn't match what's printed. The conclusion stays the same either way.` },
  changes_conclusion: { mark: "! mismatch", tone: "check-fail", text: (p) => `Recalculating gives p = ${p}. That falls on the other side of the usual .05 cutoff, so it could change the conclusion.` },
};

const fmtP = (p: number) => (p < 0.001 ? "less than .001" : p.toFixed(3).replace(/^0/, ""));

export default function CheckPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PaperCheck | null>(null);

  const found = result ? result.statistics.length + result.means.length : 0;
  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Check a paper&apos;s numbers</h1>
      <p className="lede prose">
        Paste text from a paper to see whether its printed statistics add up. You don&apos;t need the code or the data. This runs entirely in your browser, so nothing you paste is sent anywhere, and no AI is involved.
      </p>

      <section className="section">
        <label className="field">
          <span>Text from the paper</span>
          <textarea rows={9} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder="t(28) = 2.20, p = .036" />
          <p className="hint">Works on results written in the usual style, such as t(28) = 2.20, p = .036, or F, r, z and chi-square results, and averages written like M = 3.47, n = 20.</p>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!text.trim()} onClick={() => setResult(checkPaperText(text))}>
            Check these numbers
          </button>
          <button className="quiet" onClick={() => { setText(SAMPLE); setResult(checkPaperText(SAMPLE)); }}>
            Try an example
          </button>
        </div>
      </section>

      {result && (
        <section className="section" aria-live="polite">
          <div className="section-head">
            <h2>{found === 0 ? "No statistics found" : result.flagged === 0 ? `All ${found} checks passed` : `${result.flagged} of ${found} checks need a closer look`}</h2>
          </div>
          {found === 0 && <p className="prose">Nothing here is written in a style this check can read. Try pasting the paper&apos;s results section.</p>}
          {found > 0 && (
            <ul className="paper-results">
              {result.statistics.map((s, i) => {
                const r = RESULT[s.result];
                return (
                  <li key={`s${i}`}>
                    <span className={`mono check-mark ${r.tone}`}>{r.mark}</span>
                    <div>
                      <code className="mono">{s.text}</code>
                      <p>{r.text(fmtP(s.computedP))}</p>
                    </div>
                  </li>
                );
              })}
              {result.means.map((m, i) => (
                <li key={`m${i}`}>
                  <span className={`mono check-mark ${m.possible ? "check-pass" : "check-warn"}`}>{m.possible ? "✓ possible" : "! unusual"}</span>
                  <div>
                    <code className="mono">{m.text}</code>
                    <p>
                      {m.possible
                        ? "This average is possible for whole-number data, such as ratings or counts."
                        : `If these were whole-number answers, such as ratings, no ${m.n} answers could average ${m.mean}. It's fine if the data isn't whole numbers, or if the average covers several questions.`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="notice prose">A flag means someone should look, not that the paper is wrong. It could be a typo, a rounding choice, or a limit of this check. This only tests whether printed numbers agree with each other, not whether the research is correct.</p>
        </section>
      )}
    </>
  );
}
