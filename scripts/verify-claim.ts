/**
 * Reruns a claim on your own computer and compares it with the receipt on NEAR, so you don't have
 * to trust the Lab or its secure hardware. Reads the chain only: no wallet, no keys, no spending.
 * It needs Docker and `pnpm sandbox:build`. The AI step is scripted here, so a claim that needs AI
 * repair stops instead of guessing.
 *
 *   pnpm verify-claim <claim id>
 */
import { JsonRpcProvider } from "near-api-js";
import { ClaimSpec, withinTolerance, parseDecimal } from "@rerun/shared";
import { humanPatchesFor, isIndependentRebuild } from "../lab/orchestrator/src/demo/real.ts";
import { LlmClient, llmConfigFromEnv } from "../lab/orchestrator/src/nearai/client.ts";
import { NearAiModel } from "../lab/orchestrator/src/pipeline/model.ts";
import { reproduce } from "../lab/orchestrator/src/pipeline/pipeline.ts";
import { NetworkResolver } from "../lab/orchestrator/src/pipeline/resolver.ts";
import { DockerSandbox, sandboxImage } from "../lab/orchestrator/src/sandbox/docker.ts";

const RPC = process.env.NEAR_TESTNET_RPC_URL || "https://test.rpc.fastnear.com";
const CONTRACT = process.env.TESTNET_CONTRACT_ACCOUNT || "rerun.rerun-43f5f2.testnet";

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id)) throw new Error("Say which claim: pnpm verify-claim 20");
  const provider = new JsonRpcProvider({ url: RPC });
  const view = <T>(method: string, args: Record<string, unknown>) => provider.callFunction<never>({ contractId: CONTRACT, method, args }) as Promise<T>;
  const raw = await view<string | null>("get_spec", { market_id: id });
  if (!raw) throw new Error(`There is no claim ${id} on ${CONTRACT}.`);
  const spec = ClaimSpec.parse(JSON.parse(raw));
  const onChain = (await view<{ measured_value: string | null; outcome: string }[]>("get_receipts", { market_id: id })).at(-1);
  console.log(`Claim ${id}: ${spec.title}\nCode: ${spec.artifact.repo_url} at ${spec.artifact.commit}\n`);

  const llm = new LlmClient({ ...llmConfigFromEnv(), mock: true });
  llm.newRun();
  const limits = { image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb };
  const { receipt } = await reproduce(
    { spec, marketId: id, runIndex: 0, labAccount: "verify.local", labCodehash: "0".repeat(64), humanPatches: humanPatchesFor(spec), independentRebuild: isIndependentRebuild(spec) },
    { sandbox: new DockerSandbox(limits as never), model: new NearAiModel(llm, "local-verify"), resolver: new NetworkResolver(), dateInstall: true, emit: (e) => console.log(`  [${e.stage}] ${e.message.slice(0, 160)}`) },
  );

  console.log(`\nPaper says:     ${spec.metric.reported_value}`);
  console.log(`You got:        ${receipt.measured_value ?? "no number"}`);
  console.log(`Your result:    ${receipt.outcome}`);
  if (onChain) {
    console.log(`Receipt says:   ${onChain.measured_value ?? "no number"} (${onChain.outcome})`);
    const same = onChain.outcome === receipt.outcome && (onChain.measured_value === receipt.measured_value || (onChain.measured_value !== null && receipt.measured_value !== null && withinTolerance(parseDecimal(receipt.measured_value), parseDecimal(onChain.measured_value), "rel", parseDecimal("0.001"))));
    console.log(same ? "\nYour run agrees with the receipt." : "\nYour run DISAGREES with the receipt. You can challenge it on the claim's page.");
    if (!same) process.exitCode = 1;
  } else {
    console.log("There's no receipt on NEAR yet, so there's nothing to compare with.");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
