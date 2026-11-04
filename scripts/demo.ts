/**
 * End to end on testnet: create -> trade -> lock -> Lab run -> propose -> finalize -> redeem, for
 * every demo claim, on the real chain, in real sandboxes.
 *
 *   pnpm demo                 # real NEAR AI private model (a fraction of a cent)
 *   MOCK_LLM=1 pnpm demo      # scripted model, no credits
 *   pnpm demo repairable      # only some claims
 *   pnpm demo --resume        # finish the latest markets after an interruption
 *
 * The `reproduces` claim runs in money mode with tUSDC through ft_transfer_call and ends with a
 * withdrawal. The others run in points mode. Exits non-zero if any expectation fails.
 */
import { specHash, specJson, type Receipt } from "@rerun/shared";
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { DEMO_NAMES, loadDemo, type DemoClaim, type DemoName } from "../lab/orchestrator/src/demo/fixtures.ts";
import { need, testnetChain, testnetWorker } from "../lab/orchestrator/src/lab/setup.ts";

const UNIT = 1_000_000n;
const LOCK_IN_SECS = 75;
const CHALLENGE_WINDOW_SECS = 60;
const LIQUIDITY = 50n * UNIT;
const TRADE = 10n * UNIT;

const chain = testnetChain();
const ownerId = need("TESTNET_OWNER_ACCOUNT");
const traderId = need("TESTNET_FT_ACCOUNT"); // an existing account, so the demo creates none
const ftId = traderId;
const creator = chain.account(ownerId, need("TESTNET_OWNER_PRIVATE_KEY"));
const trader = chain.account(traderId, need("TESTNET_FT_PRIVATE_KEY"));
const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const big = (v: unknown) => BigInt(String(v));
const failures: string[] = [];
function check(ok: boolean, label: string) {
  console.log(`    [${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failures.push(label);
}

interface Market {
  id: DemoName;
  demo: DemoClaim;
  marketId: number;
  money: boolean;
}

type MarketInfo = { state: string; challenge_deadline: number | null; outcome: string | null; invalid_reason: string | null; creation_bond: string; repro_fee: string; collateral: string; yes_price_ppm: number };
const market = (id: number) => chain.view<MarketInfo>("get_market", { market_id: id });
const position = (who: string, id: number) => chain.view<{ yes: string; no: string; lp: string } | null>("get_position", { account_id: who, market_id: id });
const ftBalance = async (who: string) => big(await chain.view("ft_balance_of", { account_id: who }, ftId));

async function ensurePoints(account: ReturnType<typeof chain.account>) {
  const bal = big(await chain.view("get_balance", { account_id: account.accountId, mode: "points" }));
  if (bal === 0n) {
    await chain.call(account, "claim_points", {}, { deposit: "0.02" }).catch(() => {}); // already claimed and spent is fine
  }
}

async function ensureMoney(account: ReturnType<typeof chain.account>, amount: bigint) {
  await chain.call(account, "mint", { amount: String(amount) }, {}, ftId);
  const storage = big(await chain.view("storage_balance_of", { account_id: account.accountId }));
  if (storage < 10n ** 22n) await chain.call(account, "storage_deposit", {}, { deposit: "0.05" });
}

async function ftCall(account: ReturnType<typeof chain.account>, amount: bigint, msg: unknown) {
  return chain.call(
    account,
    "ft_transfer_call",
    { receiver_id: chain.contractId, amount: String(amount), msg: JSON.stringify(msg) },
    { yocto: 1n, tgas: 200 },
    ftId,
  );
}

async function create(name: DemoName, lockTime: number): Promise<Market> {
  const demo = loadDemo(name, labKeys);
  const money = name === "reproduces";
  const created = await chain.call(
    creator,
    "create_market",
    { spec_json: specJson(demo.spec), lock_time: lockTime, challenge_window: CHALLENGE_WINDOW_SECS, mode: money ? "money" : "points" },
    { deposit: "0.1" },
  );
  const marketId = Number(created.value);
  console.log(`  ${name}: market ${marketId}, ${money ? "money" : "points"} mode, spec ${specHash(demo.spec).slice(0, 12)} ${EXPLORER_TX}${created.txHash}`);

  const info = await market(marketId);
  if (money) {
    const total = LIQUIDITY + big(info.creation_bond) + big(info.repro_fee);
    await ftCall(creator, total, { action: "fund", market_id: marketId, initial_liquidity: String(LIQUIDITY) });
    await ftCall(creator, TRADE, { action: "buy", market_id: marketId, outcome: "YES", min_shares_out: "0" });
    await ftCall(trader, TRADE, { action: "buy", market_id: marketId, outcome: "NO", min_shares_out: "0" });
  } else {
    await chain.call(creator, "fund_market", { market_id: marketId, initial_liquidity: String(LIQUIDITY) }, { deposit: "0.02" });
    const t = { market_id: marketId, amount: String(TRADE), min_shares_out: "0" };
    await chain.call(creator, "buy", { ...t, outcome: "YES" }, { deposit: "0.02" });
    await chain.call(trader, "buy", { ...t, outcome: "NO" }, { deposit: "0.02" });
  }
  const opened = await market(marketId);
  check(opened.state === "Open", `${name}: market is open`);
  return { id: name, demo, marketId, money };
}

/** For `--resume`: the newest on-chain market of each demo claim, matched by spec hash. */
async function existingMarkets(names: DemoName[]): Promise<Market[]> {
  const all = await chain.view<{ id: number; mode: string; spec: { spec_hash: string } }[]>("list_markets", { limit: 100 });
  return names.map((name) => {
    const demo = loadDemo(name, labKeys);
    const found = all.find((m) => m.spec.spec_hash === specHash(demo.spec)); // list is newest first
    if (!found) throw new Error(`no market found for ${name}; run without --resume`);
    console.log(`  ${name}: market ${found.id}`);
    return { id: name, demo, marketId: found.id, money: found.mode === "money" };
  });
}

async function settle(m: Market) {
  const { demo, marketId } = m;
  console.log(`\n  ${m.id} (market ${marketId})`);
  const info = await market(marketId);
  const receipts = await chain.view<Receipt[]>("get_receipts", { market_id: marketId });
  const r = receipts[0];
  check(r?.outcome === demo.expected, `on-chain receipt says ${r?.outcome}, expected ${demo.expected}`);
  check(info.state === "Final" && info.outcome === demo.expected, `market is Final with ${info.outcome}`);
  if (!r) return;
  check(r.spec_hash === specHash(demo.spec), "receipt spec_hash matches the claim");
  check(r.patches.length === demo.expectedPatches, `${r.patches.length} patch(es) in the receipt`);
  if (r.patches_diff_excerpt) console.log(r.patches_diff_excerpt.replace(/^/gm, "      "));
  if (demo.spec.private_data) check(r.log_tail === "" && r.full_log_uri === "", "private claim: no log content on-chain");
  console.log(`    measured ${r.measured_value ?? "-"}, reported ${r.reported_value}, ${r.tolerance}; model ${r.nearai.model_id}, signed replies ${r.nearai.response_signature_refs.length}`);

  // Redeem. YES wins on REPRODUCED, both sides get 0.5 on INVALID, and NO wins otherwise.
  const yesWins = demo.expected === "REPRODUCED";
  const traderPos = (await position(traderId, marketId))!;
  const creatorPos = (await position(ownerId, marketId))!;
  const paidTrader = big((await chain.call(trader, "redeem", { market_id: marketId }, { deposit: "0.01" })).value);
  const paidCreator = big((await chain.call(creator, "redeem", { market_id: marketId }, { deposit: "0.01" })).value);
  const expectTrader = demo.expected === "INVALID" ? big(traderPos.no) / 2n : yesWins ? 0n : big(traderPos.no);
  check(paidTrader === expectTrader, `NO-holding trader redeemed ${paidTrader} (expected ${expectTrader})`);
  if (demo.expected === "INVALID") check(info.invalid_reason === r.invalid_reason, `invalid reason ${info.invalid_reason}`);
  check(paidCreator >= (yesWins ? big(creatorPos.yes) : 0n), `creator (YES + LP) redeemed ${paidCreator}`);
  const after = await market(marketId);
  check(big(after.collateral) >= 0n && big(after.collateral) < 10n, `collateral left is rounding dust (${after.collateral})`);

  if (m.money) {
    const before = await ftBalance(ownerId);
    const available = big(await chain.view("get_balance", { account_id: ownerId, mode: "money" }));
    const w = await chain.call(creator, "withdraw", {}, { yocto: 1n, tgas: 100 });
    const got = (await ftBalance(ownerId)) - before;
    check(got === available && available > 0n, `withdrew ${got} tUSDC units back to the wallet ${EXPLORER_TX}${w.txHash}`);
  }
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const names = (wanted.length ? wanted : DEMO_NAMES) as DemoName[];
  console.log(`Contract ${chain.contractId}; LLM ${process.env.MOCK_LLM === "1" ? "MOCK" : process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash"}\n`);

  const markets: Market[] = [];
  if (process.argv.includes("--resume")) {
    console.log("Resuming the latest market of each claim:");
    markets.push(...(await existingMarkets(names)));
  } else {
    console.log("Preparing accounts:");
    await ensurePoints(creator);
    await ensurePoints(trader);
    if (names.includes("reproduces")) {
      const needed = LIQUIDITY + 20n * UNIT + TRADE;
      await ensureMoney(creator, needed);
      await ensureMoney(trader, TRADE);
    }

    console.log("\nCreating and trading:");
    const lockTime = Math.floor(Date.now() / 1000) + LOCK_IN_SECS + names.length * 15;
    for (const name of names) markets.push(await create(name, lockTime));

    const wait = lockTime - Math.floor(Date.now() / 1000);
    console.log(`\nWaiting ${Math.max(wait, 0)}s for the lock time...`);
    await sleep(Math.max(wait, 0) * 1000 + 2000);
  }

  console.log("\nLab running:");
  const worker = testnetWorker({
    log: (m) => console.log(`  ${m}`),
    onEvent: (id, e) => {
      console.log(`  market ${id} [${e.stage}] ${e.message}`);
      if (e.diff) console.log(e.diff.replace(/^/gm, "      "));
    },
  });
  // A tick that fails on one market leaves it for the next tick, as the real Lab loop does.
  const ids = markets.map((m) => m.marketId);
  const waitingOnLab = async () => {
    const states = await Promise.all(ids.map(market));
    return states.filter((m) => ["Open", "Locked", "Running"].includes(m.state)).length;
  };
  for (let round = 0; round < 6 && (await waitingOnLab()) > 0; round++) {
    await worker.tick();
  }

  const deadlines = (await Promise.all(ids.map(market))).map((m) => (m.state === "Proposed" ? (m.challenge_deadline ?? 0) : 0));
  const wait = Math.max(...deadlines) - Math.floor(Date.now() / 1000);
  if (wait > 0) {
    console.log(`\nWaiting ${wait}s for the challenge window...`);
    await sleep((wait + 3) * 1000);
  }
  for (const id of ids) {
    if ((await market(id)).state !== "Proposed") continue;
    const r = await chain.call(creator, "finalize", { market_id: id }).catch((e: Error) => e);
    if (r instanceof Error) console.log(`  finalize ${id}: ${r.message}`);
  }

  console.log("\nResults:");
  for (const m of markets) await settle(m);

  const stats = await chain.view<{ markets: number; reproduced: number; not_reproduced: number; broken: number; invalid: number; reproduction_rate_bps: number | null }>("get_stats");
  console.log(`\nContract stats: ${JSON.stringify(stats)}`);
  console.log(failures.length ? `\nFAILED (${failures.length}):\n  ${failures.join("\n  ")}` : "\nALL PASS");
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
