/**
 * Runs the Lab against testnet: `pnpm lab:watch`. Polls the contract, processes one market at a
 * time, and serves live run streams, reports and attestation records over HTTP.
 */
import { LlmClient, llmConfigFromEnv } from "../src/nearai/client.ts";
import { NearAiModel } from "../src/pipeline/model.ts";
import { demoForSpec } from "../src/demo/fixtures.ts";
import { labPublicUrl, need, testnetChain, testnetWorker } from "../src/lab/setup.ts";
import { startLabServer } from "../src/lab/server.ts";
import { createQueue, EventHub, LabResolver, saveAttestation } from "../src/lab/store.ts";

const POLL_MS = 5_000;
const ATTEST_EVERY_MS = 6 * 3600_000;

testnetChain(); // loads the environment
const port = Number(process.env.LAB_PORT || 8787);
const hub = new EventHub();
const exclusive = createQueue();
const modelId = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";
const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };
const network = new LabResolver();

startLabServer(port, {
  hub,
  publicUrl: labPublicUrl(),
  exclusive,
  labCodehash: need("LAB_CODEHASH"),
  labAccount: need("TESTNET_LAB_ACCOUNT"),
  modelId,
  dryRunEnabled: process.env.LAB_ENABLE_DRY_RUN === "1",
  resolverFor: (spec) => demoForSpec(spec, labKeys)?.resolver ?? network,
  info: { network: "testnet", account: need("TESTNET_LAB_ACCOUNT"), codehash: need("LAB_CODEHASH"), model: modelId, mock_llm: process.env.MOCK_LLM === "1", tee: false },
});

const worker = testnetWorker({
  exclusive,
  log: (m) => console.log(m),
  onEvent: (id, e) => {
    console.log(`  market ${id} [${e.stage}] ${e.message}`);
    hub.publish(String(id), e);
  },
  onAttestation: saveAttestation,
});

/** Verifies the model's TEE at boot and periodically, so the Lab page always shows a recent report. */
async function attestNow() {
  const llm = new LlmClient(llmConfigFromEnv());
  const model = new NearAiModel(llm, modelId);
  await model.attest();
  saveAttestation(model.attestationDigest(), model.attestationRecord());
  console.log(`attestation verified for ${modelId}`);
}
attestNow().catch((e: Error) => console.error(`attestation failed: ${e.message}`));
setInterval(() => attestNow().catch((e: Error) => console.error(`attestation failed: ${e.message}`)), ATTEST_EVERY_MS);

console.log(`Lab watching testnet, serving on http://localhost:${port}. Ctrl+C to stop.`);
while (true) {
  await worker.tick().catch((e: Error) => console.error(`tick failed: ${e.message}`));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
