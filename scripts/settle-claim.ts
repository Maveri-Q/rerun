/**
 * Posts a claim as an already-settled showcase: no forecasting, because the result is known. It opens
 * with the shortest window, the Lab runs it once, and it's finalized. Rule: this is only for showcase
 * claims. Never run an open claim before its forecasting closes.
 *
 *   pnpm settle-claim parkinsons-authors
 */
import { specHash, specJson } from "@rerun/shared";
import { loadReal } from "../lab/orchestrator/src/demo/real.ts";
import { need, testnetChain, testnetWorker } from "../lab/orchestrator/src/lab/setup.ts";
import { saveAttestation } from "../lab/orchestrator/src/lab/store.ts";

const LOCK_AFTER_SECS = 120;
const CHALLENGE_SECS = 60;
const LIQUIDITY = 10_000_000n; // the contract's minimum, since nobody forecasts on this

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("Say which claim: pnpm settle-claim parkinsons-authors");
  const chain = testnetChain();
  const owner = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
  const { spec } = loadReal(name);
  const hash = specHash(spec);

  const existing = await chain.view<{ id: number; state: string; spec: { spec_hash: string } }[]>("list_markets", { limit: 200 });
  let market = existing.find((m) => m.spec.spec_hash === hash);
  if (!market) {
    const created = await chain.call(owner, "create_market", { spec_json: specJson(spec), lock_time: Math.floor(Date.now() / 1000) + LOCK_AFTER_SECS, challenge_window: CHALLENGE_SECS, mode: "points" }, { deposit: "0.1" });
    const id = Number(created.value);
    await chain.call(owner, "fund_market", { market_id: id, initial_liquidity: String(LIQUIDITY) }, { deposit: "0.02" });
    console.log(`claim ${id} posted. Waiting ${LOCK_AFTER_SECS}s for it to lock.`);
    await wait((LOCK_AFTER_SECS + 15) * 1000);
    market = { id, state: "Open", spec: { spec_hash: hash } };
  }
  const id = market.id;
  if (market.state === "Open" || market.state === "Locked") {
    const worker = testnetWorker({ log: (m) => console.log(m), onEvent: (_, e) => console.log(`  [${e.stage}] ${e.message.slice(0, 170)}`), onAttestation: saveAttestation });
    const receipt = await worker.runOne(id);
    console.log(`result: ${receipt.outcome}, measured ${receipt.measured_value}`);
    await wait((CHALLENGE_SECS + 15) * 1000);
  }
  await chain.call(owner, "finalize", { market_id: id });
  const m = await chain.view<{ state: string; outcome: string }>("get_market", { market_id: id });
  console.log(`claim ${id}: ${m.state}, ${m.outcome}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
