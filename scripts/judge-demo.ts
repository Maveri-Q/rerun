/**
 * Try RERUN with nothing but Node: no wallet, Docker, keys or NEAR tokens.
 *
 *   pnpm install
 *   pnpm judge-demo
 *
 * It makes a throwaway testnet account from the public faucet, claims free points, makes a forecast
 * on a live claim, re-checks a finished receipt itself, and tries some attacks. If a Lab is reachable
 * (NEXT_PUBLIC_LAB_URL, or a local `pnpm lab:watch`), it also opens a claim and watches it get re-run.
 * Add --skip-live to leave that part out.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDecimal, withinTolerance, type Receipt, type ToleranceKind } from "@rerun/shared";
import { KeyPair, yoctoToNear, type KeyPairString } from "near-api-js";
import { Chain, EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { big, getMarket, points, Scoreboard, scriptedReceipt, sleep, UNIT, type MarketInfo } from "./lib/demo-kit.ts";

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT || "rerun.rerun-43f5f2.testnet";
const RPC = process.env.NEXT_PUBLIC_RPC || "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const LAB_URL = (process.env.NEXT_PUBLIC_LAB_URL || "http://localhost:8787").replace(/\/$/, "");
const LIVE_LOCK_SECS = 75;
const LIVE_WINDOW_SECS = 60;
const LIVE_TIMEOUT_MS = 6 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function createAccount(chain: Chain): Promise<ReturnType<Chain["account"]>> {
  const id = `rerun-judge-${randomBytes(4).toString("hex")}.testnet`;
  const key = KeyPair.fromRandom("ed25519");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(FAUCET, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }),
    }).catch((e: Error) => e);
    if (!(res instanceof Error) && res.ok) break;
    if (attempt >= 3) throw new Error(`The public faucet did not create an account: ${res instanceof Error ? res.message : res.status}`);
    await sleep(2000 * (attempt + 1));
  }
  const account = chain.account(id, key.toString() as KeyPairString);
  for (let i = 0; i < 30; i++) {
    if (await account.getState().then(() => true).catch(() => false)) return account;
    await sleep(1000);
  }
  throw new Error(`${id} did not appear on the network in time`);
}

/** Recomputes a receipt's claims here, trusting nothing but the chain. */
async function verifyReceipt(chain: Chain, board: Scoreboard, m: MarketInfo) {
  const receipts = await chain.view<Receipt[]>("get_receipts", { market_id: m.id });
  const r = receipts.at(-1)!;
  const spec = await chain.view<string>("get_spec", { market_id: m.id });
  board.add(`The receipt is about this exact claim (market ${m.id})`, sha256(spec) === r.spec_hash, "PASS");
  const [kind = "abs", value = "0"] = r.tolerance.split(":");
  const within = withinTolerance(parseDecimal(r.measured_value ?? "0"), parseDecimal(r.reported_value), kind as ToleranceKind, parseDecimal(value));
  board.add("The verdict follows from the numbers", within === (r.outcome === "REPRODUCED"), "PASS", `measured ${r.measured_value}, claimed ${r.reported_value} ± ${value}, so ${r.outcome}`);
  board.add("The Lab's code is still approved", await chain.view<boolean>("is_codehash_approved", { codehash: r.lab_codehash }), "PASS");
  board.add("The AI only touched setup", r.patches.every((p) => ["ENV", "PATH", "DEPENDENCY"].includes(p.kind)), "PASS", `${r.patches.length} fixes`);
}

async function liveRun(chain: Chain, board: Scoreboard, judge: ReturnType<Chain["account"]>) {
  const health = await fetch(`${LAB_URL}/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!health?.ok) {
    return board.skip("Open a claim and watch the Lab re-run it", `no Lab reachable at ${LAB_URL}. The receipts checked above came from real runs.`);
  }
  // A demo claim from the repo. The Lab recognises it and has its code and data.
  const vectors = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../contracts/rerun/test-vectors/lab-output.json"), "utf8")) as { name: string; spec_json: string }[];
  const specJson = vectors.find((v) => v.name === "reproduces")!.spec_json;
  const created = await chain.call(
    judge,
    "create_market",
    { spec_json: specJson, lock_time: Math.floor(Date.now() / 1000) + LIVE_LOCK_SECS, challenge_window: LIVE_WINDOW_SECS, mode: "points" },
    { deposit: "0.1" },
  );
  const id = Number(created.value);
  await chain.call(judge, "fund_market", { market_id: id, initial_liquidity: String(20n * UNIT) }, { deposit: "0.02" });
  board.add("You open your own claim", true, "PASS", `market ${id}, ${EXPLORER_TX}${created.txHash}`);
  console.log(`  Waiting for the Lab. It starts in about ${LIVE_LOCK_SECS}s and takes a few minutes. To watch in a browser: pnpm web, then /market/${id}`);

  const started = Date.now();
  let m = await getMarket(chain, id);
  let lastSeen = 0;
  while (m.state !== "Proposed" && m.state !== "Final" && Date.now() - started < LIVE_TIMEOUT_MS) {
    await sleep(5000);
    const events = (await fetch(`${LAB_URL}/runs/${id}`).then((r) => r.json()).catch(() => [])) as { message: string }[];
    for (const e of events.slice(lastSeen)) console.log(`    Lab: ${e.message}`);
    lastSeen = events.length;
    m = await getMarket(chain, id);
  }
  if (m.state !== "Proposed") return board.add("The Lab re-runs your claim", false, "PASS", `still ${m.state} after ${LIVE_TIMEOUT_MS / 60000} minutes`);
  board.add("The Lab re-runs your claim and posts a receipt", true, "PASS");
  await verifyReceipt(chain, board, m);

  await sleep(Math.max((m.challenge_deadline! - Math.floor(Date.now() / 1000) + 2) * 1000, 0));
  await chain.call(judge, "finalize", { market_id: id });
  const paid = big((await chain.call(judge, "redeem", { market_id: id }, { deposit: "0.01" })).value);
  const final = await getMarket(chain, id);
  board.add("The result becomes final and you collect", final.state === "Final", "PASS", `${final.outcome}, ${points(paid)} points`);
}

async function main() {
  const chain = new Chain(RPC, CONTRACT);
  const board = new Scoreboard();

  console.log(`RERUN on testnet: ${CONTRACT}\n`);
  console.log("What's on-chain:");
  const stats = await chain.view<{ markets: number; reproduced: number; not_reproduced: number; broken: number; invalid: number }>("get_stats");
  board.add("The contract is live", stats.markets > 0, "PASS", `${stats.markets} claims: ${stats.reproduced} held up, ${stats.not_reproduced} did not, ${stats.broken} broken, ${stats.invalid} invalid`);

  console.log("\nYour throwaway account:");
  const judge = await createAccount(chain);
  board.add("A new account from the public faucet", true, "PASS", `${judge.accountId}, ${yoctoToNear(await judge.getBalance(), 2)} free test NEAR`);
  await chain.call(judge, "claim_points", {}, { deposit: "0.02" });
  const pts = big(await chain.view("get_balance", { account_id: judge.accountId, mode: "points" }));
  board.add("1,000 free points", pts === 1000n * UNIT, "PASS");
  await board.blocked("Claiming the free points twice", "points already claimed", () => chain.call(judge, "claim_points", {}, { deposit: "0.02" }));

  console.log("\nMake a forecast:");
  const open = (await chain.view<MarketInfo[]>("list_markets", { state: "Open", mode: "points", limit: 100 })).filter((m) => m.lock_time > Date.now() / 1000 + 120);
  const target = open[0];
  if (target) {
    const before = target.yes_price_ppm;
    const trade = await chain.call(judge, "buy", { market_id: target.id, outcome: "YES", amount: String(2n * UNIT), min_shares_out: "0" }, { deposit: "0.02" });
    const after = await getMarket(chain, target.id);
    const pos = await chain.view<{ yes: string }>("get_position", { account_id: judge.accountId, market_id: target.id });
    board.add("Buying YES moves the odds", after.yes_price_ppm > before, "PASS", `${(before / 1e4).toFixed(1)}% to ${(after.yes_price_ppm / 1e4).toFixed(1)}%, you hold ${points(big(pos.yes))} YES, ${EXPLORER_TX}${trade.txHash}`);
    await board.blocked("Spending more points than you have", "insufficient points balance", () => chain.call(judge, "buy", { market_id: target.id, outcome: "YES", amount: String(5000n * UNIT), min_shares_out: "0" }, { deposit: "0.02" }));
    await board.blocked("A trade that would fill at a bad price", "slippage", () => chain.call(judge, "buy", { market_id: target.id, outcome: "YES", amount: String(UNIT), min_shares_out: String(100n * UNIT) }, { deposit: "0.02" }));
    await board.blocked("Locking a market early", "lock time not reached", () => chain.call(judge, "lock", { market_id: target.id }));
  } else {
    board.skip("Make a forecast", "no open points claims right now");
  }

  console.log("\nCheck a finished result yourself:");
  const finals = await chain.view<MarketInfo[]>("list_markets", { state: "Final", limit: 100 });
  const settled = finals.find((m) => m.outcome === "REPRODUCED" && !m.spec.title.startsWith("[TEST]"));
  if (settled) await verifyReceipt(chain, board, settled);
  else board.skip("Check a finished result", "no finished claims yet");

  console.log("\nTry to cheat:");
  const victim = target ?? settled;
  if (victim) {
    await board.blocked("Posting a fake result, as you", "caller is not a registered Lab", () =>
      chain.call(judge, "propose_result", { receipt: scriptedReceipt(victim, judge.accountId, "0".repeat(64)) }, { deposit: "0.2", tgas: 200 }),
    );
  }
  await board.blocked("Approving your own Lab", "owner only", () => chain.call(judge, "approve_codehash", { codehash: "a".repeat(64) }));
  await board.blocked("Pausing the contract", "owner only", () => chain.call(judge, "pause", {}));

  console.log("\nOpen a claim and watch it get re-run:");
  if (process.argv.includes("--skip-live")) board.skip("Open a claim and watch the Lab re-run it", "--skip-live");
  else await liveRun(chain, board, judge);

  board.finish();
  console.log(`\nYour throwaway account is ${judge.accountId}. It has no value and can be ignored.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
