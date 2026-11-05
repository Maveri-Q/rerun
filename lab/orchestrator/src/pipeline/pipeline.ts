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
import { runReimplementation, runRobustness, summarizeEvidence, type Evidence, type ReimplementationResult, type RobustnessResult } from "./evidence.ts";
import { extractMetric, MAX_OUTPUT_BYTES, type ExtractorType } from "./extract.ts";
import { parseJsonReply, JSON_OBJECT_FORMAT } from "./guards.ts";
import { ModelUnavailableError, ModelVerificationError, NetworkUnavailableError, type PrivateModel } from "./model.ts";
import type { PatchKind } from "@rerun/shared";
import { dateInstall } from "./dateinstall.ts";
import { proposeAndApplyRepair, type AppliedPatch } from "./repair.ts";

/**
 * One reproduction run (build plan §5.2). The LLM can only repair the environment and point at
 * where a number lives; this code decides the outcome.
 *
 * Private-data claims: plaintext enters the sandbox only after setup, the code then runs with no
 * network, and from that moment no log or output goes to the LLM, the stream, or the receipt.
 */

export const MAX_REPAIR_ATTEMPTS = 6;
/** Repairs stop here even with tries left. A normal attempt costs well under a cent. */
export const REPAIR_COST_CAP_USD = 0.05;
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
  | "stress_testing"
  | "reimplementing"
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
  /** The paper's methods section, for the independent re-implementation check. */
  methods?: string;
  /** Changes a person made to how the code is launched. They go in the receipt, labelled as human. */
  humanPatches?: HumanPatch[];
  /** Not the authors' own code. A mismatch could be the rebuild's fault, so it doesn't count against the paper. */
  independentRebuild?: boolean;
}

export interface HumanPatch {
  /** One word, as it appears in the diff header, such as "entrypoint". */
  file: string;
  kind: PatchKind;
  why: string;
}

export interface RunDeps {
  sandbox: Sandbox;
  model: PrivateModel;
  resolver: ArtifactResolver;
  emit?: (e: StageEvent) => void;
  /** A fresh workspace with none of the authors' code. Without it, re-implementation is skipped. */
  newSandbox?: () => Sandbox;
  /** Before any AI repair, try installing the packages as of the commit's date. */
  dateInstall?: boolean;
  /** Stores a log, report or evidence file and returns its URI. Not called with private-run logs. */
  store?: (kind: "log" | "report" | "evidence", hash: string, content: string) => Promise<string>;
  now?: () => number;
}

export interface RunResult {
  receipt: Receipt;
  report: string;
  rejectedEdits: { file: string; reason: string }[];
  evidence: Evidence;
}

const SETUP_NETWORK_RETRIES = 3;
/** The AI's opinion never decides a verdict, so "it can't be fixed" settles nothing. */
const AI_GAVE_UP = "the AI concluded it couldn't get the software running, which says nothing about the research";
const NETWORK_FAILURE = /read timed out|readtimeouterror|connection (reset|refused|timed out|aborted)|connectionerror|temporary failure in name resolution|could not resolve host|name or service not known|network is unreachable|cannot open url|failed to connect/i;

/** A dropped connection during setup is the Lab's problem, not a finding about the research. */
export function isNetworkFailure(log: string): boolean {
  return NETWORK_FAILURE.test(log);
}

// The model's hidden reasoning counts against this, so it needs far more room than the 120-word report.
const REPORT_MAX_TOKENS = 5000;

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
  emit({ stage: "attesting", message: `checking that the AI (${model.modelId}) runs on secure hardware` });
  await model.attest(); // no attested model, no run
  const isPrivate = spec.private_data !== null;
  const { artifact } = spec;

  const dataHashes: string[] = [];
  const dataBytes = new Map<string, Uint8Array>();
  let robustness: RobustnessResult = { status: "not_attempted", reason: "The run did not produce a result to stress-test.", runs: [] };
  let baseRunMs = 0;
  const patches: AppliedPatch[] = (input.humanPatches ?? []).map((h) => {
    const diff = `--- ${h.file} [${h.kind} by human] ${h.why}\n`;
    return { file: h.file, kind: h.kind, by: "human", justification: h.why, diff, diffHash: sha256(diff) };
  });
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

  let unusableReplies = 0;
  let installCommand = artifact.setup.join(" && ");
  let dateInstallTried = false;

  /** The plain-code fix, tried once before any AI. Returns true if the packages are now in place. */
  const tryDateInstall = async (): Promise<boolean> => {
    if (!deps.dateInstall || dateInstallTried || spec.private_data) return false;
    dateInstallTried = true;
    emit({ stage: "installing", message: "trying the packages as they were on the date of this code" });
    const installed = await dateInstall(spec, sandbox);
    if (!installed.ok || !installed.patch || !installed.installCommand) {
      emit({ stage: "installing", message: "the packages from that date wouldn't install, so the AI will look at it" });
      return false;
    }
    patches.push(installed.patch);
    installCommand = installed.installCommand;
    emit({ stage: "installing", message: installed.patch.justification, diff: installed.patch.diff });
    return true;
  };

  /** One repair round. Returns false once no further attempt is possible. */
  const repair = async (phase: "setup" | "run", errorLog: string): Promise<boolean> => {
    const overBudget = (model.spentThisRun?.() ?? 0) >= REPAIR_COST_CAP_USD;
    if (attempts.length >= MAX_REPAIR_ATTEMPTS || overBudget) {
      if (attempts.length > 0 && unusableReplies === attempts.length) throw new ModelUnavailableError(`the AI gave no usable answer in ${attempts.length} tries, so no repair was attempted and no verdict is posted`);
      // Running out of tries says nothing about the research, so nobody wins.
      throw new Stop("INVALID", "ENV_SETUP_FAILED", overBudget ? "the repair budget ran out before the software was running" : `the software still wasn't running after ${attempts.length} repair attempts`);
    }
    emit({ stage: "repairing", message: `the code failed, so the AI is looking for a setup problem it can fix (try ${attempts.length + 1} of ${MAX_REPAIR_ATTEMPTS})` });
    const result = await proposeAndApplyRepair({
      model,
      sandbox,
      phase,
      errorLog,
      entrypoint: artifact.entrypoint,
      setup: artifact.setup,
      guard,
      previous: attempts,
      kept: patches,
      installCommand,
    });
    if (result.unusable) unusableReplies++;
    for (const r of result.rejected) {
      rejectedEdits.push(r);
      emit({ stage: "repairing", message: `blocked an AI edit to ${r.file}: ${r.reason}` });
    }
    for (const p of result.applied) {
      patches.push(p);
      emit({ stage: "repairing", message: `fixed a setup problem in ${p.file}`, diff: p.diff });
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
    emit({ stage: "fetching", message: `downloading the code from ${artifact.repo_url}, at the exact version in the claim` });
    await sandbox.create();
    if (!(await resolver.fetchRepo(spec, sandbox))) {
      throw new Stop("INVALID", "DATA_UNAVAILABLE", "could not fetch the repository at the pinned commit");
    }
    const head = await sandbox.exec("git rev-parse HEAD", { network: false, timeoutMs: 60_000 });
    if (head.exitCode !== 0 || head.log.trim() !== artifact.commit) {
      throw new Stop("INVALID", "HASH_MISMATCH", `repository HEAD ${head.log.trim().slice(0, 40)} is not the pinned commit`);
    }

    emit({ stage: "verifying_hashes", message: artifact.data.length === 0 ? "this claim has no public data files" : `checking that the data files have not changed` });
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
      dataBytes.set(d.path, bytes);
      emit({ stage: "verifying_hashes", message: `${d.path} matches the claim` });
    }

    // Setup: network on, no private data present yet, so logs are safe to share with the model.
    while (true) {
      emit({ stage: "installing", message: artifact.setup.length ? "installing what the code needs" : "nothing to install" });
      if (artifact.setup.length === 0) break;
      lastExec = await sandbox.exec(installCommand, { network: true, timeoutMs: SETUP_TIMEOUT_MS });
      for (let retry = 0; lastExec.exitCode !== 0 && !lastExec.timedOut && isNetworkFailure(lastExec.tail) && retry < SETUP_NETWORK_RETRIES; retry++) {
        emit({ stage: "installing", message: `the internet dropped while installing, so the Lab is trying again (${retry + 1} of ${SETUP_NETWORK_RETRIES})` });
        lastExec = await sandbox.exec(installCommand, { network: true, timeoutMs: SETUP_TIMEOUT_MS });
      }
      if (lastExec.exitCode === 0) break;
      if (lastExec.timedOut || isNetworkFailure(lastExec.tail)) throw new NetworkUnavailableError("installing packages kept stalling or failing to connect, so no verdict is posted");
      exitCode = lastExec.exitCode;
      if (await tryDateInstall()) break;
      if (!(await repair("setup", lastExec.tail))) throw new Stop("INVALID", "ENV_SETUP_FAILED", AI_GAVE_UP);
    }
    const lock = await sandbox.exec(lockCommand(artifact.runtime), { network: false, timeoutMs: 120_000 });
    envLockHash = sha256(lock.log);

    if (spec.private_data) {
      emit({ stage: "decrypting", message: "unlocking the private data inside the Lab" });
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
      emit({ stage: "running", message: `running ${isPrivate ? "the analysis" : artifact.entrypoint}, with the internet cut off` });
      lastExec = await sandbox.exec(artifact.entrypoint, {
        network: false,
        timeoutMs: spec.resources.max_minutes * 60_000,
      });
      runtimeSecs += Math.ceil(lastExec.durationMs / 1000);
      baseRunMs = lastExec.durationMs;
      exitCode = lastExec.exitCode;
      if (lastExec.timedOut) throw new Stop("BROKEN", null, `the run exceeded its ${spec.resources.max_minutes}-minute limit`);
      if (lastExec.exitCode === 0) break;
      if (isPrivate) throw new Stop("BROKEN", null, "the run failed; logs are not shared because this claim uses private data");
      if (await tryDateInstall()) {
        const relock = await sandbox.exec(lockCommand(artifact.runtime), { network: false, timeoutMs: 120_000 });
        envLockHash = sha256(relock.log);
        continue;
      }
      const before = patches.length;
      if (!(await repair("run", lastExec.tail))) throw new Stop("INVALID", "ENV_SETUP_FAILED", AI_GAVE_UP);
      // A fix to the package list does nothing until the packages are installed again.
      if (patches.slice(before).some((p) => p.kind === "DEPENDENCY") && artifact.setup.length > 0) {
        emit({ stage: "installing", message: "installing the corrected list of packages" });
        const reinstall = await sandbox.exec(installCommand, { network: true, timeoutMs: SETUP_TIMEOUT_MS });
        if (reinstall.timedOut || (reinstall.exitCode !== 0 && isNetworkFailure(reinstall.tail))) {
          throw new NetworkUnavailableError("installing packages kept stalling or failing to connect, so no verdict is posted");
        }
        if (reinstall.exitCode !== 0) {
          lastExec = reinstall;
          exitCode = reinstall.exitCode;
          if (!(await repair("setup", reinstall.tail))) throw new Stop("INVALID", "ENV_SETUP_FAILED", AI_GAVE_UP);
        }
        const relock = await sandbox.exec(lockCommand(artifact.runtime), { network: false, timeoutMs: 120_000 });
        envLockHash = sha256(relock.log);
      }
    }

    emit({ stage: "extracting", message: `reading the ${spec.metric.name} from the output` });
    measured = await extract(spec, sandbox, model, isPrivate);
    if (measured === null) throw new Stop("INVALID", "EXTRACTION_FAILED", `could not extract ${spec.metric.name}`);

    emit({ stage: "comparing", message: `got ${measured}; the paper says ${spec.metric.reported_value} (allowed margin ${spec.metric.tolerance.value})` });
    const within = withinTolerance(
      parseDecimal(measured),
      parseDecimal(spec.metric.reported_value),
      spec.metric.tolerance.type,
      parseDecimal(spec.metric.tolerance.value),
    );
    if (!within && input.independentRebuild) {
      throw new Stop("INVALID", "REBUILD_MISMATCH", `an independent rebuild got ${measured}, but that could be the rebuild's doing and not the paper's`);
    }
    outcome = within ? "REPRODUCED" : "NOT_REPRODUCED";
    summary = within ? "The measured value is within tolerance." : "The code ran, but the measured value is outside tolerance.";

    // The verdict is fixed above. From here on, a failure only marks a check as incomplete.
    if (isPrivate) {
      robustness = { status: "not_attempted", reason: "This claim uses private data, so no extra runs are made.", runs: [] };
    } else {
      const measuredValue = measured;
      robustness = await runRobustness({
        spec,
        sandbox,
        measured: measuredValue,
        baseRunMs,
        data: dataBytes,
        emit: (message) => emit({ stage: "stress_testing", message }),
      }).catch((e: Error): RobustnessResult => ({ status: "could_not_complete", reason: e.message.slice(0, 200), runs: [] }));
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    outcome = e.outcome;
    reason = e.reason;
    summary = e.message;
    measured = null;
  } finally {
    await sandbox.destroy();
  }

  // Needs the data to be verified. Runs in its own workspace, so the main one is already gone.
  let reimplementation: ReimplementationResult = { status: "not_attempted", reason: "The claim's data could not be verified." };
  if (reason === null) {
    reimplementation = await runReimplementation({
      spec,
      methods: input.methods,
      data: dataBytes,
      newSandbox: deps.newSandbox,
      model,
      emit: (message) => emit({ stage: "reimplementing", message }),
    }).catch((e: Error): ReimplementationResult => ({ status: "could_not_complete", reason: e.message.slice(0, 200), model: model.modelId }));
  }
  const evidence: Evidence = {
    version: 1,
    note: "Extra evidence. It does not settle the market: only the normal re-run does. The re-implementation is experimental, and a difference does not mean the paper is wrong.",
    robustness,
    reimplementation,
  };

  // Private runs publish no log content, only the hash of what was produced.
  const logBody = lastExec?.log ?? summary;
  const logHash = lastExec?.logHash ?? sha256(summary);
  const logUri = isPrivate ? "" : ((await deps.store?.("log", logHash, logBody)) ?? "");

  emit({ stage: "reporting", message: "writing up the result" });
  // The evidence file's hash goes inside the report, and the report's hash goes on-chain.
  const evidenceJson = JSON.stringify(evidence, null, 2);
  const evidenceHash = sha256(evidenceJson);
  await deps.store?.("evidence", evidenceHash, evidenceJson);
  const body = await writeReport({ spec, model, outcome, reason, measured, patches, attempts, summary, isPrivate, runtimeSecs, evidenceSummary: summarizeEvidence(evidence, spec) });
  const report = `${body.trimEnd()}\n\nEvidence file sha256: ${evidenceHash}\n`;
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
  return { receipt, report, rejectedEdits, evidence };
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
    JSON_OBJECT_FORMAT,
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
  evidenceSummary: string;
}): Promise<string> {
  const facts = [
    `Claim: ${a.spec.title}`,
    `Statement: ${a.spec.statement}`,
    `Outcome: ${a.outcome}${a.reason ? ` (${a.reason})` : ""}`,
    `Finding: ${a.summary}`,
    `Metric ${a.spec.metric.name}: reported ${a.spec.metric.reported_value}, measured ${a.measured ?? "none"}, tolerance ${toleranceString(a.spec)}`,
    `Runtime: ${a.runtimeSecs}s`,
    `Environment patches: ${a.patches.map((p) => `${p.kind} ${p.file}, made by ${p.by}: ${p.justification}`).join("; ") || "none"}`,
    `Repair attempts: ${a.attempts.join(" | ") || "none"}`,
    a.evidenceSummary,
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
            "Write a short, plain reproduction report (at most 120 words) for a general reader: what ran, what was patched, and the result. Use only the facts given, in plain paragraphs with no markdown or headings. Reproduction is not replication: do not claim the science is true or false.",
        },
        { role: "user", content: facts },
      ],
      REPORT_MAX_TOKENS, // reasoning tokens count against this
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

