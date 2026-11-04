/**
 * Writes real Lab output as test vectors for the contract, so TypeScript and Rust are checked
 * against the same bytes: contracts/rerun/src/tests.rs replays each one through the contract.
 *
 *   MOCK_LLM=1 pnpm lab:run all && pnpm --filter @rerun/orchestrator export:vectors
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateLabKeyPair, specHash, specJson } from "@rerun/shared";
import { DEMO_NAMES, loadDemo } from "../src/demo/fixtures.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../.data");
const OUT = path.resolve(import.meta.dirname, "../../../contracts/rerun/test-vectors/lab-output.json");

const keys = generateLabKeyPair();
const vectors = DEMO_NAMES.map((name) => {
  const { spec } = loadDemo(name, keys);
  const receipt = JSON.parse(readFileSync(path.join(DATA_DIR, "receipts", `${name}-run0.json`), "utf8"));
  return { name, spec_json: specJson(spec), spec_hash: specHash(spec), receipt };
});
writeFileSync(OUT, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${vectors.length} vectors to ${OUT}`);
