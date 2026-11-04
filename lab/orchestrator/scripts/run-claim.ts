/**
 * Runs demo claims through the real pipeline in Docker sandboxes, with no chain involved.
 *
 *   MOCK_LLM=1 pnpm lab:run all      # scripted LLM, no credits
 *   pnpm lab:run repairable          # real NEAR AI private model (spends a little credit)
 *   pnpm lab:run reproduces --rerun  # as an independent second run, with the re-run model
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateLabKeyPair, specHash } from "@rerun/shared";
import { DEMO_NAMES, loadDemo, type DemoName } from "../src/demo/fixtures.ts";
import { loadEnv } from "../src/env.ts";
import { LlmClient, llmConfigFromEnv } from "../src/nearai/client.ts";
import { NearAiModel } from "../src/pipeline/model.ts";
import { reproduce } from "../src/pipeline/pipeline.ts";
import { DockerSandbox, sandboxImage } from "../src/sandbox/docker.ts";

loadEnv();

const DATA_DIR = path.resolve(import.meta.dirname, "../.data");
const LOCAL_CODEHASH = "0".repeat(64); // a local Lab has no TEE codehash; real ones come from the CVM image

const args = process.argv.slice(2);
const rerun = args.includes("--rerun");
const wanted = args.filter((a) => !a.startsWith("--"));
const names = (wanted.length === 0 || wanted.includes("all") ? DEMO_NAMES : wanted) as DemoName[];

for (const n of names) {
  if (!DEMO_NAMES.includes(n)) throw new Error(`unknown demo '${n}'; choose from ${DEMO_NAMES.join(", ")} or all`);
}

const config = llmConfigFromEnv();
const modelId = rerun
  ? process.env.NEARAI_RERUN_MODEL || "Qwen/Qwen3.8-27B"
  : process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";
const labKeys =
  process.env.LAB_ENC_PRIVATE_KEY && process.env.LAB_ENC_PUBLIC_KEY
    ? { privateKey: process.env.LAB_ENC_PRIVATE_KEY, publicKey: process.env.LAB_ENC_PUBLIC_KEY }
    : generateLabKeyPair();

async function store(kind: "log" | "report", hash: string, content: string): Promise<string> {
  const dir = path.join(DATA_DIR, `${kind}s`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, hash), content);
  return `${process.env.LAB_PUBLIC_URL || "rerun-lab://local"}/${kind}s/${hash}`;
}

async function main() {
  console.log(`LLM: ${config.mock ? "MOCK (no credits)" : modelId}\n`);
  const results: { name: string; expected: string; outcome: string; measured: string; patches: number; secs: number; ok: boolean }[] = [];

  for (const [i, name] of names.entries()) {
    const demo = loadDemo(name, labKeys);
    console.log(`=== ${name}: ${demo.spec.title}\n    spec_hash ${specHash(demo.spec)}`);
    const llm = new LlmClient(config, demo.mockResponder);
    llm.newRun();
    const { spec } = demo;
    const started = Date.now();
    const { receipt, report, rejectedEdits } = await reproduce(
      { spec, marketId: i, runIndex: rerun ? 1 : 0, labAccount: "local-lab.testnet", labCodehash: LOCAL_CODEHASH, labKeys },
      {
        sandbox: new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb }),
        model: new NearAiModel(llm, modelId),
        resolver: demo.resolver,
        store,
        emit: (e) => {
          console.log(`  [${e.stage}] ${e.message}`);
          if (e.diff) console.log(e.diff.replace(/^/gm, "      "));
        },
      },
    );
    mkdirSync(path.join(DATA_DIR, "receipts"), { recursive: true });
    writeFileSync(path.join(DATA_DIR, "receipts", `${name}-run${receipt.run_index}.json`), JSON.stringify(receipt, null, 2));
    console.log(`  report:\n${report.trim().replace(/^/gm, "    ")}`);
    if (rejectedEdits.length) console.log(`  rejected edits: ${JSON.stringify(rejectedEdits)}`);
    const ok = receipt.outcome === demo.expected && receipt.patches.length === demo.expectedPatches;
    results.push({
      name,
      expected: demo.expected,
      outcome: receipt.outcome,
      measured: receipt.measured_value ?? "-",
      patches: receipt.patches.length,
      secs: Math.round((Date.now() - started) / 1000),
      ok,
    });
    console.log();
  }

  console.table(results);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FAILED: ${failed.map((r) => r.name).join(", ")}` : "ALL PASS");
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
