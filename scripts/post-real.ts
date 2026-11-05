/**
 * Posts published papers from claims/real to testnet as open claims, in points mode. Safe to run
 * twice: a claim already on-chain is skipped. There are no seed forecasts, so the odds start at 50%
 * and every forecast on these is a real one.
 *
 *   pnpm post-real [--days 2] [--dry]
 */
import { specHash, specJson } from "@rerun/shared";
import { loadReal } from "../lab/orchestrator/src/demo/real.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const UNIT = 1_000_000n;
const LIQUIDITY = 40n * UNIT;
const CHALLENGE_WINDOW_SECS = 24 * 3600;

/** The flagship goes first, so it has the lowest id of the set. */
const NAMES = ["wildfire-water", "parkinsons-spread", "budworm-timing", "budworm-spread"];

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const days = Number(arg("--days") ?? 2);
const dry = process.argv.includes("--dry");

const chain = testnetChain();
const ownerId = need("TESTNET_OWNER_ACCOUNT");
const owner = chain.account(ownerId, need("TESTNET_OWNER_PRIVATE_KEY"));

async function main() {
  const lockTime = Math.floor(Date.now() / 1000) + days * 86_400;
  const existing = await chain.view<{ id: number; spec: { spec_hash: string } }[]>("list_markets", { limit: 200 });
  const onChain = new Map(existing.map((m) => [m.spec.spec_hash, m.id]));
  const config = await chain.view<{ points: { creation_bond: string; repro_fee: string } }>("get_config");
  const eachCost = LIQUIDITY + BigInt(config.points.creation_bond) + BigInt(config.points.repro_fee);

  const todo = NAMES.map((name) => ({ name, spec: loadReal(name).spec })).filter(({ name, spec }) => {
    const id = onChain.get(specHash(spec));
    if (id !== undefined) console.log(`already posted: ${name} is claim ${id}`);
    return id === undefined;
  });
  const balance = BigInt(await chain.view<string>("get_balance", { account_id: ownerId, mode: "points" }));
  console.log(`posting ${todo.length} claim(s), ${Number(eachCost) / 1e6} points each. The account has ${Number(balance) / 1e6} points.`);
  if (balance < eachCost * BigInt(todo.length)) throw new Error("not enough points to post these claims");
  console.log(`forecasting ends ${new Date(lockTime * 1000).toISOString()}, then ${CHALLENGE_WINDOW_SECS / 3600}h to challenge`);

  for (const { name, spec } of todo) {
    console.log(`${dry ? "would post" : "posting"} ${name}: ${spec.title}\n  fingerprint ${specHash(spec)}`);
    if (dry) continue;
    const created = await chain.call(owner, "create_market", { spec_json: specJson(spec), lock_time: lockTime, challenge_window: CHALLENGE_WINDOW_SECS, mode: "points" }, { deposit: "0.1" });
    const id = Number(created.value);
    await chain.call(owner, "fund_market", { market_id: id, initial_liquidity: String(LIQUIDITY) }, { deposit: "0.02" });
    console.log(`  claim ${id} is open: https://testnet.nearblocks.io/txns/${created.txHash}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
