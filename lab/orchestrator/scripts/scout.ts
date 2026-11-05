/**
 * Runs the scout agent once: `pnpm scout`. It reads public metadata and drafts claims with the
 * private AI for a person to review at /scout. It never runs anyone's code or posts anything.
 * `pnpm lab:watch` also runs it on a schedule.
 */
import path from "node:path";
import { loadEnv } from "../src/env.ts";
import { LlmClient, llmConfigFromEnv } from "../src/nearai/client.ts";
import { NearAiModel } from "../src/pipeline/model.ts";
import { allLeads, draftWithModel, githubRepoFacts, loadScoutState, paperAttention, runScout, saveScoutState } from "../src/scout/scout.ts";

loadEnv();

const DATA_DIR = path.resolve(import.meta.dirname, "../.data");
const modelId = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";

const llm = new LlmClient(llmConfigFromEnv());
llm.newRun();
const model = new NearAiModel(llm, modelId);

const state = await runScout(loadScoutState(DATA_DIR), {
  leads: allLeads,
  repoFacts: githubRepoFacts,
  draft: draftWithModel(model),
  attention: paperAttention,
  log: (m) => console.log(m),
});
saveScoutState(DATA_DIR, state);

const all = Object.values(state.candidates);
const count = (status: string) => all.filter((c) => c.status === status).length;
console.log(`\nwaiting for review: ${count("pending")}, turned down: ${count("rejected")}, to try again: ${count("retry")}`);
