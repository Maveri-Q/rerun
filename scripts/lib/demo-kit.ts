import { specJson, type ClaimSpec, type Receipt } from "@rerun/shared";
import type { Account } from "near-api-js";
import type { Chain } from "../../lab/orchestrator/src/chain/near.ts";

/** Helpers shared by the demo scripts. */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const big = (v: unknown) => BigInt(String(v));
export const UNIT = 1_000_000n;
export const points = (v: bigint) => (Number(v) / 1e6).toFixed(2);

export interface MarketInfo {
  id: number;
  state: string;
  lock_time: number;
  run_deadline: number | null;
  challenge_deadline: number | null;
  outcome: string | null;
  invalid_reason: string | null;
  creation_bond: string;
  repro_fee: string;
  collateral: string;
  yes_price_ppm: number;
  mode: string;
  spec: { spec_hash: string; title: string; commit: string; data_hashes: string[]; reported_value: string; tolerance_kind: string; tolerance_value: string };
}

export const getMarket = (chain: Chain, id: number) => chain.view<MarketInfo>("get_market", { market_id: id });

/** The scripts drive markets by hand, so a running Lab would race them. */
export async function requireLabStopped(): Promise<void> {
  const url = process.env.LAB_PUBLIC_URL || "http://localhost:8787";
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  if (res?.ok) {
    throw new Error(`A Lab is running at ${url}, and it would compete for this script's markets. Stop \`pnpm lab:watch\` and run this again.`);
  }
}

/** Creates and funds a points market. Returns its id. */
export async function openPointsMarket(chain: Chain, creator: Account, spec: ClaimSpec, lockInSecs: number, windowSecs: number, liquidity = 20n * UNIT): Promise<number> {
  const created = await chain.call(
    creator,
    "create_market",
    { spec_json: specJson(spec), lock_time: Math.floor(Date.now() / 1000) + lockInSecs, challenge_window: windowSecs, mode: "points" },
    { deposit: "0.1" },
  );
  const id = Number(created.value);
  await chain.call(creator, "fund_market", { market_id: id, initial_liquidity: String(liquidity) }, { deposit: "0.02" });
  return id;
}

export async function ensurePoints(chain: Chain, account: Account): Promise<bigint> {
  const balance = big(await chain.view("get_balance", { account_id: account.accountId, mode: "points" }));
  if (balance > 0n) return balance;
  await chain.call(account, "claim_points", {}, { deposit: "0.02" });
  return big(await chain.view("get_balance", { account_id: account.accountId, mode: "points" }));
}

/** A receipt written by a script, not by a run. Used to test the contract's rules directly. */
export function scriptedReceipt(m: MarketInfo, labAccount: string, codehash: string, over: Partial<Receipt> = {}): Receipt {
  const now = Math.floor(Date.now() / 1000);
  return {
    market_id: m.id,
    spec_hash: m.spec.spec_hash,
    outcome: "REPRODUCED",
    invalid_reason: null,
    measured_value: m.spec.reported_value,
    reported_value: m.spec.reported_value,
    tolerance: `${m.spec.tolerance_kind}:${m.spec.tolerance_value}`,
    commit: m.spec.commit,
    data_hashes: m.spec.data_hashes,
    env_lock_hash: "",
    patches: [],
    patches_diff_excerpt: "",
    log_hash: "0".repeat(64),
    log_tail: "Scripted by the attack demo. No code was run.",
    full_log_uri: "",
    report_hash: "0".repeat(64),
    report_uri: "",
    runtime_secs: 0,
    exit_code: 0,
    lab_codehash: codehash,
    lab_account: labAccount,
    nearai: { model_id: "scripted-by-attack-demo", attestation_digest: "0".repeat(64), response_signature_refs: [] },
    run_index: 0,
    started_at: now - 1,
    finished_at: now - 1,
    ...over,
  };
}

/** Prints a results table and sets the exit code if anything failed. */
export class Scoreboard {
  private readonly rows: { check: string; result: string; ok: boolean }[] = [];

  add(check: string, ok: boolean, expected: string, detail = ""): void {
    const result = ok ? expected : "FAILED";
    this.rows.push({ check, result, ok });
    console.log(`  [${result}] ${check}${detail ? `: ${detail}` : ""}`);
  }

  /** Runs `attempt`, which must fail with a message containing `reason`. */
  async blocked(check: string, reason: string, attempt: () => Promise<unknown>): Promise<void> {
    // Only a passing network failure earns a retry. Anything else must be the expected rejection.
    for (let tries = 0; ; tries++) {
      try {
        await attempt();
        return this.add(check, false, "BLOCKED", "the chain accepted it");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (tries < 4 && /bad gateway|gateway timeout|service unavailable|fetch failed/i.test(message)) {
          await sleep(3000 * (tries + 1));
          continue;
        }
        return this.add(check, message.includes(reason), "BLOCKED", message.includes(reason) ? reason : message.slice(0, 200));
      }
    }
  }

  skip(check: string, why: string): void {
    this.rows.push({ check, result: "SKIPPED", ok: true });
    console.log(`  [SKIPPED] ${check}: ${why}`);
  }

  finish(): void {
    console.log("");
    console.table(this.rows.map(({ check, result }) => ({ check, result })));
    const failed = this.rows.filter((r) => !r.ok);
    console.log(failed.length ? `FAILED: ${failed.length} of ${this.rows.length}` : "ALL PASS");
    if (failed.length) process.exitCode = 1;
  }
}
