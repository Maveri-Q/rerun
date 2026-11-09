/**
 * The challenge path on testnet, with real runs: the Lab posts a result, someone challenges it,
 * and the Lab reruns it independently with a different AI model. The runs agree, so the result
 * stands and the challenger loses the deposit. Needs Docker and the owner's accounts.
 *
 *   pnpm challenge-demo
 */
import { generateLabKeyPair } from "@rerun/shared";
import type { Receipt } from "@rerun/shared";
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { loadDemo } from "../lab/orchestrator/src/demo/fixtures.ts";
import { need, testnetChain, testnetWorker } from "../lab/orchestrator/src/lab/setup.ts";
import { EventHub, saveAttestation } from "../lab/orchestrator/src/lab/store.ts";
import { big, ensurePoints, getMarket, openPointsMarket, points, requireLabStopped, Scoreboard, sleep, UNIT } from "./lib/demo-kit.ts";

const LOCK_IN_SECS = 75;
const WINDOW_SECS = 180;

async function main() {
  await requireLabStopped();
  const chain = testnetChain();
  const creator = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
  const challenger = chain.account(need("TESTNET_FT_ACCOUNT"), need("TESTNET_FT_PRIVATE_KEY"));
  const labKeys = process.env.LAB_ENC_PUBLIC_KEY ? { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") } : generateLabKeyPair();
  const board = new Scoreboard();

  console.log("Opening a claim...");
  await ensurePoints(chain, creator);
  await ensurePoints(chain, challenger);
  const id = await openPointsMarket(chain, creator, loadDemo("reproduces", labKeys).spec, LOCK_IN_SECS, WINDOW_SECS);
  console.log(`  market ${id}. Waiting for the lock time...`);
  await sleep((LOCK_IN_SECS + 3) * 1000);

  const hub = new EventHub();
  const worker = testnetWorker({
    onAttestation: saveAttestation,
    log: (m) => console.log(`  ${m}`),
    onEvent: (market, e) => {
      hub.publish(String(market), e);
      if (market === id) console.log(`  market ${market} [${e.stage}] ${e.message}`);
    },
  });

  console.log("\nFirst run:");
  for (let i = 0; i < 4 && (await getMarket(chain, id)).state !== "Proposed"; i++) await worker.tick();
  const proposed = await getMarket(chain, id);
  board.add("The Lab posts its first result", proposed.state === "Proposed", "PASS", proposed.state);

  console.log("\nChallenging it:");
  const challengerBefore = big(await chain.view("get_balance", { account_id: challenger.accountId, mode: "points" }));
  const creatorBeforeChallenge = big(await chain.view("get_balance", { account_id: creator.accountId, mode: "points" }));
  const posted = await chain.call(challenger, "challenge", { market_id: id, reason: "OTHER", note_hash: "c".repeat(64) }, { deposit: "0.02" });
  console.log(`  ${EXPLORER_TX}${posted.txHash}`);
  const challenged = await getMarket(chain, id);
  board.add("A challenge reopens the result", challenged.state === "Challenged", "PASS", challenged.state);
  const challengerAfter = big(await chain.view("get_balance", { account_id: challenger.accountId, mode: "points" }));
  const bond = challengerBefore - challengerAfter;
  console.log(`  deposit ${points(bond)} points`);

  console.log("\nSecond run, with a different AI:");
  for (let i = 0; i < 4 && (await getMarket(chain, id)).state === "Challenged"; i++) await worker.tick();

  const final = await getMarket(chain, id);
  const receipts = await chain.view<Receipt[]>("get_receipts", { market_id: id });
  const [a, b] = receipts;
  console.log("\nResult:");
  board.add("The market settles after the second run", final.state === "Final", "PASS", `${final.state}, ${final.outcome}`);
  board.add("Two receipts are on-chain", receipts.length === 2, "PASS");
  board.add("The second run used a different AI", Boolean(a && b && a.nearai.model_id !== b.nearai.model_id), "PASS", `${a?.nearai.model_id} then ${b?.nearai.model_id}`);
  board.add("Both runs measured independently and agree", a?.outcome === b?.outcome && final.outcome === a?.outcome, "PASS", `${a?.measured_value} and ${b?.measured_value}`);
  const challengerEnd = big(await chain.view("get_balance", { account_id: challenger.accountId, mode: "points" }));
  board.add("The challenger loses the deposit", challengerEnd === challengerAfter, "PASS", `${points(bond)} points`);
  const creatorEnd = big(await chain.view("get_balance", { account_id: creator.accountId, mode: "points" }));
  // The owner is also the treasury on testnet, so here the creator receives the whole deposit and the creation bond.
  board.add("The deposit and creation bond are paid out", creatorEnd - creatorBeforeChallenge === bond + big(final.creation_bond), "PASS");
  const paid = big((await chain.call(creator, "redeem", { market_id: id }, { deposit: "0.01" })).value);
  board.add("Forecasters can still collect", paid > 0n && paid <= 40n * UNIT, "PASS", `${points(paid)} points`);

  console.log(`\nOpen it: http://localhost:3000/receipt/${id}/1`);
  board.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
