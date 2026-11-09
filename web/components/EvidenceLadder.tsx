"use client";

import { lab, type Evidence } from "@/lib/lab";
import { outcomeMeaning, type Receipt } from "@/lib/market";
import { usePoll } from "./usePoll";

type Level = "strong" | "warning" | "none";

function Rung({ step, title, level, children }: { step: number; title: string; level: Level; children: React.ReactNode }) {
  const mark = level === "strong" ? "✓" : level === "warning" ? "!" : "–";
  const tone = level === "strong" ? "check-pass" : level === "warning" ? "check-warn" : "dim";
  return (
    <li>
      <span className={`mono ${tone}`}>
        {step}. {mark}
      </span>
      <div>
        <h3>{title}</h3>
        <div className="rung-body">{children}</div>
      </div>
    </li>
  );
}

function Stress({ evidence }: { evidence: Evidence | null }) {
  const r = evidence?.robustness;
  if (!r) return <p>This check was not run on this claim.</p>;
  const values = r.runs.map((x) => x.value).filter((v): v is string => v !== null);
  const range = values.length ? `Extra runs got ${values.join(", ")}.` : "";
  if (r.status === "stable") {
    return (
      <p>
        The number held steady when the code ran again with different randomness and resampled data. {range}
        {r.seed_had_effect === false && " Changing the random seed made no difference, so the code may not use randomness."}
      </p>
    );
  }
  if (r.status === "sensitive") {
    return (
      <p>
        The code gave {r.measured}, but the number moved past the allowed margin when rerun with different randomness or resampled data. {range} The result may depend partly on luck. This doesn&apos;t change the verdict.
      </p>
    );
  }
  return <p>{r.reason ?? "This check could not finish."}</p>;
}

function Rebuild({ evidence }: { evidence: Evidence | null }) {
  const r = evidence?.reimplementation;
  if (!r) return <p>This check was not run on this claim.</p>;
  if (r.status === "not_attempted") return <p>Not attempted. {r.reason}</p>;
  return (
    <>
      {r.status === "agrees" && <p>Working only from the paper&apos;s written description, without the authors&apos; code or their result, the AI wrote its own analysis and got {r.value}. That agrees with the claim.</p>}
      {r.status === "differs" && <p>Working only from the paper&apos;s written description, the AI wrote its own analysis and got {r.value}, which differs from the claim. The paper may be vague or the AI may be wrong, so this is a reason to look closer, not proof of an error.</p>}
      {r.status === "could_not_complete" && <p>The AI could not finish this. {r.reason}</p>}
      {r.script && (
        <details>
          <summary>Read the analysis the AI wrote</summary>
          <pre className="log">{r.script}</pre>
        </details>
      )}
    </>
  );
}

/** How much evidence stands behind a result. Only the first rung settles the market. */
export function EvidenceLadder({ receipt, reportHash }: { receipt: Receipt; reportHash: string }) {
  const { data, loading } = usePoll(() => lab.evidenceForReport(reportHash), [reportHash]);
  const evidence = data ?? null;
  const reproduced = receipt.outcome === "REPRODUCED";
  const robust = evidence?.robustness.status;
  const rebuilt = evidence?.reimplementation.status;
  return (
    <section className="witness ladder" aria-label="Evidence behind this result">
      <h2>How much evidence is behind this?</h2>
      <p>Each step is a tougher test. Only the first one decides who wins the market.</p>
      <ol>
        <Rung step={1} title="The Lab's rerun of the code and data named in the claim" level={reproduced ? "strong" : "warning"}>
          <p>{outcomeMeaning(receipt.outcome)}</p>
        </Rung>
        <Rung step={2} title="Stress test: does the number depend on luck?" level={robust === "stable" ? "strong" : robust === "sensitive" ? "warning" : "none"}>
          {loading && !data ? <p>Fetching the extra runs…</p> : <Stress evidence={evidence} />}
        </Rung>
        <Rung step={3} title="Rebuilt from the description (experimental)" level={rebuilt === "agrees" ? "strong" : rebuilt === "differs" ? "warning" : "none"}>
          {loading && !data ? <p>Fetching the AI&apos;s rebuild…</p> : <Rebuild evidence={evidence} />}
        </Rung>
      </ol>
      <p className="hint">Coming next: a data-leakage check, for the same rows in training and test data, and a maths check on the statistics a paper reports. Neither has run on this claim.</p>
      <p className="hint">Even all three steps can&apos;t prove the science is true. They show how well this result stands up to checking.</p>
    </section>
  );
}
