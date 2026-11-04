import { createHash } from "node:crypto";
import {
  openSealed,
  parseDecimal,
  specHash,
  withinTolerance,
  type ClaimSpec,
  type InvalidReason,
  type Outcome,
  type Receipt,
} from "@rerun/shared";
import type { ExecResult, Sandbox } from "../sandbox/types.ts";
import { extractMetric, MAX_OUTPUT_BYTES, type ExtractorType } from "./extract.ts";
import { parseJsonReply } from "./guards.ts";
import { ModelVerificationError, type PrivateModel } from "./model.ts";
import { proposeAndApplyRepair, type AppliedPatch } from "./repair.ts";

/**
 * One reproduction run (build plan §5.2). The LLM can only repair the environment and point at
 * where a number lives; this code decides the outcome.
 *
 * Private-data claims: plaintext enters the sandbox only after setup, the code then runs with no
 * network, and from that moment no log or output goes to the LLM, the stream, or the receipt.
 */

export const MAX_REPAIR_ATTEMPTS = 3;
const SETUP_TIMEOUT_MS = 15 * 60_000;
const TAIL_LIMIT_BYTES = 4096;

export type Stage =
  | "attesting"
  | "fetching"
  | "verifying_hashes"
  | "installing"
  | "decrypting"
  | "running"
  | "repairing"
  | "extracting"
  | "comparing"
  | "reporting"
  | "done";

export interface StageEvent {
  stage: Stage;
  message: string;
  diff?: string;
}

/** Where code and data come from. Real claims use the network; demo fixtures resolve locally. */
export interface ArtifactResolver {
  /** Puts the repo at the spec's commit in the sandbox; true on success. */
  fetchRepo(spec: ClaimSpec, sandbox: Sandbox): Promise<boolean>;
  fetchData(url: string): Promise<Uint8Array>;
  fetchCiphertext(ref: string): Promise<Uint8Array>;
}

export interface LabKeys {
  privateKey: string;
  publicKey: string;
}

export interface RunInput {
  spec: ClaimSpec;
  marketId: number;
  runIndex: number;
  labAccount: string;
  labCodehash: string;
  labKeys?: LabKeys;
}

export interface RunDeps {
  sandbox: Sandbox;
  model: PrivateModel;
  resolver: ArtifactResolver;
  emit?: (e: StageEvent) => void;
  /** Stores a log or report and returns its URI. Not called with private-run logs. */
  store?: (kind: "log" | "report", hash: string, content: string) => Promise<string>;
  now?: () => number;
}

export interface RunResult {
  receipt: Receipt;
  report: string;
  rejectedEdits: { file: string; reason: string }[];
}

class Stop extends Error {
  constructor(
    readonly outcome: Outcome,
    readonly reason: InvalidReason | null,
    message: string,
  ) {
    super(message);
  }
}

export async function reproduce(input: RunInput, deps: RunDeps): Promise<RunResult> {
  const { spec } = input;
  const { sandbox, model, resolver } = deps;
  const emit = deps.emit ?? (() => {});
  const nowSecs = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const startedAt = nowSecs();
  emit({ stage: "attesting", message: `verifying the TEE attestation of ${model.modelId}` });
  await model.attest(); // no attested model, no run
  const isPrivate = spec.private_data !== null;
  const { artifact } = spec;

  const dataHashes: string[] = [];
  const patches: AppliedPatch[] = [];
  const rejectedEdits: RunResult["rejectedEdits"] = [];
  const attempts: string[] = [];
  let envLockHash = "";
  let measured: string | null = null;
  let runtimeSecs = 0;
  let exitCode = 0;
  let lastExec: ExecResult | null = null;
  let outcome: Outcome;
  let reason: InvalidReason | null = null;
  let summary: string;

  const guard = {
    dataPaths: artifact.data.map((d) => d.path),
    outputPath: artifact.output.path,
    privatePath: spec.private_data?.path,
  };

  /** One repair round. Returns false once no further attempt is possible. */
  const repair = async (phase: "setup" | "run", errorLog: string): Promise<boolean> => {
    if (attempts.length >= MAX_REPAIR_ATTEMPTS) return false;
    emit({ stage: "repairing", message: `asking the private model about the ${phase} failure (attempt ${attempts.length + 1}/${MAX_REPAIR_ATTEMPTS})` });
    const result = await proposeAndApplyRepair({
      model,
      sandbox,
      phase,
      errorLog,
      entrypoint: artifact.entrypoint,
      setup: artifact.setup,
      guard,
      previous: attempts,
    });
    for (const r of result.rejected) {
      rejectedEdits.push(r);
      emit({ stage: "repairing", message: `guard rejected an edit to ${r.file}: ${r.reason}` });
    }
    for (const p of result.applied) {
      patches.push(p);
      emit({ stage: "repairing", message: `applied ${p.kind} patch to ${p.file}`, diff: p.diff });
    }
    attempts.push(
      `attempt ${attempts.length + 1}: ${result.reason}; applied ${result.applied.map((p) => p.file).join(", ") || "nothing"}; rejected ${
        result.rejected.map((r) => `${r.file} (${r.reason})`).join(", ") || "nothing"
      }`,
    );
    if (result.gaveUp) {
      emit({ stage: "repairing", message: `the model gave up: ${result.reason}` });
      return false;
    }
    if (result.applied.length === 0 && result.rejected.length === 0) {
      emit({ stage: "repairing", message: result.reason });
    }
    return true;
  };

  try {
    emit({ stage: "fetching", message: `fetching ${artifact.repo_url} at ${artifact.commit.slice(0, 12)}` });
    await sandbox.create();
    if (!(await resolver.fetchRepo(spec, sandbox))) {
      throw new Stop("INVALID", "DATA_UNAVAILABLE", "could not fetch the repository at the pinned commit");
    }
    const head = await sandbox.exec("git rev-parse HEAD", { network: false, timeoutMs: 60_000 });
    if (head.exitCode !== 0 || head.log.trim() !== artifact.commit) {
      throw new Stop("INVALID", "HASH_MISMATCH", `repository HEAD ${head.log.trim().slice(0, 40)} is not the pinned commit`);
    }

    emit({ stage: "verifying_hashes", message: `verifying ${artifact.data.length} data file(s)` });
    for (const d of artifact.data) {
      let bytes: Uint8Array;
      try {
        bytes = await resolver.fetchData(d.url);
      } catch (e) {
        throw new Stop("INVALID", "DATA_UNAVAILABLE", `could not fetch ${d.path}: ${(e as Error).message}`);
      }
      const hash = sha256(bytes);
      dataHashes.push(hash);
      if (hash !== d.sha256) throw new Stop("INVALID", "HASH_MISMATCH", `${d.path} has sha256 ${hash}, spec says ${d.sha256}`);
      await sandbox.writeFile(d.path, bytes);
      emit({ stage: "verifying_hashes", message: `${d.path} ok (${hash.slice(0, 12)})` });
    }

    // Setup: network on, no private data present yet, so logs are safe to share with the model.
    while (true) {
      emit({ stage: "installing", message: artifact.setup.length ? "installing dependencies" : "no setup commands" });
      if (artifact.setup.length === 0) break;
      lastExec = await sandbox.exec(artifact.setup.join(" && "), { network: true, timeoutMs: SETUP_TIMEOUT_MS });
      if (lastExec.exitCode === 0) break;
      exitCode = lastExec.exitCode;
      if (lastExec.timedOut || !(await repair("setup", lastExec.tail))) {
        throw new Stop("BROKEN", null, "setup failed and could not be repaired");
      }
    }
    const lock = await sandbox.exec(lockCommand(artifact.runtime), { network: false, timeoutMs: 120_000 });
    envLockHash = sha256(lock.log);

    if (spec.private_data) {
      emit({ stage: "decrypting", message: "decrypting private data inside the Lab" });
      if (!input.labKeys) throw new Stop("INVALID", "DATA_UNAVAILABLE", "this Lab has no decryption key");
      let plain: Buffer;
      try {
        const sealed = await resolver.fetchCiphertext(spec.private_data.ciphertext_ref);
        plain = openSealed(sealed, input.labKeys.privateKey, input.labKeys.publicKey);
      } catch {
        throw new Stop("INVALID", "DATA_UNAVAILABLE", "private data could not be fetched or decrypted");
      }
      if (sha256(plain) !== spec.private_data.sha256_plain) {
        throw new Stop("INVALID", "HASH_MISMATCH", "decrypted private data does not match sha256_plain");
      }
      await sandbox.writeFile(spec.private_data.path, plain);
    }

    // Run: network off, resource limits, at most MAX_REPAIR_ATTEMPTS repairs.
    while (true) {
      emit({ stage: "running", message: `running ${isPrivate ? "the analysis" : artifact.entrypoint} with the network off` });
      lastExec = await sandbox.exec(artifact.entrypoint, {
        network: false,
        timeoutMs: spec.resources.max_minutes * 60_000,
      });
      runtimeSecs += Math.ceil(lastExec.durationMs / 1000);
      exitCode = lastExec.exitCode;
      if (lastExec.timedOut) throw new Stop("BROKEN", null, `the run exceeded its ${spec.resources.max_minutes}-minute limit`);
      if (lastExec.exitCode === 0) break;
      if (isPrivate) throw new Stop("BROKEN", null, "the run failed; logs are not shared because this claim uses private data");
      if (!(await repair("run", lastExec.tail))) throw new Stop("BROKEN", null, "the run failed and could not be repaired");
    }

    emit({ stage: "extracting", message: `extracting ${spec.metric.name}` });
    measured = await extract(spec, sandbox, model, isPrivate);
    if (measured === null) throw new Stop("INVALID", "EXTRACTION_FAILED", `could not extract ${spec.metric.name}`);

    emit({ stage: "comparing", message: `measured ${measured}, reported ${spec.metric.reported_value}, tolerance ${toleranceString(spec)}` });
    const within = withinTolerance(
      parseDecimal(measured),
      parseDecimal(spec.metric.reported_value),
      spec.metric.tolerance.type,
      parseDecimal(spec.metric.tolerance.value),
    );
    outcome = within ? "REPRODUCED" : "NOT_REPRODUCED";
    summary = within ? "The measured value is within tolerance." : "The code ran, but the measured value is outside tolerance.";
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    outcome = e.outcome;
    reason = e.reason;
    summary = e.message;
    measured = null;
  } finally {
    await sandbox.destroy();
  }

  // Private runs publish no log content, only the hash of what was produced.
  const logBody = lastExec?.log ?? summary;
  const logHash = lastExec?.logHash ?? sha256(summary);
  const logUri = isPrivate ? "" : ((await deps.store?.("log", logHash, logBody)) ?? "");

  emit({ stage: "reporting", message: "writing the reproduction report" });
  const report = await writeReport({ spec, model, outcome, reason, measured, patches, attempts, summary, isPrivate, runtimeSecs });
  const reportHash = sha256(report);
  const reportUri = (await deps.store?.("report", reportHash, report)) ?? "";

  const receipt: Receipt = {
    market_id: input.marketId,
    spec_hash: specHash(spec),
    outcome,
    invalid_reason: reason,
    measured_value: measured,
    reported_value: spec.metric.reported_value,
    tolerance: toleranceString(spec),
    commit: artifact.commit,
    data_hashes: dataHashes,
    env_lock_hash: envLockHash,
    patches: patches.map((p) => ({ file: p.file, kind: p.kind, diff_hash: p.diffHash })),
    patches_diff_excerpt: truncateBytes(patches.map((p) => p.diff).join("\n"), TAIL_LIMIT_BYTES),
    log_hash: logHash,
    log_tail: isPrivate ? "" : tailBytes(logBody, TAIL_LIMIT_BYTES),
    full_log_uri: logUri,
    report_hash: reportHash,
    report_uri: reportUri,
    runtime_secs: runtimeSecs,
    exit_code: exitCode,
    lab_codehash: input.labCodehash,
    lab_account: input.labAccount,
    nearai: { model_id: model.modelId, attestation_digest: model.attestationDigest(), response_signature_refs: model.signatureRefs() },
    run_index: input.runIndex,
    started_at: startedAt,
    finished_at: nowSecs(),
  };
  emit({ stage: "done", message: `${outcome}${reason ? ` (${reason})` : ""}` });
  return { receipt, report, rejectedEdits };
}

/** The spec's extractor first. If it fails, the model may suggest a new location, but code still reads the number. */
async function extract(spec: ClaimSpec, sandbox: Sandbox, model: PrivateModel, isPrivate: boolean): Promise<string | null> {
  const { path, extractor } = spec.artifact.output;
  const attempt = async (file: string, type: ExtractorType, expr: string): Promise<string | null> => {
    const bytes = await sandbox.readFile(file, MAX_OUTPUT_BYTES);
    if (!bytes) return null;
    try {
      return extractMetric(bytes.toString("utf8"), type, expr);
    } catch {
      return null;
    }
  };
  const direct = await attempt(path, extractor.type, extractor.expr);
  if (direct !== null || isPrivate) return direct;

  const files = await sandbox.listFiles(200);
  const preview = (await sandbox.readFile(path, 4000))?.toString("utf8") ?? "(file missing)";
  const reply = await model.ask(
    "extract",
    [
      {
        role: "system",
        content:
          'Locate a metric in research output files. Never state its value. Reply with one JSON object only: {"path": "relative/file", "type": "jsonpath|regex|csv_cell", "expr": "..."}. jsonpath supports $.a.b[0]; regex returns its first capture group; csv_cell is row:column.',
      },
      {
        role: "user",
        content: `Metric: ${spec.metric.name}\nConfigured: ${path} with ${extractor.type} ${extractor.expr} (failed)\nFiles:\n${files.join("\n")}\n\nStart of ${path}:\n${preview}`,
      },
    ],
    1500,
  );
  try {
    const hint = parseJsonReply(reply) as { path?: unknown; type?: unknown; expr?: unknown };
    const { path: p, type, expr } = hint;
    const safePath = typeof p === "string" && !p.startsWith("/") && !p.split("/").includes("..");
    if (!safePath || typeof expr !== "string" || !["jsonpath", "regex", "csv_cell"].includes(type as string)) return null;
    return await attempt(p as string, type as ExtractorType, expr);
  } catch {
    return null;
  }
}

async function writeReport(a: {
  spec: ClaimSpec;
  model: PrivateModel;
  outcome: Outcome;
  reason: InvalidReason | null;
  measured: string | null;
  patches: AppliedPatch[];
  attempts: string[];
  summary: string;
  isPrivate: boolean;
  runtimeSecs: number;
}): Promise<string> {
  const facts = [
    `Claim: ${a.spec.title}`,
    `Statement: ${a.spec.statement}`,
    `Outcome: ${a.outcome}${a.reason ? ` (${a.reason})` : ""}`,
    `Finding: ${a.summary}`,
    `Metric ${a.spec.metric.name}: reported ${a.spec.metric.reported_value}, measured ${a.measured ?? "none"}, tolerance ${toleranceString(a.spec)}`,
    `Runtime: ${a.runtimeSecs}s`,
    `Environment patches: ${a.patches.map((p) => `${p.kind} ${p.file}: ${p.justification}`).join("; ") || "none"}`,
    `Repair attempts: ${a.attempts.join(" | ") || "none"}`,
    a.isPrivate ? "This claim used private data that was never revealed; do not speculate about its contents." : "",
  ]
    .filter(Boolean)
    .join("\n");
  let body: string;
  try {
    body = await a.model.ask(
      "report",
      [
        {
          role: "system",
          content:
            "Write a short, plain reproduction report (at most 120 words) for a general reader: what ran, what was patched, and the result. Use only the facts given. Reproduction is not replication: do not claim the science is true or false.",
        },
        { role: "user", content: facts },
      ],
      2000, // reasoning tokens count against this
    );
  } catch (e) {
    if (e instanceof ModelVerificationError) throw e;
    body = "";
  }
  if (!body.trim()) return `Automated summary (the AI report was unavailable).\n\n${facts}\n`;
  return `AI-written report (${a.model.modelId}). The outcome was decided by deterministic code, not by this text.\n\n${body.trim()}\n`;
}

export function lockCommand(runtime: ClaimSpec["artifact"]["runtime"]): string {
  return runtime === "python3.11"
    ? "python --version 2>&1; pip list --format=freeze 2>/dev/null"
    : `Rscript -e 'ip <- installed.packages()[, c("Package", "Version")]; cat(R.version.string, "\\n"); write.table(ip[order(ip[, 1]), ], quote = FALSE, col.names = FALSE, row.names = FALSE)'`;
}

function toleranceString(spec: ClaimSpec): string {
  return `${spec.metric.tolerance.type}:${spec.metric.tolerance.value}`;
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Contract limits count bytes, so cut on bytes without splitting a character. */
function truncateBytes(s: string, max: number): string {
  const b = Buffer.from(s);
  return b.length <= max ? s : b.subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function tailBytes(s: string, max: number): string {
  const b = Buffer.from(s);
  return b.length <= max ? s : b.subarray(b.length - max).toString("utf8").replace(/^�+/, "");
}

