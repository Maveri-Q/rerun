/**
 * Measures AI repair honestly: `pnpm repair-benchmark [names]`.
 *
 * For each paper in claims/benchmark:
 *   1. Baseline: install packages as of the commit date, with no AI. If that doesn't produce a
 *      number, the paper can't be in the benchmark.
 *   2. Broken: install today's newest packages with the date step turned off. If it still runs, the
 *      paper wasn't broken, so it says nothing about repair and doesn't count.
 *   3. Repair: the real private AI gets its usual tries. It only counts as a success if the number
 *      matches the baseline.
 *
 * Writes web/lib/repair-benchmark.json, shown on the Lab page, and docs/REPAIR_BENCHMARK.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ClaimSpec } from "@rerun/shared";
import { loadEnv } from "../src/env.ts";
import { LlmClient, llmConfigFromEnv } from "../src/nearai/client.ts";
import { NearAiModel } from "../src/pipeline/model.ts";
import { MAX_REPAIR_ATTEMPTS, reproduce, type StageEvent } from "../src/pipeline/pipeline.ts";
import { NetworkResolver } from "../src/pipeline/resolver.ts";
import { DockerSandbox, sandboxImage } from "../src/sandbox/docker.ts";

loadEnv();

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CASES = path.join(ROOT, "claims/benchmark");
const JSON_OUT = path.join(ROOT, "web/lib/repair-benchmark.json");
const DOC_OUT = path.join(ROOT, "docs/REPAIR_BENCHMARK.md");
const TARGET_PAPERS = 5;
const MATCH_MARGIN = "0.005"; // relative
const MAX_MINUTES = 15;
/** Per paper, per run. A paper that takes longer counts as failed. */
const PAPER_TIMEOUT_MS = 15 * 60_000;
/** The final score averages this many runs of each paper, because the AI's replies vary. */
const RUNS_PER_PAPER = 2;

interface Case {
  title: string;
  paper: string;
  repo_url: string;
  commit: string;
  license: string;
  runtime: "python3.11" | "r4.4";
  packages: string[];
  entrypoint: string;
  output_path: string;
  extractor: string;
  /** A posted claim still open for forecasts can't be run before this time, because the result would be public. */
  not_before?: string;
}

type Result = "repaired" | "failed" | "not_broken" | "no_baseline" | "no_verdict";

interface Row {
  name: string;
  title: string;
  paper: string;
  result: Result;
  baseline: string | null;
  measured: string | null;
  ai_patches: number;
  blocked_edits: number;
  cost_usd: number;
  detail: string;
  /** Each repair run's result. `result` is the first run's; the score uses all of them. */
  runs?: Result[];
}

const NETWORK_TRIES = 3;
const modelId = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";

/** Today's newest packages, with no date limit. */
function todaySetup(c: Case): string[] {
  if (c.packages.length === 0) return [];
  if (c.runtime === "python3.11") return [`pip install ${c.packages.join(" ")}`];
  const list = c.packages.map((p) => `'${p}'`).join(",");
  return ["mkdir -p /work/.rlib", `Rscript --vanilla -e "install.packages(c(${list}), lib='/work/.rlib', repos='https://cloud.r-project.org')"`];
}

function specFor(c: Case, setup: string[], reported: string, margin: { type: "abs" | "rel"; value: string }): ClaimSpec {
  return ClaimSpec.parse({
    version: 1,
    title: `[TEST] Repair benchmark: ${c.title}`.slice(0, 120),
    statement: "A local repair benchmark run. Never posted.",
    source: { type: "paper", url: c.paper, license: c.license, authors: "See the paper" },
    artifact: { repo_url: c.repo_url, commit: c.commit, data: [], runtime: c.runtime, setup, entrypoint: c.entrypoint, output: { path: c.output_path, extractor: { type: "regex", expr: c.extractor } } },
    metric: { name: "benchmark value", reported_value: reported, tolerance: margin, comparison: "within_tolerance" },
    resources: { cpu: 2, mem_gb: 4, max_minutes: MAX_MINUTES },
    private_data: null,
  });
}

async function runOnce(spec: ClaimSpec, dateInstall: boolean, llm: LlmClient, emit: (e: StageEvent) => void) {
  llm.newRun();
  const limits = { image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb };
  return reproduce(
    { spec, marketId: 0, runIndex: 0, labAccount: "benchmark.testnet", labCodehash: "0".repeat(64) },
    { sandbox: new DockerSandbox(limits as never), model: new NearAiModel(llm, modelId), resolver: new NetworkResolver(), dateInstall, skipStressTests: true, emit },
  );
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${PAPER_TIMEOUT_MS / 60_000} minutes`)), PAPER_TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function benchmark(name: string, c: Case): Promise<Row> {
  const row: Row = { name, title: c.title, paper: c.paper, result: "no_baseline", baseline: null, measured: null, ai_patches: 0, blocked_edits: 0, cost_usd: 0, detail: "" };
  const log = (e: StageEvent) => console.log(`  [${e.stage}] ${e.message.slice(0, 200)}`);
  const llm = new LlmClient(llmConfigFromEnv());

  console.log(`\n=== ${name}: baseline, packages as of the commit date`);
  // `false` makes the normal setup fail at once, so the date-pinned step runs straight away.
  const base = await withTimeout(runOnce(specFor(c, ["false"], "0", { type: "abs", value: "1000000" }), true, llm, log)).catch((e: Error) => e);
  if (base instanceof Error || base.receipt.measured_value === null) {
    row.detail = base instanceof Error ? base.message : `No number under the old packages (${base.receipt.outcome}).`;
    // A network or attestation failure says nothing about the paper, unlike running out of time.
    if (base instanceof Error && !/timed out after/.test(base.message)) row.result = "no_verdict";
    return row;
  }
  row.baseline = base.receipt.measured_value;
  const aiInBaseline = base.receipt.patches_diff_excerpt.includes("by ai]");
  if (aiInBaseline) {
    row.detail = "The baseline itself needed AI help, so it can't serve as a clean reference.";
    return row;
  }

  const runs: Result[] = [];
  let totalCost = 0;
  let first: Row | null = null;
  for (let i = 0; i < RUNS_PER_PAPER; i++) {
    let attempt: Row = { ...row };
    // A network failure says nothing about the repair, so that run gets another go.
    for (let tries = 0; tries < NETWORK_TRIES; tries++) {
      attempt = { ...row };
      console.log(`=== ${name}: broken, today's packages, AI repair, run ${i + 1} of ${RUNS_PER_PAPER} (target ${row.baseline})`);
      await repairRun(c, attempt, llm, log);
      totalCost += attempt.cost_usd;
      if (attempt.result !== "no_verdict") break;
      console.log(`    this run couldn't finish: ${attempt.detail}`);
    }
    runs.push(attempt.result);
    if (!first || first.result === "no_verdict") first = attempt;
    // A paper that still runs on today's packages will do so again, so a second run adds nothing.
    if (attempt.result === "not_broken") break;
  }
  const failedRuns = runs.filter((r) => r !== "repaired").length;
  return { ...first!, runs, cost_usd: totalCost, detail: `${first!.detail}${runs.length > 1 ? ` Runs: ${runs.join(", ")}${failedRuns ? "." : ", both matched."}` : ""}` };
}

async function repairRun(c: Case, row: Row, llm: LlmClient, log: (e: StageEvent) => void): Promise<void> {
  let repairEvents = 0;
  const broken = await withTimeout(
    runOnce(
      specFor(c, todaySetup(c), row.baseline!, { type: "rel", value: MATCH_MARGIN }),
      false,
      llm,
      (e) => {
        if (e.stage === "repairing") repairEvents++;
        log(e);
      },
    ),
  ).catch((e: Error) => e);
  row.cost_usd = llm.spentThisRun;
  if (broken instanceof Error) {
    row.result = /timed out/.test(broken.message) ? "failed" : "no_verdict";
    row.detail = broken.message.slice(0, 200);
    return;
  }
  const r = broken.receipt;
  row.measured = r.measured_value;
  row.ai_patches = r.patches.length;
  row.blocked_edits = broken.rejectedEdits.length;
  if (repairEvents === 0 && r.outcome === "REPRODUCED") {
    row.result = "not_broken";
    row.detail = "It still runs on today's packages, so it doesn't test repair.";
  } else if (r.invalid_reason === "DATA_UNAVAILABLE") {
    // The code couldn't be downloaded, so nothing was tried.
    row.result = "no_verdict";
    row.detail = "The code couldn't be downloaded.";
  } else if (r.outcome === "REPRODUCED") {
    row.result = "repaired";
    row.detail = `Repaired with ${r.patches.length} change(s). The number matches the baseline.`;
  } else {
    row.result = "failed";
    row.detail = `${r.outcome}${r.invalid_reason ? ` (${r.invalid_reason})` : ""}, measured ${r.measured_value ?? "nothing"}.`;
  }
}

function write(rows: Row[]) {
  const counted = rows.filter((r) => (r.runs ?? [r.result]).some((x) => x === "repaired" || x === "failed"));
  // The average across a paper's runs, so 1 of 2 runs counts as half a paper.
  const repaired = counted.reduce((sum, r) => {
    const runs = (r.runs ?? [r.result]).filter((x) => x === "repaired" || x === "failed");
    return sum + runs.filter((x) => x === "repaired").length / runs.length;
  }, 0);
  const summary = { generated_at: new Date().toISOString(), model: modelId, max_attempts: MAX_REPAIR_ATTEMPTS, target_papers: TARGET_PAPERS, papers_counted: counted.length, repaired, complete: counted.length >= TARGET_PAPERS, rows };
  writeFileSync(JSON_OUT, `${JSON.stringify(summary, null, 2)}\n`);
  const table = rows.map((r) => `| ${r.title} | ${r.result} | ${r.baseline ?? "-"} | ${r.measured ?? "-"} | ${r.ai_patches} | ${r.blocked_edits} | $${r.cost_usd.toFixed(4)} | ${r.detail.replaceAll("|", " ")} |`).join("\n");
  writeFileSync(
    DOC_OUT,
    `# Repair benchmark

Generated by \`pnpm repair-benchmark\`. Do not edit by hand.

**${summary.complete ? `AI repair fixed ${repaired} of ${counted.length} real papers.` : `Not finished: ${counted.length} of ${TARGET_PAPERS} papers so far, so this proves nothing yet about AI repair (${repaired} of ${counted.length} repaired).`}**

Each paper is first run with its packages as of the commit date, using no AI, to get a reference number. It is then broken on purpose by installing today's newest packages, and the real private AI (${modelId}) gets up to ${MAX_REPAIR_ATTEMPTS} tries. A repair only counts if the number matches the reference within ${Number(MATCH_MARGIN) * 100}%. Papers that still run on today's packages aren't counted, because they don't test repair.

| Paper | Result | Reference | After repair | Changes | Edits blocked | AI cost | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- |
${table}
`,
  );
  console.log(`\n${repaired} of ${counted.length} counted papers repaired (target ${TARGET_PAPERS} papers).`);
}

async function main() {
  const wanted = process.argv.slice(2);
  const names = readdirSync(CASES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => !wanted.length || wanted.includes(n));
  // Keep earlier results when only some papers are re-run.
  const previous: Row[] = existsSync(JSON_OUT) ? (JSON.parse(readFileSync(JSON_OUT, "utf8")) as { rows: Row[] }).rows : [];
  const rows = new Map(previous.map((r) => [r.name, r]));
  mkdirSync(path.dirname(DOC_OUT), { recursive: true });
  for (const name of names) {
    const c = JSON.parse(readFileSync(path.join(CASES, `${name}.json`), "utf8")) as Case;
    if (c.not_before && Date.now() < Date.parse(c.not_before)) {
      console.log(`--> ${name}: skipped. Forecasting on this claim is open until ${c.not_before}.`);
      continue;
    }
    const row = await benchmark(name, c);
    console.log(`--> ${name}: ${row.result}. ${row.detail}`);
    if (row.result === "no_verdict" && rows.has(name)) {
      console.log(`    keeping the earlier result for ${name}, because this run couldn't finish`);
      continue;
    }
    rows.set(name, row);
    write([...rows.values()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
