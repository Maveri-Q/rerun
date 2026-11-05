/**
 * Gives the Lab longer to start a run after a claim locks, so a home-computer Lab that starts late
 * doesn't lose claims to refund_stale.
 *
 *   pnpm --filter @rerun/scripts exec tsx set-run-timeout.ts 12
 */
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const hours = Number(process.argv[2] ?? 12);
const chain = testnetChain();
const owner = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
const c = await chain.view<{ min_challenge_window: number; max_challenge_window: number }>("get_config");
await chain.call(owner, "set_timing", { run_timeout_secs: hours * 3600, min_challenge_window: c.min_challenge_window, max_challenge_window: c.max_challenge_window });
console.log("run_timeout_secs is now", (await chain.view<{ run_timeout_secs: number }>("get_config")).run_timeout_secs);
