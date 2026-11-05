import { z } from "zod";
import { PatchKind } from "@rerun/shared";

/**
 * Repair guards: the LLM may fix the environment, never the science. These checks run in code
 * on every proposed edit, and a rejected edit is never applied.
 *
 * Config files (requirements and friends) may change freely, except for pulling packages from
 * arbitrary sources. Any other file counts as analysis code: only small ENV/PATH edits pass,
 * with no change to numbers, no analysis or output vocabulary, and only path-like strings.
 */

export const RepairEdit = z.strictObject({
  file: z.string().min(1).max(200),
  kind: PatchKind,
  justification: z.string().min(10).max(500),
  /** Exact text to replace; must occur once. Empty only when creating a config file. */
  search: z.string().max(2000),
  replace: z.string().max(2000),
});
export type RepairEdit = z.infer<typeof RepairEdit>;

export const RepairProposal = z.strictObject({
  give_up: z.boolean(),
  reason: z.string().max(500),
  edits: z.array(RepairEdit).max(5),
});
export type RepairProposal = z.infer<typeof RepairProposal>;

const CONFIG_FILE =
  /^(?:.*\/)?(?:requirements[\w.-]*\.(?:txt|in)|constraints[\w.-]*\.txt|environment\.ya?ml|setup\.py|setup\.cfg|pyproject\.toml|Pipfile|runtime\.txt|\.python-version|DESCRIPTION|renv\.lock|install\.R)$/;

const CODE_MAX_LINES = 5;

/** Identifiers an environment repair has no reason to add or remove. */
const FORBIDDEN_TOKENS = new Set(
  (
    "seed random_state randomstate manual_seed set_seed lr learning_rate eta epochs n_estimators max_depth max_iter alpha beta gamma lambda " +
    "penalty threshold cutoff tol accuracy accuracy_score auc roc_auc_score f1 f1_score precision recall r2 r2_score mse rmse mae loss score " +
    "metric metrics fit fit_transform transform predict predict_proba mean median std var sum min max abs round ceil floor clip quantile " +
    "drop dropna fillna dropduplicates drop_duplicates filter sample shuffle head tail iloc loc query merge groupby sort_values " +
    "train_test_split test_size train_size cross_val_score kfold stratify normalize scale " +
    "print write writelines dump dumps to_csv to_json savefig save open exit quit system popen subprocess eval exec compile __import__ " +
    "socket urllib requests http cat lm glm"
  ).split(" "),
);

/** Any identifier containing one of these is treated as analysis logic, e.g. balanced_accuracy. */
const FORBIDDEN_STEMS = /accura|score|metric|seed|random|loss|auc|predict|fit|sampl|shuffl|regress|estimat|weight|tstat|pvalue|p_value/i;

const ENCODING_OR_LOCALE = /^(?:utf-?8|utf-?16|latin-?1|iso-8859-1|ascii|cp1252|C|POSIX|en_US(?:\.UTF-8)?)$/i;

export interface GuardContext {
  dataPaths: string[];
  outputPath: string;
  privatePath?: string;
  /** Whether the file already exists in the repo. */
  fileExists: boolean;
}

/** Returns the reason an edit must be rejected, or null if it passes. */
export function checkEdit(edit: RepairEdit, ctx: GuardContext): string | null {
  const { file, search, replace, kind } = edit;
  if (file.startsWith("/") || file.includes("\\") || file.split("/").some((s) => s === ".." || s === "" || s === ".git")) {
    return `path not allowed: ${file}`;
  }
  const norm = file.replace(/^\.\//, "");
  if (ctx.dataPaths.includes(norm) || ctx.privatePath === norm) return `data files cannot be changed: ${file}`;
  if (norm === ctx.outputPath) return `the output file cannot be changed: ${file}`;
  if (search === replace) return "edit changes nothing";

  if (CONFIG_FILE.test(norm)) {
    if (kind === "PATH") return "config files take ENV or DEPENDENCY edits";
    if (search === "" && ctx.fileExists) return "empty search is only for creating a config file";
    if (/:\/\/|--index-url|--extra-index-url|--find-links|--trusted-host|^\s*-e\s/m.test(replace)) {
      return "dependencies must come from the default package registry";
    }
    return null;
  }

  // Everything else is treated as analysis code.
  if (kind === "DEPENDENCY") return `only config files take DEPENDENCY edits, not ${file}`;
  if (!ctx.fileExists || search === "") return `cannot create or rewrite analysis files: ${file}`;
  if (replace.trim() === "") return `cannot delete lines from analysis files: ${file}`;
  if (search.split("\n").length > CODE_MAX_LINES || replace.split("\n").length > CODE_MAX_LINES) {
    return `edit too large for an analysis file (max ${CODE_MAX_LINES} lines)`;
  }

  const before = tokenize(search);
  const after = tokenize(replace);
  const numBefore = before.numbers.slice().sort().join(",");
  const numAfter = after.numbers.slice().sort().join(",");
  if (numBefore !== numAfter) return `numbers changed (${numBefore || "none"} -> ${numAfter || "none"})`;

  for (const t of symmetricDiff(before.identifiers, after.identifiers)) {
    if (FORBIDDEN_TOKENS.has(t.toLowerCase()) || FORBIDDEN_STEMS.test(t)) return `touches analysis or output logic: '${t}'`;
  }
  for (const s of symmetricDiff(before.strings, after.strings)) {
    if (!isPathLike(s) && !ENCODING_OR_LOCALE.test(s)) return `changed string is not a path or encoding: '${s.slice(0, 40)}'`;
  }
  if (replace.includes(ctx.outputPath) && !search.includes(ctx.outputPath)) return "edit redirects the output file";
  return null;
}

function tokenize(code: string): { numbers: string[]; identifiers: string[]; strings: string[] } {
  const strings: string[] = [];
  const noStrings = code.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (lit) => {
    strings.push(lit.replace(/^(?:'''|"""|'|")|(?:'''|"""|'|")$/g, ""));
    return " ";
  });
  const noComments = noStrings.replace(/#.*$/gm, " ");
  return {
    strings,
    numbers: noComments.match(/(?<![A-Za-z_])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [],
    identifiers: noComments.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [],
  };
}

function symmetricDiff(a: string[], b: string[]): string[] {
  const inA = new Set(a);
  const inB = new Set(b);
  return [...new Set([...a, ...b])].filter((x) => inA.has(x) !== inB.has(x));
}

function isPathLike(s: string): boolean {
  if (s.length === 0) return true;
  if (/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(s)) return false; // a number in disguise
  return s.includes("/") || /\.[A-Za-z][A-Za-z0-9]{0,8}$/.test(s);
}

/** Pulls the JSON object out of a model reply, tolerating code fences and surrounding prose. */
export function parseJsonReply(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("reply contains no JSON object");
  // The first complete object wins: real replies sometimes carry on after it with more text or a second object.
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("reply contains no complete JSON object");
}
