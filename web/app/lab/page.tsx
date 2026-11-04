"use client";

import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { accountLink } from "@/lib/config";
import { lab, type QuoteVerification } from "@/lib/lab";
import { relativeTime } from "@/lib/market";

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
          <li key={c.name}>
            <span className={`mono check-${c.ok ? "pass" : "fail"}`}>{c.ok ? "✓" : "✕"}</span> {c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LabPage() {
  const labs = usePoll(() => chain.labs(), []);
  const stats = usePoll(() => chain.stats(), []);
  const health = usePoll(() => lab.health(), [], 20_000);
  const attestation = usePoll(() => lab.latestAttestation(), [], 60_000);

  const report = attestation.data?.reports[0];
  const entry = labs.data?.[0];
  const local = entry?.[1].local ?? true;

  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>The Lab</h1>
      <p className="lede prose">
        The Lab is an AI agent that re-runs a claim&apos;s code and data in a locked-down container with the internet cut off. The AI can only fix setup problems. Plain code reads the number and decides the verdict.
      </p>

      {local && (
        <p className="notice" style={{ maxWidth: "66ch", marginTop: 24 }}>
          This practice Lab runs on an ordinary computer for now, so receipts show a note rather than a pass on that line. The AI it uses already runs on secure hardware, and the Lab moves there before launch.
        </p>
      )}

      <section className="section">
        <div className="section-head">
          <h2>About this Lab</h2>
        </div>
        {entry ? (
          <dl className="defs mono">
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
            <dt>Status</dt>
            <dd>{health.data ? `Online, using ${health.data.model}${health.data.mock_llm ? " (scripted test AI)" : ""}` : "Not reachable from this browser"}</dd>
          </dl>
        ) : (
          <p className="dim">{labs.loading ? "Reading the Lab registry…" : "No Lab is registered yet."}</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Results so far</h2>
        </div>
        {stats.data ? (
          <div className="scroll-x">
            <table className="mono">
              <thead>
                <tr>
                  <th className="num">Claims</th>
                  <th className="num">Held up</th>
                  <th className="num">Did not</th>
                  <th className="num">Broken</th>
                  <th className="num">Invalid</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num">{stats.data.markets}</td>
                  <td className="num">{stats.data.reproduced}</td>
                  <td className="num">{stats.data.not_reproduced}</td>
                  <td className="num">{stats.data.broken}</td>
                  <td className="num">{stats.data.invalid}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="dim">Loading…</p>
        )}
        <p className="hint">The Lab's accuracy on papers with known answers hasn't been measured yet. So far these are demo claims.</p>
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
        <div className="section-head">
          <h2>Check it yourself (technical)</h2>
        </div>
        <p>Developers can repeat these checks without trusting this site:</p>
        <pre className="log">{`git clone <this repository>
pnpm install
pnpm nearai:hello      # verifies the model's Intel and NVIDIA proofs live
pnpm sandbox:build
MOCK_LLM=1 pnpm lab:run all   # runs every demo claim on your machine`}</pre>
        <p className="hint">Once the Lab is on secure hardware, you&apos;ll be able to build the same code and compare fingerprints.</p>
      </section>
    </>
  );
}
