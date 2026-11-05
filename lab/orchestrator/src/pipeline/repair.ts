import { createHash } from "node:crypto";
import type { PatchKind } from "@rerun/shared";
import { REPO_DIR, type Sandbox } from "../sandbox/types.ts";
import { checkEdit, parseJsonReply, RepairProposal, type GuardContext, type RepairEdit } from "./guards.ts";
import type { PrivateModel } from "./model.ts";

const SYSTEM_PROMPT = `You repair the software ENVIRONMENT of a published research artifact so its unchanged analysis can run.

ALLOWED: dependency pins, missing packages, file paths, locale/encoding settings, renames of deprecated APIs in non-analysis glue code.
FORBIDDEN: changing data, model code, hyperparameters, random seeds, metrics, thresholds, sample selection, or anything that could affect the numeric result. Never hardcode or write a result.

Every edit is checked by code and rejected if it touches analysis logic, numbers or output files. If the failure cannot be fixed within these rules, give up. A broken artifact is a legitimate finding.

Reply with a single JSON object and nothing else:
{"give_up": boolean, "reason": "short explanation", "edits": [{"file": "relative/path", "kind": "ENV|PATH|DEPENDENCY", "justification": "why this is environment-only", "search": "exact text occurring once in the file", "replace": "new text"}]}
Use kind DEPENDENCY only for dependency files. "search" may be empty only to create a new dependency file. Keep edits minimal.

You have few attempts, so fix the whole problem at once. If the same removed feature appears on several lines in the code you can see, send one edit for each. When you write a dependency file, list everything the error and file names suggest is needed.`;

// The model's hidden reasoning counts against this. 2000 proved too few on a real repository: the answer came back empty.
const REPAIR_MAX_TOKENS = 8000;

const SOURCE_FILES_SHOWN = 3;
const SOURCE_LINES_AROUND = 8;

/**
 * The code around each line an error names. Without it the model must guess the exact text of an
 * edit in a file it can't see, and spends its whole budget trying. Only runs on the repair path,
 * which private-data claims never take.
 */
export async function sourceAroundError(errorLog: string, sandbox: Pick<Sandbox, "readFile">): Promise<string> {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const m of errorLog.matchAll(/File "(?:\/work\/repo\/|\.\/)?([^"\s]+)", line (\d+)/g)) {
    const file = m[1]!;
    const line = Number(m[2]);
    const key = `${file}:${line}`;
    if (file.startsWith("/") || seen.has(key) || seen.size >= SOURCE_FILES_SHOWN) continue;
    seen.add(key);
    const body = await sandbox.readFile(file, 1024 * 1024).catch(() => null);
    if (!body) continue;
    const lines = body.toString("utf8").split("\n");
    const from = Math.max(line - SOURCE_LINES_AROUND - 1, 0);
    const shown = lines.slice(from, line + SOURCE_LINES_AROUND).map((text, i) => `${from + i + 1}: ${text}`);
    parts.push(`${file}, around line ${line}:\n${shown.join("\n")}`);
  }
  return parts.join("\n\n");
}

export interface AppliedPatch {
  file: string;
  kind: PatchKind;
  diffHash: string;
  diff: string;
  justification: string;
}

export interface RepairOutcome {
  /** The AI's reply couldn't be used at all, as opposed to a real attempt or a decision to give up. */
  unusable?: boolean;
  gaveUp: boolean;
  reason: string;
  applied: AppliedPatch[];
  rejected: { file: string; reason: string }[];
}

export async function proposeAndApplyRepair(args: {
  model: PrivateModel;
  sandbox: Sandbox;
  phase: "setup" | "run";
  errorLog: string;
  entrypoint: string;
  setup: string[];
  guard: Omit<GuardContext, "fileExists">;
  previous: string[];
}): Promise<RepairOutcome> {
  const { model, sandbox, phase, errorLog, entrypoint, setup, guard, previous } = args;
  const files = await sandbox.listFiles(200);
  const source = await sourceAroundError(errorLog, sandbox);
  const user = [
    `The ${phase} phase failed.`,
    `Setup commands: ${JSON.stringify(setup)}`,
    `Entrypoint: ${entrypoint}`,
    `Files in the repository (working directory ${REPO_DIR}):\n${files.join("\n")}`,
    `Earlier attempts in this run:\n${previous.length ? previous.join("\n") : "none"}`,
    `Error output (last part):\n${errorLog.slice(-6000)}`,
    source ? `Source code around the error. Copy "search" text exactly from here, without the line numbers:\n${source}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = await model.ask(
    "repair",
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    REPAIR_MAX_TOKENS,
  );

  let proposal: RepairProposal;
  try {
    proposal = RepairProposal.parse(parseJsonReply(reply));
  } catch (e) {
    return { gaveUp: false, unusable: true, reason: `unusable model reply: ${(e as Error).message.slice(0, 200)}`, applied: [], rejected: [] };
  }
  if (proposal.give_up || proposal.edits.length === 0) {
    return { gaveUp: true, reason: proposal.reason, applied: [], rejected: [] };
  }

  const applied: AppliedPatch[] = [];
  const rejected: RepairOutcome["rejected"] = [];
  for (const edit of proposal.edits) {
    const result = await applyEdit(edit, sandbox, guard);
    if (typeof result === "string") rejected.push({ file: edit.file, reason: result });
    else applied.push(result);
  }
  return { gaveUp: false, reason: proposal.reason, applied, rejected };
}

async function applyEdit(edit: RepairEdit, sandbox: Sandbox, guard: Omit<GuardContext, "fileExists">): Promise<AppliedPatch | string> {
  const file = edit.file.replace(/^\.\//, "");
  const current = (await sandbox.readFile(file, 1024 * 1024).catch(() => null))?.toString("utf8") ?? null;
  const reason = checkEdit(edit, { ...guard, fileExists: current !== null });
  if (reason) return reason;

  let updated: string;
  if (edit.search === "") {
    updated = edit.replace;
  } else {
    const occurrences = current === null ? 0 : current.split(edit.search).length - 1;
    if (occurrences !== 1) return `search text must occur exactly once in ${file} (found ${occurrences})`;
    updated = current!.replace(edit.search, () => edit.replace);
  }
  await sandbox.writeFile(file, Buffer.from(updated));

  const diff = `--- ${file} [${edit.kind}] ${edit.justification}\n${prefixLines("-", edit.search)}\n${prefixLines("+", edit.replace)}\n`;
  return {
    file,
    kind: edit.kind,
    diff,
    diffHash: createHash("sha256").update(diff).digest("hex"),
    justification: edit.justification,
  };
}

function prefixLines(prefix: string, text: string): string {
  return text.split("\n").map((l) => `${prefix} ${l}`).join("\n");
}
