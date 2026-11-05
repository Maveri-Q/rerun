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
  // One at a time, because the RPC rate-limits bursts and a failed read looks like a failed upgrade.
  const view = async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        await new Promise((r) => setTimeout(r, 300));
        return await chain.view<T>(method, args);
      } catch (e) {
        if (i >= 6) throw e;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  const markets = await view<{ id: number }[]>("list_markets", { limit: 200 });
  const details: { market: unknown; spec: unknown; receipts: unknown[]; history: unknown }[] = [];
  for (const m of markets) {
    details.push({
      market: await view("get_market", { market_id: m.id }),
      spec: await view("get_spec", { market_id: m.id }),
      receipts: await view<unknown[]>("get_receipts", { market_id: m.id }),
      history: await view("get_price_history", { market_id: m.id }),
    });
  }
  return {
    json: JSON.stringify({ details, config: await view("get_config"), stats: await view("get_stats"), labs: await view("list_labs"), board: await view("get_points_leaderboard", { limit: 50 }) }),
    count: markets.length,
    receipts: details.reduce((n, d) => n + (d.receipts).length, 0),
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
