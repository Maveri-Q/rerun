import { createHash } from "node:crypto";
import { normalizeDecimal, parseDecimal, withinTolerance, type ClaimSpec } from "@rerun/shared";
import { REPO_DIR, type Sandbox } from "../sandbox/types.ts";
import { extractMetric, MAX_OUTPUT_BYTES } from "./extract.ts";
import type { PrivateModel } from "./model.ts";

/**
 * Extra evidence, on top of the normal re-run. None of this can change a market's outcome:
 * it runs after the verdict is fixed, and any failure here only marks that check incomplete.
 */

export type Emit = (message: string) => void;

// ---------------------------------------------------------------- robustness

export interface RobustnessRun {
  kind: "seed" | "resample";
  label: string;
  value: string | null;
}

export interface RobustnessResult {
  status: "stable" | "sensitive" | "could_not_complete" | "not_attempted";
  reason?: string;
  /** False when changing the random seed made no difference at all, so the code may not use randomness. */
  seed_had_effect?: boolean;
  measured?: string;
  runs: RobustnessRun[];
}

const SEED_OFFSETS = [1, 2, 3];
const RESAMPLES = 2;
const MAX_TOTAL_MS = 10 * 60_000;
const MAX_RESAMPLE_BYTES = 50 * 1024 * 1024;

/** Shifts every seed the code sets, without touching its files. Loaded by Python at start-up. */
const PYTHON_SEED_SHIFT = `import os
offset = int(os.environ.get("RERUN_SEED_OFFSET", "0"))
def shifted(seed):
    return seed + offset if isinstance(seed, int) and not isinstance(seed, bool) else seed
import random as _random
_seed = _random.seed
_random.seed = lambda a=None, *args, **kw: _seed(shifted(a), *args, **kw)
try:
    import numpy as _np
    _RandomState = _np.random.RandomState
    class RandomState(_RandomState):
        def __init__(self, seed=None):
            super().__init__(shifted(seed))
    _np.random.RandomState = RandomState
    _np_seed = _np.random.seed
    _np.random.seed = lambda seed=None: _np_seed(shifted(seed))
    _rng = _np.random.default_rng
    _np.random.default_rng = lambda seed=None: _rng(shifted(seed))
except ImportError:
    pass
`;

const R_SEED_SHIFT = `set.seed <- function(seed, ...) base::set.seed(seed + as.integer(Sys.getenv("RERUN_SEED_OFFSET", "0")), ...)
`;

/** Rows drawn with replacement from a CSV, reproducibly. Null if the file can't be split safely by line. */
export function resampleCsv(bytes: Uint8Array, seed: number): Buffer | null {
  if (bytes.length > MAX_RESAMPLE_BYTES) return null;
  const text = Buffer.from(bytes).toString("utf8");
  if (text.includes('"')) return null; // a quoted field may contain a line break
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l !== "");
  if (!header || rows.length < 2) return null;
  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sampled = rows.map(() => rows[Math.floor(rand() * rows.length)]);
  return Buffer.from(`${[header, ...sampled].join("\n")}\n`);
}

/**
 * Runs the unchanged code several more times, in the same workspace with the network off:
 * once per shifted random seed, and on bootstrap resamples of any CSV data. The spread says whether
 * the number depends on luck. Never runs on private data.
 */
export async function runRobustness(args: {
  spec: ClaimSpec;
  sandbox: Sandbox;
  measured: string;
  baseRunMs: number;
  data: Map<string, Uint8Array>;
  emit: Emit;
}): Promise<RobustnessResult> {
  const { spec, sandbox, measured, data, emit } = args;
  const { entrypoint, output, runtime } = spec.artifact;
  const started = Date.now();
  const limit = Math.min(MAX_TOTAL_MS, spec.resources.max_minutes * 60_000);
  const remaining = () => limit - (Date.now() - started);
  const runs: RobustnessRun[] = [];

  const python = runtime === "python3.11";
  await sandbox.writeFile(python ? "../.rerun/sitecustomize.py" : "../.rerun/Rprofile", Buffer.from(python ? PYTHON_SEED_SHIFT : R_SEED_SHIFT));
  const prefix = python ? "export PYTHONPATH=/work/.rerun" : "export R_PROFILE_USER=/work/.rerun/Rprofile";

  const read = async (): Promise<string | null> => {
    const bytes = await sandbox.readFile(output.path, MAX_OUTPUT_BYTES);
    if (!bytes) return null;
    try {
      return extractMetric(bytes.toString("utf8"), output.extractor.type, output.extractor.expr);
    } catch {
      return null;
    }
  };
  const once = async (script: string): Promise<string | null> => {
    if (remaining() <= 0) return null;
    const r = await sandbox.exec(script, { network: false, timeoutMs: remaining() });
    return r.exitCode === 0 && !r.timedOut ? read() : null;
  };

  for (const offset of SEED_OFFSETS) {
    emit(`re-running with a different random seed (${offset} of ${SEED_OFFSETS.length})`);
    runs.push({ kind: "seed", label: `Seed shifted by ${offset}`, value: await once(`${prefix}; export RERUN_SEED_OFFSET=${offset}; ${entrypoint}`) });
  }

  const csvs = [...data].filter(([path]) => /\.csv$/i.test(path));
  for (let i = 0; i < RESAMPLES && csvs.length > 0; i++) {
    const swapped = csvs.map(([path, bytes]) => [path, resampleCsv(bytes, 1000 + i)] as const);
    if (swapped.some(([, b]) => b === null)) break;
    emit(`re-running on a resampled copy of the data (${i + 1} of ${RESAMPLES})`);
    for (const [path, bytes] of swapped) await sandbox.writeFile(path, bytes!);
    runs.push({ kind: "resample", label: `Resampled data ${i + 1}`, value: await once(entrypoint) });
  }
  for (const [path, bytes] of csvs) await sandbox.writeFile(path, bytes);

  const values = runs.map((r) => r.value).filter((v): v is string => v !== null);
  if (values.length === 0) return { status: "could_not_complete", reason: "None of the extra runs produced a number.", measured, runs };

  const tolerance = parseDecimal(spec.metric.tolerance.value);
  const base = parseDecimal(measured);
  const stable = values.every((v) => withinTolerance(parseDecimal(v), base, spec.metric.tolerance.type, tolerance));
  const seedValues = runs.filter((r) => r.kind === "seed" && r.value !== null).map((r) => r.value);
  return {
    status: stable ? "stable" : "sensitive",
    seed_had_effect: seedValues.some((v) => v !== measured),
    measured,
    runs,
  };
}

// ---------------------------------------------------------------- re-implementation

export interface ReimplementationResult {
  status: "agrees" | "differs" | "could_not_complete" | "not_attempted";
  reason?: string;
  value?: string;
  model?: string;
  attempts?: number;
  /** The analysis the AI wrote, published so anyone can read and run it. */
  script?: string;
  script_hash?: string;
  methods_hash?: string;
}

const MAX_FIX_ATTEMPTS = 3;
const SCRIPT_NAME = "reimplementation.py";
const RESULT_FILE = "reimplementation_result.json";
const REIMPLEMENT_TIMEOUT_MS = 5 * 60_000;

const SYSTEM_PROMPT = `You re-implement a published analysis from its written methods, to test whether the description alone leads to the same result. You have not seen the authors' code or their result.

Write one complete Python 3.11 script. numpy, pandas, scipy, scikit-learn and statsmodels are installed. There is no network. Follow the methods as written; where they leave something open, make the most standard choice and note it in a comment. Never invent data or a result.

The script must compute the requested metric from the data files and write it with: json.dump({"value": <number>}, open("${RESULT_FILE}", "w"))

Reply with the script in a single \`\`\`python code block and nothing else.`;

/** Variants of the reported number, so the AI can't work backwards to it. */
function reportedForms(reported: string): string[] {
  const abs = reported.replace(/^-/, "");
  const forms = new Set([abs, abs.replace(/^0\./, ".")]);
  const n = Number(abs);
  if (n > 0 && n <= 1) {
    const pct = normalizeDecimal(String(Math.round(n * 1e10) / 1e8));
    forms.add(`${pct}%`);
    forms.add(`${pct} %`);
    forms.add(`${pct} percent`);
  }
  return [...forms];
}

export function redactReported(methods: string, reported: string): string {
  let out = methods;
  for (const form of reportedForms(reported).sort((a, b) => b.length - a.length)) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\d.])${escaped}(?!\\d)`, "g"), "[result hidden]");
  }
  return out;
}

/**
 * True if a script hardcodes the reported number. Only numbers with two or more significant digits
 * are checked: banning a plain 1 or 0.5 would reject honest code, and they're easy to reach anyway.
 */
export function scriptContainsReported(script: string, reported: string): boolean {
  const abs = reported.replace(/^-/, "");
  const digits = abs.replace(/^0+\.?0*/, "").replace(/\.|0+$/g, "");
  if (digits.length < 2) return false;
  const target = Number(abs);
  const numbers = script.replace(/#.*$/gm, "").match(/(?<![\w.])\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  return numbers.some((n) => {
    const v = Number(n);
    return v === target || (target <= 1 && Math.abs(v - target * 100) < 1e-9);
  });
}

function pythonBlock(reply: string): string | null {
  const m = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(reply);
  return m ? m[1]!.trim() : null;
}

/** What the AI may see of a data file: where it is, its columns and its size, never its values. */
function describeData(path: string, bytes: Uint8Array): string {
  if (!/\.(csv|tsv)$/i.test(path)) return `${path}: ${bytes.length} bytes`;
  const text = Buffer.from(bytes).toString("utf8");
  const firstBreak = text.indexOf("\n");
  const header = (firstBreak >= 0 ? text.slice(0, firstBreak) : text).trim().slice(0, 1000);
  const rows = Math.max(text.split("\n").filter(Boolean).length - 1, 0);
  return `${path}: columns ${header}; ${rows} rows`;
}

/**
 * A separate analysis written from the methods text alone, run in a fresh workspace that holds the
 * data but none of the authors' code. Limited to Python, public data and a single script.
 */
export async function runReimplementation(args: {
  spec: ClaimSpec;
  methods: string | undefined;
  data: Map<string, Uint8Array>;
  newSandbox: (() => Sandbox) | undefined;
  model: PrivateModel;
  emit: Emit;
}): Promise<ReimplementationResult> {
  const { spec, methods, data, newSandbox, model, emit } = args;
  const skip = (reason: string): ReimplementationResult => ({ status: "not_attempted", reason });
  if (spec.private_data) return skip("This claim uses private data, which is never shown to the AI.");
  if (spec.artifact.runtime !== "python3.11") return skip("This check only handles Python for now.");
  if (data.size === 0) return skip("This claim has no public data files to work from.");
  if (!methods?.trim()) return skip("Nobody provided the paper's methods section.");
  if (!newSandbox) return skip("This Lab has no spare workspace for it.");

  const redacted = redactReported(methods, spec.metric.reported_value);
  const base: ReimplementationResult = {
    status: "could_not_complete",
    model: model.modelId,
    methods_hash: createHash("sha256").update(methods).digest("hex"),
  };
  const user = [
    `Metric to compute: ${spec.metric.name}`,
    `Methods section:\n${redacted}`,
    `Data files, in the working directory ${REPO_DIR}:\n${[...data].map(([p, b]) => describeData(p, b)).join("\n")}`,
  ].join("\n\n");

  const sandbox = newSandbox();
  try {
    await sandbox.create();
    for (const [path, bytes] of data) await sandbox.writeFile(path, bytes);

    let feedback = "";
    let lastReason = "The AI did not produce a usable script.";
    for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS + 1; attempt++) {
      emit(attempt === 1 ? "the AI is writing its own analysis from the paper's description" : `the AI is fixing its script (attempt ${attempt})`);
      const reply = await model.ask(
        "reimplement",
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: feedback ? `${user}\n\nYour last script failed:\n${feedback}` : user },
        ],
        5000,
      );
      const script = pythonBlock(reply);
      if (!script) {
        feedback = "Reply with the script in a single ```python code block.";
        continue;
      }
      if (scriptContainsReported(script, spec.metric.reported_value)) {
        return { ...base, attempts: attempt, script, reason: "The script hardcoded the published number, so it was rejected without running." };
      }
      await sandbox.writeFile(SCRIPT_NAME, Buffer.from(script));
      emit("running the AI's analysis with the network off, without the authors' code");
      const run = await sandbox.exec(`python ${SCRIPT_NAME}`, { network: false, timeoutMs: REIMPLEMENT_TIMEOUT_MS });
      if (run.timedOut) return { ...base, attempts: attempt, script, reason: "The script ran past its time limit." };
      if (run.exitCode !== 0) {
        lastReason = "The script kept failing.";
        feedback = run.tail.slice(-3000);
        continue;
      }
      const bytes = await sandbox.readFile(RESULT_FILE, MAX_OUTPUT_BYTES);
      let value: string;
      try {
        if (!bytes) throw new Error(`the script did not write ${RESULT_FILE}`);
        value = extractMetric(bytes.toString("utf8"), "jsonpath", "$.value");
      } catch (e) {
        lastReason = "The script did not produce a number.";
        feedback = (e as Error).message;
        continue;
      }
      const agrees = withinTolerance(parseDecimal(value), parseDecimal(spec.metric.reported_value), spec.metric.tolerance.type, parseDecimal(spec.metric.tolerance.value));
      return {
        ...base,
        status: agrees ? "agrees" : "differs",
        value,
        attempts: attempt,
        script,
        script_hash: createHash("sha256").update(script).digest("hex"),
      };
    }
    return { ...base, attempts: MAX_FIX_ATTEMPTS + 1, reason: lastReason };
  } finally {
    await sandbox.destroy();
  }
}

// ---------------------------------------------------------------- the evidence file

export interface Evidence {
  version: 1;
  note: string;
  robustness: RobustnessResult;
  reimplementation: ReimplementationResult;
}

export function summarizeEvidence(e: Evidence, spec: ClaimSpec): string {
  const lines: string[] = [];
  const r = e.robustness;
  if (r.status === "stable") lines.push(`Robustness: the result stayed within ${spec.metric.tolerance.value} across ${r.runs.length} extra runs.`);
  if (r.status === "sensitive") lines.push(`Robustness: the result moved by more than ${spec.metric.tolerance.value} across ${r.runs.length} extra runs.`);
  const i = e.reimplementation;
  if (i.status === "agrees") lines.push(`Independent re-implementation (experimental): the AI's own analysis got ${i.value}, which agrees with the claim.`);
  if (i.status === "differs") lines.push(`Independent re-implementation (experimental): the AI's own analysis got ${i.value}, which differs from the claim. The paper may be vague or the AI may be wrong.`);
  return lines.join("\n");
}
