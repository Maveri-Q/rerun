import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { specHash, type ClaimSpec } from "@rerun/shared";
import { Chain } from "../chain/near.ts";
import { demoForSpec } from "../demo/fixtures.ts";
import { loadEnv } from "../env.ts";
import { llmConfigFromEnv } from "../nearai/client.ts";
import { LabResolver, readMethods } from "./store.ts";
import { LabWorker } from "./worker.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../../.data");

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run \`pnpm testnet:accounts\` and \`pnpm deploy\` first.`);
  return v;
}

export function labPublicUrl(): string {
  return (process.env.LAB_PUBLIC_URL || "http://localhost:8787").replace(/\/$/, "");
}

export function testnetChain(): Chain {
  loadEnv();
  return new Chain(process.env.NEAR_TESTNET_RPC_URL || "https://test.rpc.fastnear.com", need("TESTNET_CONTRACT_ACCOUNT"));
}

export async function storeRunFile(kind: "log" | "report" | "evidence", hash: string, content: string): Promise<string> {
  const dir = path.join(DATA_DIR, `${kind}s`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, hash), content);
  return `${labPublicUrl()}/${kind}s/${hash}`;
}

/** A Lab worker for testnet, from the environment. Demo claims resolve to local fixtures. */
export function testnetWorker(hooks: Pick<ConstructorParameters<typeof LabWorker>[0], "onEvent" | "log" | "onAttestation" | "exclusive"> = {}): LabWorker {
  const chain = testnetChain();
  const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };
  const network = new LabResolver();
  return new LabWorker({
    chain,
    lab: chain.account(need("TESTNET_LAB_ACCOUNT"), need("TESTNET_LAB_PRIVATE_KEY")),
    labCodehash: need("LAB_CODEHASH"),
    labKeys,
    modelId: process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash",
    rerunModelId: process.env.NEARAI_RERUN_MODEL || "Qwen/Qwen3.8-27B",
    llm: llmConfigFromEnv(),
    resolverFor: (spec: ClaimSpec) => demoForSpec(spec, labKeys)?.resolver ?? network,
    mockResponderFor: (spec: ClaimSpec) => demoForSpec(spec, labKeys)?.mockResponder,
    store: storeRunFile,
    methodsFor: (spec: ClaimSpec) => demoForSpec(spec, labKeys)?.methods ?? readMethods(specHash(spec)),
    ...hooks,
  });
}
