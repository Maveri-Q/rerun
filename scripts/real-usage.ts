/**
 * Honest usage numbers for the README: real accounts and their forecasts, with the project's own accounts,
 * demo scripts and throwaway test accounts counted separately. Reads the chain and signs nothing.
 *
 *   pnpm real-usage
 *
 * It finds accounts through the points leaderboard, so someone who only ever used money mode isn't seen.
 */
import { testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const OURS = /^rerun-|\.rerun-43f5f2\.testnet$/;

async function main() {
  const chain = testnetChain();
  const board = await chain.view<{ account_id: string }[]>("get_points_leaderboard", { limit: 500 });
  const tally = { real: { accounts: 0, forecasts: 0 }, ours: { accounts: 0, forecasts: 0 } };
  for (const { account_id } of board) {
    const group = OURS.test(account_id) ? tally.ours : tally.real;
    group.accounts += 1;
    const ids = await chain.view<number[]>("get_account_markets", { account_id });
    for (const market_id of ids) {
      const p = await chain.view<{ position: { yes: string; no: string; spent: string; lp: string } } | null>("get_position", { account_id, market_id });
      // Funding a claim gives its creator shares too, so a forecast is a position with no prize-pool share.
      if (p && BigInt(p.position.lp) === 0n && BigInt(p.position.spent) > 0n) group.forecasts += 1;
    }
  }
  console.log(`Real accounts: ${tally.real.accounts}, with forecasts on ${tally.real.forecasts} claims in all.`);
  console.log(`Our own and test accounts, not counted above: ${tally.ours.accounts}, with forecasts on ${tally.ours.forecasts} claims.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
