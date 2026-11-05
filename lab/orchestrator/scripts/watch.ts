/**
 * Runs the Lab against testnet: `pnpm lab:watch`. Polls the contract, processes one market at a
 * time, and serves live run streams, reports and attestation records over HTTP.
 */
import path from "node:path";
import { LlmClient, llmConfigFromEnv } from "../src/nearai/client.ts";
import { NearAiModel } from "../src/pipeline/model.ts";
import { demoForSpec } from "../src/demo/fixtures.ts";
import { labPublicUrl, need, testnetChain, testnetWorker } from "../src/lab/setup.ts";
import { verifyMessage } from "near-api-js/nep413";
import { NOTES_RECIPIENT, NotesStore } from "../src/lab/notes.ts";
import { startLabServer } from "../src/lab/server.ts";
import { RollingDemos, type RollingMarket } from "../src/lab/rolling.ts";
import { loadDemo } from "../src/demo/fixtures.ts";
import { specJson } from "@rerun/shared";
import { createQueue, EventHub, LabResolver, saveAttestation } from "../src/lab/store.ts";
import { allLeads, draftWithModel, githubRepoFacts, loadScoutState, paperAttention, runScout, saveScoutState } from "../src/scout/scout.ts";

const POLL_MS = 5_000;
const ATTEST_EVERY_MS = 6 * 3600_000;
const SCOUT_EVERY_MS = Number(process.env.SCOUT_INTERVAL_HOURS || 6) * 3600_000;
const DATA_DIR = path.resolve(import.meta.dirname, "../.data");

testnetChain(); // loads the environment
const port = Number(process.env.LAB_PORT || 8787);
const hub = new EventHub();
const exclusive = createQueue();
const modelId = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";
const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };
const network = new LabResolver();
const chain = testnetChain();

/** Off by default, because it signs transactions with the owner's key: ROLLING_DEMOS=1 turns it on. */
const rolling =
  process.env.ROLLING_DEMOS === "1"
    ? (() => {
        const owner = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
        return new RollingDemos(
          {
            list: async () => {
              const lists = await Promise.all(["Open", "Proposed"].map((state) => chain.view<RollingMarket[]>("list_markets", { state, limit: 100 })));
              return lists.flat();
            },
            post: async (name, lockTime) => {
              const created = await chain.call(owner, "create_market", { spec_json: specJson(loadDemo(name, labKeys).spec), lock_time: lockTime, challenge_window: 60, mode: "points" }, { deposit: "0.1" });
              const id = Number(created.value);
              await chain.call(owner, "fund_market", { market_id: id, initial_liquidity: "40000000" }, { deposit: "0.02" });
              return id;
            },
            finalize: async (id) => void (await chain.call(owner, "finalize", { market_id: id })),
            log: (m) => console.log(m),
          },
          { windowSecs: Number(process.env.ROLLING_WINDOW_SECS || 300), everySecs: Number(process.env.ROLLING_EVERY_MINUTES || 60) * 60, maxPerDay: Number(process.env.ROLLING_MAX_PER_DAY || 48) },
        );
      })()
    : undefined;

startLabServer(port, {
  hub,
  tryDemo: rolling && (() => rolling.tryNow()),
  scoutDir: DATA_DIR,
  notes: new NotesStore(DATA_DIR, {
    verify: (accountId, publicKey, message, nonce, signature) => verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message, recipient: NOTES_RECIPIENT, nonce }, signature, provider: chain.provider }),
    creatorOf: async (market) => (await chain.view<{ creator: string } | null>("get_market", { market_id: market }))?.creator ?? null,
  }),
  verifyScoutApproval: async (marketId, candidate) => {
    const [market, raw, config] = await Promise.all([
      chain.view<{ creator: string } | null>("get_market", { market_id: marketId }),
      chain.view<string | null>("get_spec", { market_id: marketId }),
      chain.view<{ owner: string }>("get_config"),
    ]);
    if (!market || !raw || market.creator !== config.owner) return false;
    const spec = JSON.parse(raw) as { artifact?: { repo_url?: string; commit?: string } };
    return spec.artifact?.repo_url === candidate.draft?.repo_url && spec.artifact?.commit === candidate.draft?.commit;
  },
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

/** Looks for new research to suggest. A failed scan just waits for the next one. */
async function scoutNow() {
  const llm = new LlmClient(llmConfigFromEnv());
  llm.newRun();
  const state = await runScout(loadScoutState(DATA_DIR), { leads: allLeads, repoFacts: githubRepoFacts, draft: draftWithModel(new NearAiModel(llm, modelId)), attention: paperAttention, log: (m) => console.log(m) });
  saveScoutState(DATA_DIR, state);
}
scoutNow().catch((e: Error) => console.error(`scout failed: ${e.message}`));
setInterval(() => scoutNow().catch((e: Error) => console.error(`scout failed: ${e.message}`)), SCOUT_EVERY_MS);

if (rolling) {
  const roll = () => rolling.tick().catch((e: Error) => console.error(`demo claims: ${e.message}`));
  void roll();
  setInterval(roll, 60_000);
}

console.log(`Lab watching testnet, serving on http://localhost:${port}. Ctrl+C to stop.`);
while (true) {
  await worker.tick().catch((e: Error) => console.error(`tick failed: ${e.message}`));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
