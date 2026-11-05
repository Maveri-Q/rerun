import { createHash } from "node:crypto";
import type { ClaimSpec } from "@rerun/shared";
import type { Sandbox } from "../sandbox/types.ts";
import type { AppliedPatch } from "./repair.ts";

/**
 * The plain-code step before any AI repair: install the packages as they were on the day the code
 * was committed. Most old code that fails today only needs its own era's libraries, and this finds
 * them with no AI and no guessing. It needs an old enough Python too, because old package versions
 * have no builds for new ones.
 */

const VENV = "/work/.pydeps";
const BACKUP = `${VENV}.bak`;
const SCANNER = "../.rerun_scan_imports.py";
const INSTALL_TIMEOUT_MS = 15 * 60_000;

/** A Python that was current on that date, so that date's packages have builds for it. */
export function pythonForDate(iso: string): string {
  const year = new Date(iso).getUTCFullYear() + new Date(iso).getUTCMonth() / 12;
  if (year < 2021.75) return "3.8";
  if (year < 2022.75) return "3.9";
  if (year < 2023.75) return "3.10";
  return "3.11";
}

/** Where an import's name differs from its package's name. */
const IMPORT_NAMES: [string, string][] = [
  ["sklearn", "scikit-learn"],
  ["skimage", "scikit-image"],
  ["PIL", "pillow"],
  ["cv2", "opencv-python-headless"],
  ["yaml", "pyyaml"],
  ["Bio", "biopython"],
  ["bs4", "beautifulsoup4"],
];

/** Runs inside the sandbox. It parses the repository's files, and never imports or runs them. */
const SCAN_SCRIPT = `import ast, os, sys
names = dict(${JSON.stringify(IMPORT_NAMES)})
found, local = set(), set()
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if not d.startswith(".")]
    local.update(dirs)
    for f in files:
        if f.endswith(".py"):
            local.add(f[:-3])
            try:
                tree = ast.parse(open(os.path.join(root, f), encoding="utf8", errors="ignore").read())
            except SyntaxError:
                continue
            for n in ast.walk(tree):
                if isinstance(n, ast.Import):
                    found.update(a.name.split(".")[0] for a in n.names)
                elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                    found.add(n.module.split(".")[0])
for name in sorted(found - local - set(sys.stdlib_module_names)):
    print(names.get(name, name))
`;

export function dateInstallCommand(date: string, python: string): string {
  return [
    `rm -rf ${BACKUP}; [ -d ${VENV} ] && mv ${VENV} ${BACKUP}`,
    `uv venv --seed --python ${python} ${VENV} && uv pip install --python ${VENV}/bin/python --exclude-newer ${date} --only-binary :all: -r requirements.txt`,
  ].join("; ");
}

export function reinstallCommand(date: string): string {
  return `uv pip install --python ${VENV}/bin/python --exclude-newer ${date} --only-binary :all: -r requirements.txt`;
}

export interface DateInstallResult {
  ok: boolean;
  tail: string;
  patch?: AppliedPatch;
  /** How to install again after the package list changes. */
  installCommand?: string;
}

/** Packages that ship with R, which never need installing. */
const R_BUILT_IN = new Set(["base", "stats", "utils", "methods", "graphics", "grDevices", "datasets", "tools", "parallel", "compiler", "grid", "splines", "stats4", "tcltk", "MASS", "Matrix", "lattice", "mgcv", "nlme", "survival", "boot", "class", "cluster", "codetools", "foreign", "KernSmooth", "nnet", "rpart", "spatial"]);

/** The R packages a repository's code loads, read from its text. */
export function rPackagesIn(sources: string[]): string[] {
  const found = new Set<string>();
  for (const text of sources) {
    for (const line of text.split("\n")) {
      const code = line.replace(/#.*$/, "");
      for (const m of code.matchAll(/\b(?:library|require|requireNamespace)\(\s*["']?([A-Za-z][\w.]*)/g)) found.add(m[1]!);
      for (const m of code.matchAll(/\b([A-Za-z][\w.]*):::?[A-Za-z.]/g)) found.add(m[1]!);
    }
  }
  return [...found].filter((p) => !R_BUILT_IN.has(p)).sort();
}

/** R has no uv, but Posit keeps a dated copy of all of CRAN, which gives the same result. */
async function dateInstallR(date: string, sandbox: Sandbox): Promise<DateInstallResult> {
  const files = (await sandbox.listFiles(500)).filter((f) => /\.(r|rmd)$/i.test(f));
  const sources = await Promise.all(files.map(async (f) => (await sandbox.readFile(f, 1024 * 1024))?.toString("utf8") ?? ""));
  const packages = rPackagesIn(sources);
  if (packages.length === 0) return { ok: false, tail: "found no R packages to install" };
  const day = date.slice(0, 10);
  const list = packages.map((p) => `'${p}'`).join(",");
  const lib = "/work/.rlib";
  const command = `mkdir -p ${lib} && Rscript --vanilla -e "p <- c(${list}); install.packages(p, lib='${lib}', repos='https://packagemanager.posit.co/cran/${day}', Ncpus=2); stopifnot(all(p %in% rownames(installed.packages(c('${lib}', .libPaths())))))"`;
  const result = await sandbox.exec(command, { network: true, timeoutMs: INSTALL_TIMEOUT_MS });
  if (result.exitCode !== 0 || result.timedOut) return { ok: false, tail: result.tail };
  const justification = `Installed the R packages as they were on ${day}, the date of the commit, from a dated copy of CRAN.`;
  const diff = `--- packages [DEPENDENCY by system] ${justification}\n+ repos = packagemanager.posit.co/cran/${day}\n${packages.map((p) => `+ ${p}`).join("\n")}\n`;
  return {
    ok: true,
    tail: result.tail,
    installCommand: command,
    patch: { file: "packages", kind: "DEPENDENCY", by: "system", diff, diffHash: createHash("sha256").update(diff).digest("hex"), justification },
  };
}

export async function dateInstall(spec: ClaimSpec, sandbox: Sandbox): Promise<DateInstallResult> {
  const log = await sandbox.exec("git log -1 --format=%cI", { network: false, timeoutMs: 60_000 });
  const when = new Date(log.log.trim());
  if (log.exitCode !== 0 || Number.isNaN(when.getTime())) return { ok: false, tail: "couldn't read the commit date" };
  const date = when.toISOString().replace(/\.\d+Z$/, "Z");
  if (spec.artifact.runtime === "r4.4") return dateInstallR(date, sandbox);
  const python = pythonForDate(date);

  // A repository with no package list gets one from what its code imports.
  const existing = (await sandbox.readFile("requirements.txt", 1024 * 1024))?.toString("utf8") ?? null;
  const created = existing === null;
  let listed = existing ?? "";
  if (created) {
    await sandbox.writeFile(SCANNER, Buffer.from(SCAN_SCRIPT));
    const scan = await sandbox.exec(`python ${SCANNER}`, { network: false, timeoutMs: 120_000 });
    const packages = scan.log.split("\n").map((l) => l.trim()).filter(Boolean);
    if (scan.exitCode !== 0 || packages.length === 0) return { ok: false, tail: scan.tail || "found no packages to install" };
    listed = `${packages.join("\n")}\n`;
    await sandbox.writeFile("requirements.txt", Buffer.from(listed));
  }

  const command = dateInstallCommand(date, python);
  const result = await sandbox.exec(command, { network: true, timeoutMs: INSTALL_TIMEOUT_MS });
  if (result.exitCode !== 0 || result.timedOut) {
    await sandbox.exec(`rm -rf ${VENV}; [ -d ${BACKUP} ] && mv ${BACKUP} ${VENV}; true`, { network: false, timeoutMs: 60_000 });
    return { ok: false, tail: result.tail };
  }

  const justification = `Installed the packages as they were on ${date.slice(0, 10)}, the date of the commit, on Python ${python}${created ? ", from the imports in the code, because the repository lists none" : ""}.`;
  const diff = `--- requirements.txt [DEPENDENCY by system] ${justification}\n+ uv pip install --exclude-newer ${date} -r requirements.txt\n${listed
    .trim()
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n")}\n`;
  return {
    ok: true,
    tail: result.tail,
    installCommand: reinstallCommand(date),
    patch: { file: "requirements.txt", kind: "DEPENDENCY", by: "system", diff, diffHash: createHash("sha256").update(diff).digest("hex"), justification },
  };
}
