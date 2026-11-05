/**
 * The scout's plain-code checks. They decide which research is worth an AI draft at all, and every
 * reason is kept, so anyone can see why a paper was accepted or turned down.
 */

const OPEN_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.1", "LGPL-3.0", "MPL-2.0", "Unlicense", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"]);

const GPU_ONLY = /(^|[\s/_.=<>-])(torch|pytorch|tensorflow|keras|jax|cuda|cudatoolkit|mxnet)($|[\s/_.=<>-])/i;

const MAX_REPO_KB = 200 * 1024;

export interface RepoFacts {
  license: string | null;
  /** Bytes of code per language, as GitHub reports it. */
  languages: Record<string, number>;
  sizeKb: number;
  archived: boolean;
  files: string[];
  /** The text of requirements.txt, environment.yml and similar, if there are any. */
  dependencyText: string;
}

export interface FilterResult {
  accepted: boolean;
  /** Why it passed or failed, one plain sentence per check. */
  reasons: string[];
  runtime: "python3.11" | "r4.4" | null;
}

export function checkRepo(facts: RepoFacts): FilterResult {
  const failures: string[] = [];
  const passes: string[] = [];

  if (facts.license && OPEN_LICENSES.has(facts.license)) passes.push(`Open licence: ${facts.license}.`);
  else failures.push(facts.license && facts.license !== "NOASSERTION" ? `Licence ${facts.license} isn't on our list of open licences.` : "GitHub can't identify an open licence.");

  const total = Object.values(facts.languages).reduce((a, b) => a + b, 0);
  const [top, topBytes] = Object.entries(facts.languages).sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
  const runtime = top === "Python" || top === "Jupyter Notebook" ? "python3.11" : top === "R" ? "r4.4" : null;
  if (runtime && total > 0) passes.push(`Mostly ${top} (${Math.round((topBytes / total) * 100)}% of the code).`);
  else failures.push(`Mostly ${top}. The Lab only runs Python and R.`);

  const gpu = GPU_ONLY.exec(facts.dependencyText)?.[2];
  if (gpu) failures.push(`Depends on ${gpu}, which usually needs a graphics card. The Lab only has CPUs.`);
  else passes.push("No sign it needs a graphics card.");

  if (facts.sizeKb > MAX_REPO_KB) failures.push(`The repository is ${Math.round(facts.sizeKb / 1024)} MB, too big to re-run quickly.`);
  else passes.push("Small enough to re-run.");

  if (facts.archived) passes.push("Archived on GitHub, so it won't change.");

  return { accepted: failures.length === 0, reasons: failures.length ? failures : passes, runtime };
}

/** A clear number is the last check, since only the AI draft can find one. */
export function isClearNumber(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}
