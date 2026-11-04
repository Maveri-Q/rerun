"use client";

import { canonicalJson, ClaimSpec, specJson } from "@rerun/shared/browser";
import { nearToYocto } from "near-api-js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RunTerminal } from "@/components/RunTerminal";
import { ftTransferCall, prepareMoney } from "@/components/TradePanel";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { CONTRACT } from "@/lib/config";
import { lab, useRunStream } from "@/lib/lab";
import { fmtUnits, modeUnit, parseUnits, type Mode } from "@/lib/market";
import { sealForLab, sha256Hex } from "@/lib/seal";
import { explainError, useWallet } from "@/lib/wallet";

interface Draft {
  repo_url: string;
  commit: string;
  title: string;
  statement: string;
  authors: string;
  license: string;
  runtime: string;
  setup: string[];
  entrypoint: string;
  output_path: string;
  extractor_type: string;
  extractor_expr: string;
  metric_name: string;
  reported_value: string;
  notes: string;
}

interface DataRow {
  url: string;
  sha256: string;
  path: string;
}

/** Validation speaks in the form's own labels, not schema paths. */
const FIELD_NAMES: Record<string, string> = {
  title: "Title",
  statement: "Statement",
  "source.url": "Repository or paper URL",
  "source.license": "License",
  "source.authors": "Authors",
  "artifact.repo_url": "Public GitHub repository",
  "artifact.commit": "Code version",
  "artifact.entrypoint": "Command that produces the result",
  "artifact.setup": "Setup commands",
  "artifact.output.path": "File the result is written to",
  "artifact.output.extractor.expr": "Where in the file",
  "artifact.data.url": "Data file URL",
  "artifact.data.sha256": "Data file sha256",
  "artifact.data.path": "Data file path",
  "metric.name": "What is being measured",
  "metric.reported_value": "The number the paper reports",
  "metric.tolerance.value": "Allowed margin",
  "private_data.path": "Private file path",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </label>
  );
}

export default function CreatePage() {
  const wallet = useWallet();
  const config = usePoll(() => chain.config(), []);
  const health = usePoll(() => lab.health(), []);

  const [repoUrl, setRepoUrl] = useState("");
  const [paperUrl, setPaperUrl] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [sourceType, setSourceType] = useState("paper");
  const [authors, setAuthors] = useState("");
  const [license, setLicense] = useState("");
  const [commit, setCommit] = useState("");
  const [runtime, setRuntime] = useState("python3.11");
  const [setup, setSetup] = useState("pip install -r requirements.txt");
  const [entrypoint, setEntrypoint] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [extractorType, setExtractorType] = useState("jsonpath");
  const [extractorExpr, setExtractorExpr] = useState("");
  const [metricName, setMetricName] = useState("");
  const [reported, setReported] = useState("");
  const [toleranceType, setToleranceType] = useState("abs");
  const [tolerance, setTolerance] = useState("");
  const [data, setData] = useState<DataRow[]>([]);

  const [methods, setMethods] = useState("");
  const [technicalOpen, setTechnicalOpen] = useState(false);

  const [privateFile, setPrivateFile] = useState<File | null>(null);
  const [privatePath, setPrivatePath] = useState("private/data.csv");
  const [privateData, setPrivateData] = useState<{ ref: string; sha: string; name: string } | null>(null);

  const [mode, setMode] = useState<Mode>("points");
  const [lockDays, setLockDays] = useState("3");
  const [windowHours, setWindowHours] = useState("24");
  const [liquidity, setLiquidity] = useState("50");

  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; marketId?: number } | null>(null);
  const [dryRun, setDryRun] = useState<string | null>(null);
  const stream = useRunStream(dryRun);

  const applyDraft = (d: Draft) => {
    setCommit(d.commit);
    setRepoUrl(d.repo_url);
    if (d.title) setTitle(d.title);
    if (d.statement) setStatement(d.statement);
    if (d.authors) setAuthors(d.authors);
    if (d.license) setLicense(d.license);
    setRuntime(d.runtime);
    if (d.setup.length) setSetup(d.setup.join("\n"));
    if (d.entrypoint) setEntrypoint(d.entrypoint);
    if (d.output_path) setOutputPath(d.output_path);
    setExtractorType(d.extractor_type);
    if (d.extractor_expr) setExtractorExpr(d.extractor_expr);
    if (d.metric_name) setMetricName(d.metric_name);
    if (d.reported_value) setReported(d.reported_value);
  };

  const draftWithAi = async () => {
    setDrafting(true);
    setDraftNote(null);
    try {
      const d = await lab.post<Draft>("/draft", { repo_url: repoUrl, paper_url: paperUrl || undefined });
      applyDraft(d);
      setDraftNote({ ok: true, text: `Drafted from commit ${d.commit.slice(0, 12)}. An AI wrote this, so check every field below, especially the number and its tolerance. ${d.notes}` });
    } catch (e) {
      setDraftNote({ ok: false, text: `${(e as Error).message} You can still fill in the fields by hand.` });
    } finally {
      setDrafting(false);
    }
  };

  const built = useMemo(() => {
    return ClaimSpec.safeParse({
      version: 1,
      title,
      statement,
      source: { type: sourceType, url: paperUrl || repoUrl, license, authors },
      artifact: {
        repo_url: repoUrl,
        commit,
        data,
        runtime,
        setup: setup.split("\n").map((s) => s.trim()).filter(Boolean),
        entrypoint,
        output: { path: outputPath, extractor: { type: extractorType, expr: extractorExpr } },
      },
      metric: { name: metricName, reported_value: reported, tolerance: { type: toleranceType, value: tolerance }, comparison: "within_tolerance" },
      resources: { cpu: 2, mem_gb: 4, max_minutes: 15 },
      private_data: privateData ? { ciphertext_ref: privateData.ref, sha256_plain: privateData.sha, owner: wallet.accountId || "unknown.testnet", path: privatePath } : null,
    });
  }, [title, statement, sourceType, paperUrl, repoUrl, license, authors, commit, data, runtime, setup, entrypoint, outputPath, extractorType, extractorExpr, metricName, reported, toleranceType, tolerance, privateData, privatePath, wallet.accountId]);

  const [hash, setHash] = useState("");
  useEffect(() => {
    if (built.success) void sha256Hex(specJson(built.data)).then(setHash);
    else setHash("");
  }, [built]);

  const issues = built.success
    ? []
    : [
        // One message per field: an empty URL fails two rules, but "required" says all of it.
        ...new Map(
          built.error.issues.map((i) => {
            const key = i.path.filter((p) => typeof p !== "number").join(".");
            return [key, `${FIELD_NAMES[key] ?? key}: ${i.code === "too_small" ? "required" : i.message}`] as const;
          }).reverse(),
        ).values(),
      ]
        .reverse()
        .slice(0, 8);
  const hasTechnicalIssue = !built.success && built.error.issues.some((i) => i.path[0] === "artifact" || i.path[0] === "source");
  const params = config.data ? (mode === "money" ? config.data.money : config.data.points) : null;
  const liquidityUnits = parseUnits(liquidity);
  const totalUp = params && liquidityUnits ? liquidityUnits + BigInt(params.creation_bond) + BigInt(params.repro_fee) : null;
  const lockTime = Math.floor(Date.now() / 1000) + Math.round(Number(lockDays) * 86400);
  const windowSecs = Math.round(Number(windowHours) * 3600);

  const sealPrivate = async () => {
    if (!privateFile) return;
    setBusy("Encrypting in your browser…");
    try {
      const labs = await chain.labs();
      const key = labs[0]?.[1].enc_pubkey;
      if (!key) throw new Error("No Lab is registered to encrypt to.");
      const plain = new Uint8Array(await privateFile.arrayBuffer());
      const sealed = await sealForLab(plain, key);
      const ref = await lab.uploadSealed(sealed);
      setPrivateData({ ref, sha: await sha256Hex(plain), name: privateFile.name });
      setOutcome(null);
    } catch (e) {
      setOutcome({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  const hashDataFile = async (i: number, file: File) => {
    const sha = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    setData((rows) => rows.map((r, j) => (j === i ? { ...r, sha256: sha } : r)));
  };

  const create = async () => {
    if (!built.success || !liquidityUnits || !params || !totalUp) return;
    const json = canonicalJson(built.data);
    setOutcome(null);
    try {
      setBusy("Saving your claim…");
      // Storage is about 10 KB per 0.1 NEAR; the contract refunds the excess.
      const deposit = nearToYocto((0.1 + json.length / 50_000).toFixed(4) as `${number}`).toString();
      await wallet.call("create_market", { spec_json: json, lock_time: lockTime, challenge_window: windowSecs, mode }, { deposit, tgas: 150 });
      const recent = await chain.markets({ state: "Draft" }, 50);
      const mine = recent.find((m) => m.creator === wallet.accountId && m.spec.spec_hash === hash);
      if (!mine) throw new Error("The claim was stored, but it could not be found to fund it. Check your portfolio.");

      setBusy("Opening your claim…");
      if (mode === "points") {
        await wallet.call("fund_market", { market_id: mine.id, initial_liquidity: liquidityUnits.toString() }, { deposit: nearToYocto("0.02").toString() });
      } else {
        await prepareMoney(wallet);
        await ftTransferCall(wallet, CONTRACT, totalUp, { action: "fund", market_id: mine.id, initial_liquidity: liquidityUnits.toString() });
      }
      if (methods.trim()) await lab.saveMethods(hash, methods);
      setOutcome({ ok: true, text: "Your claim is open.", marketId: mine.id });
    } catch (e) {
      setOutcome({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  const startDryRun = async () => {
    if (!built.success) return;
    try {
      const { run } = await lab.post<{ run: string }>("/dry-run", built.data);
      setDryRun(run);
    } catch (e) {
      setOutcome({ ok: false, text: (e as Error).message });
    }
  };

  const unit = modeUnit(mode);
  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Open a new claim</h1>
      <p className="lede prose">Put a published result up for forecasting. Paste a link to its code and the AI fills in the form. Nothing goes on the blockchain until you&apos;ve checked it.</p>

      <section className="section">
        <div className="step-title">
          <b>1</b>
          <h2>Paste the link to the code</h2>
        </div>
        <div className="form-grid">
          <Field label="Public GitHub repository" hint="The claim locks to today's exact version, so later changes to the code can't affect it.">
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/name" />
          </Field>
          <Field label="Paper or report (optional)">
            <input value={paperUrl} onChange={(e) => setPaperUrl(e.target.value)} placeholder="https://arxiv.org/abs/..." />
          </Field>
        </div>
        <button disabled={drafting || !repoUrl} onClick={() => void draftWithAi()}>
          {drafting ? "The AI is reading the repository…" : "Draft the claim with AI"}
        </button>
        {draftNote && <p className={`notice ${draftNote.ok ? "notice--ok" : "notice--error"}`} role="status">{draftNote.text}</p>}
      </section>

      <section className="section">
        <div className="step-title">
          <b>2</b>
          <h2>Check the claim</h2>
        </div>
        <div className="form-grid">
          <div className="span-2">
            <Field label="Title" hint="One plain sentence, 120 characters at most.">
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Statement" hint="Explain what the paper says, 600 characters at most.">
              <textarea rows={3} value={statement} maxLength={600} onChange={(e) => setStatement(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 8 }}>
          <h3 style={{ marginBottom: 12 }}>The number being tested. Check this most carefully.</h3>
          <div className="form-grid">
            <Field label="What is being measured">
              <input value={metricName} onChange={(e) => setMetricName(e.target.value)} placeholder="accuracy" />
            </Field>
            <Field label="The number the paper reports" hint="As a decimal, such as 0.912.">
              <input className="mono" value={reported} onChange={(e) => setReported(e.target.value.trim())} />
            </Field>
            <Field label="How to measure the margin">
              <select value={toleranceType} onChange={(e) => setToleranceType(e.target.value)}>
                <option value="abs">A fixed amount, such as ± 0.01</option>
                <option value="rel">A share of the number, such as ± 5%</option>
              </select>
            </Field>
            <Field label="Allowed margin" hint="How close the re-run must get. It can&apos;t change once the claim opens.">
              <input className="mono" value={tolerance} onChange={(e) => setTolerance(e.target.value.trim())} placeholder="0.01" />
            </Field>
          </div>
        </div>
      </section>

      <section className="section">
        <details className="technical" open={technicalOpen} onToggle={(e) => setTechnicalOpen(e.currentTarget.open)}>
          <summary>Technical details</summary>
          <p className="hint">How the Lab runs the code. The AI fills in what it can, so you can usually leave this alone.</p>
          <h3 style={{ margin: "16px 0 8px" }}>About the source</h3>
          <div className="form-grid">
          <Field label="Authors">
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} />
            </Field>
            <Field label="License" hint="Use only openly licensed material.">
            <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="MIT" />
            </Field>
            <Field label="Source type">
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="paper">Paper</option>
              <option value="report">Report</option>
              <option value="dataset">Dataset</option>
              <option value="onchain">On-chain data</option>
            </select>
            </Field>
            <Field label="Code version (commit)" hint="The exact version of the code: a 40-character ID from GitHub.">
            <input className="mono" value={commit} onChange={(e) => setCommit(e.target.value.trim())} />
            </Field>
          </div>
          <h3 style={{ margin: "16px 0 8px" }}>How to run it</h3>
        <div className="form-grid">
          <Field label="Runtime">
            <select value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              <option value="python3.11">Python 3.11</option>
              <option value="r4.4">R 4.4</option>
            </select>
          </Field>
          <Field label="Command that produces the result">
            <input className="mono" value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="python reproduce.py" />
          </Field>
          <div className="span-2">
            <Field label="Setup commands, one per line" hint="These can use the internet. The command that produces the result can't.">
              <textarea className="mono" rows={2} value={setup} onChange={(e) => setSetup(e.target.value)} />
            </Field>
          </div>
          <Field label="File the result is written to">
            <input className="mono" value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="results.json" />
          </Field>
          <div className="form-grid">
            <Field label="How to find the number in that file">
              <select value={extractorType} onChange={(e) => setExtractorType(e.target.value)}>
                <option value="jsonpath">JSON path</option>
                <option value="regex">Regex</option>
                <option value="csv_cell">CSV cell</option>
              </select>
            </Field>
            <Field label="Where in the file">
              <input className="mono" value={extractorExpr} onChange={(e) => setExtractorExpr(e.target.value)} placeholder="$.accuracy" />
            </Field>
          </div>
        </div>

        <h3 style={{ margin: "16px 0 8px" }}>How the authors did it (optional)</h3>
        <Field label="The paper's methods section" hint="Used for the experimental rebuild check, where an AI writes its own analysis from this description. It needs public data files too. This text is public.">
          <textarea rows={4} value={methods} maxLength={20000} onChange={(e) => setMethods(e.target.value)} />
        </Field>

        <h3 style={{ margin: "16px 0 8px" }}>Public data files</h3>
        {data.map((row, i) => (
          <div className="form-grid" key={i} style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <Field label="Download URL">
              <input value={row.url} onChange={(e) => setData((rows) => rows.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))} />
            </Field>
            <Field label="Path inside the repo">
              <input className="mono" value={row.path} onChange={(e) => setData((rows) => rows.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)))} />
            </Field>
            <Field label="File fingerprint (sha256)" hint="Paste it, or choose your copy below and it&apos;s worked out here, without uploading.">
              <input className="mono" value={row.sha256} onChange={(e) => setData((rows) => rows.map((r, j) => (j === i ? { ...r, sha256: e.target.value.trim() } : r)))} />
            </Field>
            <Field label="Get the fingerprint from your copy">
              <input type="file" onChange={(e) => e.target.files?.[0] && void hashDataFile(i, e.target.files[0])} />
            </Field>
            <div className="span-2" style={{ marginBottom: 12 }}>
              <button className="quiet" onClick={() => setData((rows) => rows.filter((_, j) => j !== i))}>
                Remove this file
              </button>
            </div>
          </div>
        ))}
        <button className="quiet" onClick={() => setData((rows) => [...rows, { url: "", sha256: "", path: "" }])}>
          Add a data file
        </button>

        <details style={{ marginTop: 16 }}>
          <summary>This claim uses private data</summary>
          <p className="hint">Your file is encrypted in your browser so only the Lab can read it. Only its fingerprint goes on the blockchain. Logs from private runs are never published, and the AI never sees the data, so it can&apos;t fix setup problems for these runs.</p>
          {privateData ? (
            <p className="notice notice--ok">
              {privateData.name} is encrypted and uploaded. Fingerprint {privateData.sha.slice(0, 16)}…
            </p>
          ) : (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Private file">
                <input type="file" onChange={(e) => setPrivateFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Path inside the repo">
                <input className="mono" value={privatePath} onChange={(e) => setPrivatePath(e.target.value)} />
              </Field>
              <div>
                <button className="quiet" disabled={!privateFile || busy !== null} onClick={() => void sealPrivate()}>
                  Encrypt and upload
                </button>
              </div>
            </div>
          )}
        </details>
        </details>
      </section>

      <section className="section">
        <div className="step-title">
          <b>3</b>
          <h2>Forecasting settings</h2>
        </div>
        <div className="form-grid">
          <Field label="Forecast with">
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="points">Free points</option>
              <option value="money">tUSDC, a test token</option>
            </select>
          </Field>
          <Field label={`Starting prize pool, in ${unit}`} hint={params ? `At least ${fmtUnits(params.min_liquidity, 0)}. A bigger pool makes the odds harder to move.` : undefined}>
            <input className="mono" value={liquidity} onChange={(e) => setLiquidity(e.target.value)} />
          </Field>
          <Field label="Forecasting ends after this many days" hint="Then the Lab starts.">
            <input className="mono" inputMode="decimal" value={lockDays} onChange={(e) => setLockDays(e.target.value)} />
          </Field>
          <Field label="Time to challenge the result, in hours" hint={config.data ? `Anything up to ${config.data.max_challenge_window / 86400} days.` : undefined}>
            <input className="mono" inputMode="decimal" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="section">
        <div className="step-title">
          <b>4</b>
          <h2>Review and open</h2>
        </div>
        {!repoUrl && !title ? (
          <p className="hint">Start by pasting a link to the code in step 1.</p>
        ) : issues.length > 0 ? (
          <div className="notice">
            Still needed{hasTechnicalIssue ? ", including some under Technical details" : ""}:
            <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <p className="mono break">Claim fingerprint {hash}</p>
            <details>
              <summary>Show the exact claim that goes on the blockchain</summary>
              <pre className="log">{built.success ? JSON.stringify(built.data, null, 2) : ""}</pre>
            </details>
          </>
        )}
        {params && totalUp && (
          <p>
            Opening this costs <b className="mono">{fmtUnits(totalUp)} {unit}</b>: {fmtUnits(liquidityUnits!)} for the prize pool, a {fmtUnits(params.creation_bond)} deposit (you get it back unless the claim was set up badly), and a {fmtUnits(params.repro_fee)} fee that pays for the Lab&apos;s work.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {wallet.accountId ? (
            <button disabled={!built.success || !totalUp || busy !== null} onClick={() => void create()}>
              {busy ?? "Open this claim"}
            </button>
          ) : (
            <button onClick={wallet.signIn}>Connect wallet to open this claim</button>
          )}
          {health.data?.dry_run && !built.data?.private_data && (
            <button className="quiet" disabled={!built.success} onClick={() => void startDryRun()}>
              Test it first without opening
            </button>
          )}
        </div>
        {outcome && (
          <p className={`notice ${outcome.ok ? "notice--ok" : "notice--error"}`} role="status">
            {outcome.text} {outcome.marketId !== undefined && <Link href={`/market/${outcome.marketId}`}>Go to your claim</Link>}
          </p>
        )}
        {dryRun && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Test run, no forecasts involved</h3>
            <RunTerminal events={stream.events} status={stream.status} waitingText="Queued. The Lab runs one job at a time." />
          </div>
        )}
      </section>
    </>
  );
}
