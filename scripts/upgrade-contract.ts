/**
 * Replaces the testnet contract's code, keeping its state, then checks nothing changed. Only safe
 * for changes that keep the stored layout, such as adding a value to the end of an enum.
 *
 *   pnpm upgrade-contract:testnet
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const chain = testnetChain();
const contract = chain.account(chain.contractId, need("TESTNET_CONTRACT_PRIVATE_KEY"));
const WASM = path.resolve(import.meta.dirname, "../contracts/target/near/rerun/rerun.wasm");

/** Everything that must read back the same afterwards. */
async function snapshot() {
  const markets = await chain.view<{ id: number }[]>("list_markets", { limit: 200 });
  const details = await Promise.all(
    markets.map(async (m) => ({
      market: await chain.view("get_market", { market_id: m.id }),
      spec: await chain.view("get_spec", { market_id: m.id }),
      receipts: await chain.view("get_receipts", { market_id: m.id }),
      history: await chain.view("get_price_history", { market_id: m.id }),
    })),
  );
  return {
    json: JSON.stringify({ details, config: await chain.view("get_config"), stats: await chain.view("get_stats"), labs: await chain.view("list_labs"), board: await chain.view("get_points_leaderboard", { limit: 50 }) }),
    count: markets.length,
    receipts: details.reduce((n, d) => n + (d.receipts as unknown[]).length, 0),
  };
}

async function main() {
  const before = await snapshot();
  console.log(`before: ${before.count} claims, ${before.receipts} receipts`);
  const code = readFileSync(WASM);
  console.log(`deploying ${Math.round(code.length / 1024)} KB`);
  await contract.deployContract(code);
  const after = await snapshot();
  console.log(`after: ${after.count} claims, ${after.receipts} receipts`);
  if (after.json !== before.json) throw new Error("the contract's stored data reads back differently after the upgrade");
  console.log("every claim, receipt, price history, Lab and balance reads back identically");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
