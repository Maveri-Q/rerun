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
        The Lab is an AI agent that re-runs a claim&apos;s code and data in a sandbox with the network off. Its private AI model can only repair the environment. Plain code reads the number and decides the verdict.
      </p>

      {local && (
        <p className="notice" style={{ maxWidth: "66ch", marginTop: 24 }}>
          This testnet Lab runs outside a TEE for now, so the &quot;TEE&quot; line on receipts shows a note, not a pass. The AI model it talks to is attested today; the Lab itself moves to a Phala TEE before mainnet.
        </p>
      )}

      <section className="section">
        <div className="section-head">
          <h2>What this Lab is</h2>
        </div>
        {entry ? (
          <dl className="defs mono">
            <dt>Account</dt>
            <dd>
              <a href={accountLink(entry[0])}>{entry[0]}</a>
            </dd>
            <dt>Code hash</dt>
            <dd>{entry[1].codehash}</dd>
            <dt>Encryption key</dt>
            <dd>{entry[1].enc_pubkey}</dd>
            <dt>Registered</dt>
            <dd>{relativeTime(entry[1].registered_at)}</dd>
            <dt>Status</dt>
            <dd>{health.data ? `Online, using ${health.data.model}${health.data.mock_llm ? " (scripted test mode)" : ""}` : "Not reachable from this browser"}</dd>
          </dl>
        ) : (
          <p className="dim">{labs.loading ? "Reading the Lab registry…" : "No Lab is registered yet."}</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Its track record</h2>
        </div>
        {stats.data ? (
          <div className="scroll-x">
            <table className="mono">
              <thead>
                <tr>
                  <th className="num">Claims opened</th>
                  <th className="num">Reproduced</th>
                  <th className="num">Not reproduced</th>
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
        <p className="hint">Accuracy on the CORE-Bench benchmark of papers with known answers has not been measured yet. So far these are demo claims.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>AI model attestation</h2>
          {attestation.data && <span className="dim">Checked {relativeTime(attestation.data.recorded_at)}</span>}
        </div>
        {attestation.data?.mock && <p className="notice">The Lab is in scripted test mode, so there is no attestation to show.</p>}
        {report ? (
          <div className="witness">
            <p>
              Before each run the Lab asks NEAR AI Cloud for proof that <span className="mono">{attestation.data?.model}</span> runs on genuine confidential hardware, with a fresh random nonce so old proofs can&apos;t be replayed.
            </p>
            <Quote title="Gateway TEE" q={report.gateway} />
            {report.models.map((q) => (
              <Quote key={q.signingAddress} title="Model TEE" q={q} />
            ))}
          </div>
        ) : (
          !attestation.data?.mock && <p className="dim">{attestation.loading ? "Loading…" : "The Lab's attestation record is not reachable right now. `pnpm nearai:hello` checks it yourself."}</p>
        )}
      </section>

      <section className="section prose">
        <div className="section-head">
          <h2>Check it yourself</h2>
        </div>
        <p>Every line of the Lab&apos;s verification can be repeated without trusting this site:</p>
        <pre className="log">{`git clone <this repository>
pnpm install
pnpm nearai:hello      # verifies the model's Intel and NVIDIA proofs live
pnpm sandbox:build
MOCK_LLM=1 pnpm lab:run all   # runs every demo claim on your machine`}</pre>
        <p className="hint">Once the Lab is in a TEE, a reproducible Docker build will let you compare your build&apos;s hash to the code hash above.</p>
      </section>
    </>
  );
}
