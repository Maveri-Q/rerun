/**
 * Seeds open testnet markets with liquidity and trades so the site has live odds to show.
 * Uses the demo claims, in both modes. They lock after `--days` days (default 7); run
 * `pnpm lab:watch` to have the Lab settle them.
 *
 *   pnpm seed [--days 7]
 */
import { specJson } from "@rerun/shared";
import { DEMO_NAMES, loadDemo, type DemoName } from "../lab/orchestrator/src/demo/fixtures.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const UNIT = 1_000_000n;
const LIQUIDITY = 40n * UNIT;

const chain = testnetChain();
const ownerId = need("TESTNET_OWNER_ACCOUNT");
const traderId = need("TESTNET_FT_ACCOUNT");
const ftId = traderId;
const creator = chain.account(ownerId, need("TESTNET_OWNER_PRIVATE_KEY"));
const trader = chain.account(traderId, need("TESTNET_FT_PRIVATE_KEY"));
const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };

const daysArg = process.argv.indexOf("--days");
const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 7;

/** Which demo, which mode, and a sequence of trades that gives each market its own odds. */
const SEEDS: { name: DemoName; money: boolean; trades: [who: "creator" | "trader", side: "YES" | "NO", units: bigint][] }[] = [
  { name: "reproduces", money: false, trades: [["trader", "YES", 12n], ["creator", "NO", 4n], ["trader", "YES", 8n]] },
  { name: "misreported", money: false, trades: [["trader", "NO", 14n], ["creator", "YES", 3n], ["trader", "NO", 6n]] },
  { name: "repairable", money: true, trades: [["trader", "YES", 6n], ["creator", "NO", 5n], ["trader", "NO", 2n]] },
  { name: "private", money: false, trades: [["creator", "YES", 5n], ["trader", "YES", 4n], ["creator", "NO", 2n]] },
  { name: "broken", money: false, trades: [["trader", "NO", 5n], ["creator", "YES", 6n], ["trader", "NO", 3n]] },
];

async function main() {
  if (!SEEDS.every((s) => DEMO_NAMES.includes(s.name))) throw new Error("unknown demo");
  const lockTime = Math.floor(Date.now() / 1000) + days * 86_400;
  const money = SEEDS.filter((s) => s.money);
  if (money.length) {
    for (const a of [creator, trader]) {
      await chain.call(a, "mint", { amount: String(500n * UNIT) }, {}, ftId);
      await chain.call(a, "storage_deposit", {}, { deposit: "0.05" });
    }
  }
  for (const seed of SEEDS) {
    const demo = loadDemo(seed.name, labKeys);
    const created = await chain.call(
      creator,
      "create_market",
      { spec_json: specJson(demo.spec), lock_time: lockTime, challenge_window: 3600, mode: seed.money ? "money" : "points" },
      { deposit: "0.1" },
    );
    const id = Number(created.value);
    const info = await chain.view<{ creation_bond: string; repro_fee: string }>("get_market", { market_id: id });
    const ftCall = (a: typeof creator, amount: bigint, msg: unknown) =>
      chain.call(a, "ft_transfer_call", { receiver_id: chain.contractId, amount: String(amount), msg: JSON.stringify(msg) }, { yocto: 1n, tgas: 200 }, ftId);
    if (seed.money) {
      const total = LIQUIDITY + BigInt(info.creation_bond) + BigInt(info.repro_fee);
      await ftCall(creator, total, { action: "fund", market_id: id, initial_liquidity: String(LIQUIDITY) });
    } else {
      await chain.call(creator, "fund_market", { market_id: id, initial_liquidity: String(LIQUIDITY) }, { deposit: "0.02" });
    }
    for (const [who, side, units] of seed.trades) {
      const a = who === "creator" ? creator : trader;
      if (seed.money) await ftCall(a, units * UNIT, { action: "buy", market_id: id, outcome: side, min_shares_out: "0" });
      else await chain.call(a, "buy", { market_id: id, outcome: side, amount: String(units * UNIT), min_shares_out: "0" }, { deposit: "0.02" });
    }
    const m = await chain.view<{ yes_price_ppm: number }>("get_market", { market_id: id });
    console.log(`market ${id}  ${seed.name.padEnd(12)} ${seed.money ? "tUSDC " : "points"}  YES ${(m.yes_price_ppm / 10_000).toFixed(1)}%`);
  }
  const bal = await chain.view<string>("get_balance", { account_id: ownerId, mode: "points" });
  console.log(`creator points left: ${Number(bal) / 1e6}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
