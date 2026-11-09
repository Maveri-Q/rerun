/**
 * Makes claims final once their challenge window has closed, then collects for every account whose key
 * we hold and checks each payout matches the rule: 1 per winning share, half per share if inconclusive.
 * Positions held by anyone else are listed so their owners can collect. Anyone may call `finalize`.
 *
 *   pnpm finalize-claims 20 21 22 23
 */
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

interface Market {
  id: number;
  state: string;
  outcome: string | null;
  challenge_deadline: number | null;
  collateral: string;
}
/** The view nests the market under `market` in some versions and flattens it in others. */
const marketOf = async (id: number): Promise<Market> => {
  const v = await chain.view<{ market?: Market } & Market>("get_market", { market_id: id });
  return v.market ?? v;
};
interface PositionView {
  position: { yes: string; no: string; lp: string };
}

const chain = testnetChain();
const ours = [
  chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY")),
  chain.account(need("TESTNET_LAB_ACCOUNT"), need("TESTNET_LAB_PRIVATE_KEY")),
  chain.account(need("TESTNET_FT_ACCOUNT"), need("TESTNET_FT_PRIVATE_KEY")),
  ...(process.env.SCOUT_ACCOUNT && process.env.SCOUT_PRIVATE_KEY ? [chain.account(process.env.SCOUT_ACCOUNT, process.env.SCOUT_PRIVATE_KEY)] : []),
];

function expected(outcome: string, p: PositionView["position"]): bigint {
  const [yes, no] = [BigInt(p.yes), BigInt(p.no)];
  if (outcome === "REPRODUCED") return yes;
  if (outcome === "INVALID") return yes / 2n + no / 2n;
  return no;
}

async function main() {
  const ids = process.argv.slice(2).map(Number);
  if (!ids.length) throw new Error("Name the claims, for example: pnpm finalize-claims 20 21");
  const board = (await chain.view<{ account_id: string }[]>("get_points_leaderboard", { limit: 500 })).map((e) => e.account_id);
  const holders = [...new Set([...ours.map((a) => a.accountId), ...board])];
  for (const id of ids) {
    let m = await marketOf(id);
    if (m.state === "Proposed") {
      if (Date.now() / 1000 < (m.challenge_deadline ?? Infinity)) {
        console.log(`claim ${id}: the challenge window is still open`);
        continue;
      }
      const tx = await chain.call(ours[0]!, "finalize", { market_id: id }, { tgas: 100 });
      console.log(`claim ${id}: made final ${EXPLORER_TX}${tx.txHash}`);
      m = await marketOf(id);
    }
    if (m.state !== "Final") {
      console.log(`claim ${id}: ${m.state}, nothing to collect yet`);
      continue;
    }
    console.log(`claim ${id}: ${m.outcome}, ${m.collateral} units held`);
    for (const account of holders) {
      const raw = await chain.view<(PositionView & PositionView["position"]) | null>("get_position", { account_id: account, market_id: id });
      const p = raw && { position: raw.position ?? raw };
      if (!p || (BigInt(p.position.yes) === 0n && BigInt(p.position.no) === 0n && BigInt(p.position.lp) === 0n)) continue;
      const signer = ours.find((a) => a.accountId === account);
      if (!signer) {
        console.log(`  ${account} can collect: ${p.position.yes} YES, ${p.position.no} NO, ${p.position.lp} LP`);
        continue;
      }
      const tx = await chain.call(signer, "redeem", { market_id: id }, { deposit: "0.02", tgas: 100 });
      const paid = BigInt(String(tx.value ?? "0"));
      // With a prize-pool share, the pool's shares join the position first, so only a pure forecast has an exact expectation.
      const lp = BigInt(p.position.lp) > 0n;
      const want = expected(m.outcome!, p.position);
      const verdict = lp ? (paid >= want ? "ok, includes the prize pool" : "LOWER THAN EXPECTED") : paid === want ? "ok" : `MISMATCH, expected ${want}`;
      console.log(`  ${account} collected ${paid}: ${verdict} ${EXPLORER_TX}${tx.txHash}`);
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
