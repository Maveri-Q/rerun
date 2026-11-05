"use client";

import { motion, useReducedMotion } from "motion/react";
import { RollingNumber } from "@/components/RollingNumber";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { accountLink } from "@/lib/config";
import { lab, type QuoteVerification } from "@/lib/lab";
import benchmark from "@/lib/repair-benchmark.json";
import { relativeTime } from "@/lib/market";

const CODE = ["model = LogisticRegression()", "X, y = load_trials(path)", "train, test = split(X, y)", "model.fit(train)", "score = model.score(test)", "print(score)", "# no changes to the method", "# reading the final number"];

const MAY = ["A wrong file path", "A missing package", "An outdated setup step"];
const MAY_NOT = ["The data", "The model code", "Settings that affect results", "The final number"];

function Quote({ title, q }: { title: string; q: QuoteVerification }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>
        {title}: {q.ok ? "verified" : "failed"}
      </h3>
      <p className="hint mono break">
        signing key {q.signingAddress}, TCB status {q.tcbStatus ?? "unknown"}
      </p>
      <ul className="hint" style={{ paddingLeft: 0, listStyle: "none", margin: "8px 0 0" }}>
        {q.checks.map((c) => (
          <li key={c.name} style={{ display: "block", border: 0, padding: "2px 0" }}>
            <span className={`mono check-${c.ok ? "pass" : "fail"}`}>{c.ok ? "✓" : "✕"}</span> {c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One mark per finished claim, so the record reads at a glance. */
function VerdictStrip({ held, not, broken, invalid }: { held: number; not: number; broken: number; invalid: number }) {
  const marks = [...Array(held).fill("held"), ...Array(not).fill("not"), ...Array(broken).fill("broken"), ...Array(invalid).fill("invalid")] as string[];
  return (
    <div className="strip" aria-hidden="true">
      {marks.map((kind, i) => (
        <i key={i} className={`strip-mark strip-mark--${kind}`} style={{ animationDelay: `${i * 35}ms` }} />
      ))}
    </div>
  );
}

export default function LabPage() {
  const reduce = useReducedMotion();
  const labs = usePoll(() => chain.labs(), [], 0, "labs");
  const stats = usePoll(() => chain.stats(), [], 0, "stats");
  const health = usePoll(() => lab.health(), [], 20_000);
  const attestation = usePoll(() => lab.latestAttestation(), [], 60_000);

  const report = attestation.data?.reports[0];
  const entry = labs.data?.[0];
  const local = entry?.[1].local ?? true;
  const online = Boolean(health.data);
  const s = stats.data;

  return (
    <>
      <div className="lab-hero">
        <div>
          <h1 className="page-title">The Lab works with the door shut.</h1>
          <p className="lede">The Lab is an AI agent that re-runs a claim&apos;s code and data in a locked box with the internet cut off. The AI can only fix setup problems. Plain code reads the number and decides the verdict.</p>
          <p className={`lab-status ${online ? "is-online" : ""}`} role="status">
            <span className={online ? "live-dot" : "lab-dot"} />
            {online ? `Online, using ${health.data!.model}${health.data!.mock_llm ? " (scripted test AI)" : ""}` : "Offline right now. Finished results below still stand."}
          </p>
        </div>
        <div className="sealed" aria-hidden="true">
          <span className="sealed-cable" />
          <span className="sealed-off">Internet off</span>
          <div className="sealed-box">
            <div className="sealed-screen">
              <div className="sealed-code">
                {[...CODE, ...CODE].map((line, i) => (
                  <span key={i}>{line}</span>
                ))}
              </div>
            </div>
            <div className="sealed-foot">
              <span className="sealed-lock" />
              <span>Sealed</span>
            </div>
          </div>
        </div>
      </div>

      {local && (
        <p className="notice" style={{ maxWidth: "66ch", marginTop: 32 }}>
          This practice Lab runs on an ordinary computer for now, so receipts show a note rather than a pass on that line. The AI it uses already runs on secure hardware, and the Lab moves there before launch.
        </p>
      )}

      <section className="rules">
        <div>
          <h2>The AI may fix</h2>
          <ul>
            {MAY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>It can never touch</h2>
          <ul className="rules-no">
            {MAY_NOT.map((item, i) => (
              <li key={item}>
                {item}
                <motion.i initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 1 }} transition={{ duration: 0.45, delay: 0.15 + i * 0.14, ease: "easeOut" }} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Can the AI repair old code?</h2>
        </div>
        <p className="lede">
          {benchmark.complete
            ? `On our benchmark of real papers, broken on purpose with today's software, the AI fixed ${benchmark.repaired} of ${benchmark.papers_counted}.`
            : `Not proven yet. We only claim this once a benchmark of ${benchmark.target_papers} real papers says so, and ${benchmark.papers_counted} ${benchmark.papers_counted === 1 ? "has" : "have"} been tested so far (${benchmark.repaired} fixed).`}
        </p>
        <p className="hint">Before any AI, the Lab installs the software as it was on the date of the code. If it still can&apos;t get the code running, the claim is inconclusive: nobody wins, and everyone gets half back.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Results so far</h2>
        </div>
        {s ? (
          <>
            <VerdictStrip held={s.reproduced} not={s.not_reproduced} broken={s.broken} invalid={s.invalid} />
            <div className="figures lab-figures">
              <div className="figure">
                <b><RollingNumber value={String(s.markets)} /></b>
                <span>Claims opened</span>
              </div>
              <div className="figure figure--held">
                <b><RollingNumber value={String(s.reproduced)} /></b>
                <span>Held up</span>
              </div>
              <div className="figure">
                <b><RollingNumber value={String(s.not_reproduced)} /></b>
                <span>Did not hold up</span>
              </div>
              <div className="figure">
                <b><RollingNumber value={String(s.broken)} /></b>
                <span>Code broken</span>
              </div>
              <div className="figure">
                <b><RollingNumber value={String(s.invalid)} /></b>
                <span>No verdict</span>
              </div>
            </div>
          </>
        ) : (
          <p className="empty">Loading…</p>
        )}
        <p className="hint" style={{ marginTop: 20 }}>The Lab&apos;s accuracy on papers with known answers hasn&apos;t been measured yet. So far these are demo claims.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Proof the AI runs on secure hardware</h2>
          {attestation.data && <span className="dim">Checked {relativeTime(attestation.data.recorded_at)}</span>}
        </div>
        {attestation.data?.mock && <p className="notice">The Lab is in scripted test mode, so there is no attestation to show.</p>}
        {report ? (
          <div className="witness">
            <p>
              Before each run the Lab asks for fresh proof that <span className="mono">{attestation.data?.model}</span> runs on genuine secure hardware. Intel and NVIDIA vouch for that hardware.
            </p>
            <Quote title="The service that routes requests" q={report.gateway} />
            {report.models.map((q) => (
              <Quote key={q.signingAddress} title="The AI model itself" q={q} />
            ))}
          </div>
        ) : (
          !attestation.data?.mock && <p className="dim">{attestation.loading ? "Loading…" : "The Lab's proof isn't available right now. The check-it-yourself steps below still work."}</p>
        )}
      </section>

      <section className="section prose">
        <details>
          <summary>Show the technical details</summary>
          {entry ? (
            <dl className="defs mono" style={{ marginTop: 12 }}>
              <dt>Account</dt>
              <dd>
                <a href={accountLink(entry[0])}>{entry[0]}</a>
              </dd>
              <dt>Code fingerprint</dt>
              <dd>{entry[1].codehash}</dd>
              <dt>Key for private data</dt>
              <dd>{entry[1].enc_pubkey}</dd>
              <dt>Registered</dt>
              <dd>{relativeTime(entry[1].registered_at)}</dd>
            </dl>
          ) : (
            <p className="dim">{labs.loading ? "Reading the Lab registry…" : "No Lab is registered yet."}</p>
          )}
          <p style={{ marginTop: 20 }}>Developers can repeat these checks without trusting this site:</p>
          <pre className="log">{`git clone <this repository>
pnpm install
pnpm nearai:hello      # verifies the model's Intel and NVIDIA proofs live
pnpm sandbox:build
MOCK_LLM=1 pnpm lab:run all   # runs every demo claim on your machine`}</pre>
          <p className="hint">Once the Lab is on secure hardware, you&apos;ll be able to build the same code and compare fingerprints.</p>
        </details>
      </section>
    </>
  );
}
