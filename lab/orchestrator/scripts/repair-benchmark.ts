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
const TARGET_PAPERS = 8;
const MATCH_MARGIN = "0.005"; // relative
const MAX_MINUTES = 15;

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
}

const modelId = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";

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
    { sandbox: new DockerSandbox(limits as never), model: new NearAiModel(llm, modelId), resolver: new NetworkResolver(), dateInstall, emit },
  );
}

async function benchmark(name: string, c: Case): Promise<Row> {
  const row: Row = { name, title: c.title, paper: c.paper, result: "no_baseline", baseline: null, measured: null, ai_patches: 0, blocked_edits: 0, cost_usd: 0, detail: "" };
  const log = (e: StageEvent) => console.log(`  [${e.stage}] ${e.message.slice(0, 200)}`);
  const llm = new LlmClient(llmConfigFromEnv());

  console.log(`\n=== ${name}: baseline, packages as of the commit date`);
  // `false` makes the normal setup fail at once, so the date-pinned step runs straight away.
  const base = await runOnce(specFor(c, ["false"], "0", { type: "abs", value: "1000000" }), true, llm, log).catch((e: Error) => e);
  if (base instanceof Error || base.receipt.measured_value === null) {
    row.detail = base instanceof Error ? base.message : `No number under the old packages (${base.receipt.outcome}).`;
    return row;
  }
  row.baseline = base.receipt.measured_value;
  const aiInBaseline = base.receipt.patches_diff_excerpt.includes("by ai]");
  if (aiInBaseline) {
    row.detail = "The baseline itself needed AI help, so it can't serve as a clean reference.";
    return row;
  }

  console.log(`=== ${name}: broken, today's packages, AI repair (target ${row.baseline})`);
  let repairEvents = 0;
  const broken = await runOnce(
    specFor(c, [`pip install ${c.packages.join(" ")}`], row.baseline, { type: "rel", value: MATCH_MARGIN }),
    false,
    llm,
    (e) => {
      if (e.stage === "repairing") repairEvents++;
      log(e);
    },
  ).catch((e: Error) => e);
  row.cost_usd = llm.spentThisRun;
  if (broken instanceof Error) {
    row.result = "no_verdict";
    row.detail = broken.message.slice(0, 200);
    return row;
  }
  const r = broken.receipt;
  row.measured = r.measured_value;
  row.ai_patches = r.patches.length;
  row.blocked_edits = broken.rejectedEdits.length;
  if (repairEvents === 0 && r.outcome === "REPRODUCED") {
    row.result = "not_broken";
    row.detail = "It still runs on today's packages, so it doesn't test repair.";
  } else if (r.outcome === "REPRODUCED") {
    row.result = "repaired";
    row.detail = `Repaired with ${r.patches.length} change(s). The number matches the baseline.`;
  } else {
    row.result = "failed";
    row.detail = `${r.outcome}${r.invalid_reason ? ` (${r.invalid_reason})` : ""}, measured ${r.measured_value ?? "nothing"}.`;
  }
  return row;
}

function write(rows: Row[]) {
  const counted = rows.filter((r) => r.result === "repaired" || r.result === "failed");
  const repaired = rows.filter((r) => r.result === "repaired").length;
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
    const row = await benchmark(name, JSON.parse(readFileSync(path.join(CASES, `${name}.json`), "utf8")) as Case);
    rows.set(name, row);
    console.log(`--> ${name}: ${row.result}. ${row.detail}`);
    write([...rows.values()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
