/**
 * Posts one short demo claim in money mode, for showing the whole money cycle: get test USDC, forecast,
 * watch the Lab rerun it, then collect. The running Lab picks it up when forecasting ends, and finalizes it
 * after the challenge window. Testnet only; signs with the owner's key.
 *
 *   pnpm money-demo [minutes to forecast, default 6] [challenge window in seconds, default 180]
 */
import { specJson } from "@rerun/shared";
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { loadDemo } from "../lab/orchestrator/src/demo/fixtures.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";
import { UNIT } from "./lib/demo-kit.ts";

const LIQUIDITY = 10n * UNIT;

async function main() {
  const minutes = Number(process.argv[2] ?? 6);
  const window = Number(process.argv[3] ?? 180);
  const chain = testnetChain();
  const owner = chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
  const ftId = need("TESTNET_FT_ACCOUNT");
  const labKeys = { publicKey: need("LAB_ENC_PUBLIC_KEY"), privateKey: need("LAB_ENC_PRIVATE_KEY") };
  const spec = loadDemo("reproduces", labKeys).spec;

  const lock = Math.floor(Date.now() / 1000) + minutes * 60;
  const created = await chain.call(owner, "create_market", { spec_json: specJson(spec), lock_time: lock, challenge_window: window, mode: "money" }, { deposit: "0.1" });
  const id = Number(created.value);
  console.log(`claim ${id} posted: ${EXPLORER_TX}${created.txHash}`);

  const params = (await chain.view<{ money: { creation_bond: string; repro_fee: string } }>("get_config")).money;
  const total = LIQUIDITY + BigInt(params.creation_bond) + BigInt(params.repro_fee);
  await chain.call(owner, "mint", { amount: String(total) }, {}, ftId);
  const funded = await chain.call(
    owner,
    "ft_transfer_call",
    { receiver_id: chain.contractId, amount: String(total), msg: JSON.stringify({ action: "fund", market_id: id, initial_liquidity: String(LIQUIDITY) }) },
    { yocto: 1n, tgas: 200 },
    ftId,
  );
  console.log(`funded with ${LIQUIDITY / UNIT} tUSDC: ${EXPLORER_TX}${funded.txHash}`);
  console.log(`forecasting closes at ${new Date(lock * 1000).toISOString()}, then a ${window}s challenge window`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
