import { createHash } from "node:crypto";
import type { PatchKind } from "@rerun/shared";
import { REPO_DIR, type Sandbox } from "../sandbox/types.ts";
import { checkEdit, parseJsonReply, REPAIR_FORMAT, RepairProposal, type GuardContext, type RepairEdit } from "./guards.ts";
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
export const PARSE_RETRIES = 2;

const SOURCE_FILES_SHOWN = 3;
const SOURCE_LINES_AROUND = 8;
/** Up to this size the model sees the whole file, so it never has to guess the text of an edit. */
const WHOLE_FILE_BYTES = 16 * 1024;
const WHOLE_FILES_TOTAL_BYTES = 32 * 1024;

/** A traceback's path can be relative to the folder the entrypoint moved into. Finds it in the repository. */
export function resolveRepoFile(name: string, files: string[], entrypoint: string): string | null {
  const clean = name.replace(/^\.\//, "");
  if (files.includes(clean)) return clean;
  const dir = /^\s*cd\s+([^\s&;]+)\s*&&/.exec(entrypoint)?.[1]?.replace(/^\.\//, "").replace(/\/$/, "");
  if (dir && files.includes(`${dir}/${clean}`)) return `${dir}/${clean}`;
  const matches = files.filter((f) => f.endsWith(`/${clean}`));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * The code the model needs to write an edit: the files the error names, closest to the error first,
 * and any file an earlier edit couldn't be matched in, as they stand now. Small files come whole and
 * large ones as the lines around the error. Without this the model guesses at text it can't see and
 * spends its whole budget trying. Only runs on the repair path, which private-data claims never take.
 */
export async function sourceForRepair(args: { errorLog: string; sandbox: Pick<Sandbox, "readFile">; files: string[]; entrypoint: string; missed?: string[] }): Promise<string> {
  const { errorLog, sandbox, files, entrypoint, missed = [] } = args;
  const frames: { file: string; line: number }[] = [];
  for (const m of errorLog.matchAll(/File "(?:\/work\/repo\/|\.\/)?([^"\s]+)", line (\d+)/g)) {
    if (m[1]!.startsWith("/")) continue;
    const file = resolveRepoFile(m[1]!, files, entrypoint);
    if (file) frames.push({ file, line: Number(m[2]) });
  }
  frames.reverse();

  const named = [...new Set([...missed, ...frames.map((f) => f.file)])].slice(0, SOURCE_FILES_SHOWN);
  const parts: string[] = [];
  let wholeBytes = 0;
  for (const file of named) {
    const body = await sandbox.readFile(file, 1024 * 1024).catch(() => null);
    if (!body) continue;
    const text = body.toString("utf8");
    if (body.length <= WHOLE_FILE_BYTES && wholeBytes + body.length <= WHOLE_FILES_TOTAL_BYTES) {
      wholeBytes += body.length;
      parts.push(`The whole of ${file} as it is now:\n${text}`);
      continue;
    }
    const lines = text.split("\n");
    for (const { line } of frames.filter((f) => f.file === file).slice(0, SOURCE_FILES_SHOWN)) {
      const from = Math.max(line - SOURCE_LINES_AROUND - 1, 0);
      const shown = lines.slice(from, line + SOURCE_LINES_AROUND).map((l, i) => `${from + i + 1}: ${l}`);
      parts.push(`${file}, around line ${line} (line numbers added, not part of the file):\n${shown.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

/** Who made a change. The contract's patch record has no such field, so it travels in the diff header, which is on-chain. */
export type PatchAuthor = "ai" | "system" | "human";

export interface AppliedPatch {
  file: string;
  kind: PatchKind;
  by: PatchAuthor;
  diffHash: string;
  diff: string;
  justification: string;
}

export const SEARCH_MISSED = "search text must occur exactly once";

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
  /** Fixes from earlier attempts. They stay in place, so the model builds on them. */
  kept?: AppliedPatch[];
  /** The command that installs packages now, if an earlier step changed it. */
  installCommand?: string;
  /** Files where an earlier edit's text wasn't found, so the model sees them whole this time. */
  missed?: string[];
}): Promise<RepairOutcome> {
  const { model, sandbox, phase, errorLog, entrypoint, setup, guard, previous, kept = [], installCommand, missed } = args;
  const dependencyFile = (await sandbox.readFile("requirements.txt", 64 * 1024).catch(() => null))?.toString("utf8") ?? null;
  const files = await sandbox.listFiles(200);
  const source = await sourceForRepair({ errorLog, sandbox, files, entrypoint, missed });
  const user = [
    `The ${phase} phase failed.`,
    `Setup commands: ${JSON.stringify(setup)}`,
    `Entrypoint: ${entrypoint}`,
    `Files in the repository (working directory ${REPO_DIR}):\n${files.join("\n")}`,
    `Earlier attempts in this run:\n${previous.length ? previous.join("\n") : "none"}`,
    kept.length ? `Fixes already in place, which stay. Build on them and don't repeat them:\n${kept.map((p) => `${p.file} (${p.by}): ${p.justification}`).join("\n")}` : "",
    installCommand ? `Packages are installed with: ${installCommand}` : "",
    dependencyFile !== null ? `requirements.txt exists now, so edit it with a non-empty "search". It contains:\n${dependencyFile}` : "requirements.txt doesn't exist yet.",
    `Error output (last part):\n${errorLog.slice(-6000)}`,
    source ? `The code as it stands now, including any fixes already made. Copy "search" character for character from here, and use just enough text, usually one line, to occur only once:\n${source}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // A reply that can't be read isn't a repair attempt, so asking again doesn't use up a try.
  let proposal: RepairProposal | null = null;
  let parseError = "";
  for (let ask = 0; ask <= PARSE_RETRIES && proposal === null; ask++) {
    const reply = await model.ask(
      "repair",
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      REPAIR_MAX_TOKENS,
      REPAIR_FORMAT,
    );
    try {
      proposal = RepairProposal.parse(parseJsonReply(reply));
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  if (proposal === null) {
    return { gaveUp: false, unusable: true, reason: `unusable model reply: ${parseError.slice(0, 200)}`, applied: [], rejected: [] };
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
    // The model writes plain line breaks, so a file with Windows ones would never match. The guards have already passed this edit.
    const windows = current?.includes("\r\n") ?? false;
    const matchBreaks = (t: string) => (windows ? t.replace(/\r?\n/g, "\r\n") : t);
    const search = matchBreaks(edit.search);
    const occurrences = current === null ? 0 : current.split(search).length - 1;
    if (occurrences !== 1) return `${SEARCH_MISSED} in ${file} (found ${occurrences})`;
    updated = current!.replace(search, () => matchBreaks(edit.replace));
  }
  await sandbox.writeFile(file, Buffer.from(updated));

  const diff = `--- ${file} [${edit.kind} by ai] ${edit.justification}\n${prefixLines("-", edit.search)}\n${prefixLines("+", edit.replace)}\n`;
  return {
    file,
    kind: edit.kind,
    by: "ai",
    diff,
    diffHash: createHash("sha256").update(diff).digest("hex"),
    justification: edit.justification,
  };
}

function prefixLines(prefix: string, text: string): string {
  return text.split("\n").map((l) => `${prefix} ${l}`).join("\n");
}
