/**
 * Deploys tUSDC and the market contract to testnet and configures them. Safe to rerun: finished
 * steps are skipped. Build the wasm first with `pnpm build:contracts`.
 *
 *   pnpm deploy:testnet
 *
 * Testnet only. Mainnet deployment is a separate, human-approved step.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateLabKeyPair } from "@rerun/shared";
import { nearToYocto, yoctoToNear, type Account } from "near-api-js";
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const root = path.resolve(import.meta.dirname, "..");
const wasm = (p: string) => readFileSync(path.join(root, "contracts/target/near", p));
const UNIT = 1_000_000n;

const chain = testnetChain();
const ownerId = need("TESTNET_OWNER_ACCOUNT");
const owner = chain.account(ownerId, need("TESTNET_OWNER_PRIVATE_KEY"));
const lab = chain.account(need("TESTNET_LAB_ACCOUNT"), need("TESTNET_LAB_PRIVATE_KEY"));
const contract = chain.account(chain.contractId, need("TESTNET_CONTRACT_PRIVATE_KEY"));
const ftId = need("TESTNET_FT_ACCOUNT");
const ft = chain.account(ftId, need("TESTNET_FT_PRIVATE_KEY"));

const near = async (a: Account) => yoctoToNear(await a.getBalance(), 3);

/** Stable identifier for the local Lab until a real TEE codehash exists. */
const LOCAL_CODEHASH = createHash("sha256").update("rerun-local-lab-v1").digest("hex");

function labEnv(): { publicKey: string; codehash: string } {
  if (process.env.LAB_ENC_PUBLIC_KEY && process.env.LAB_CODEHASH) {
    return { publicKey: process.env.LAB_ENC_PUBLIC_KEY, codehash: process.env.LAB_CODEHASH };
  }
  const keys = generateLabKeyPair();
  const lines = [`LAB_ENC_PUBLIC_KEY=${keys.publicKey}`, `LAB_ENC_PRIVATE_KEY=${keys.privateKey}`, `LAB_CODEHASH=${LOCAL_CODEHASH}`, ""];
  appendFileSync(path.join(root, ".env.testnet"), lines.join("\n"));
  process.env.LAB_ENC_PUBLIC_KEY = keys.publicKey;
  process.env.LAB_ENC_PRIVATE_KEY = keys.privateKey;
  process.env.LAB_CODEHASH = LOCAL_CODEHASH;
  return { publicKey: keys.publicKey, codehash: LOCAL_CODEHASH };
}

async function topUp(from: Account, to: Account, target: string, amount: string) {
  if ((await to.getBalance()) >= nearToYocto(target as `${number}`)) return;
  await from.transfer({ receiverId: to.accountId, amount: nearToYocto(amount as `${number}`) });
  console.log(`  moved ${amount} NEAR ${from.accountId} -> ${to.accountId}`);
}

async function hasCode(a: Account): Promise<boolean> {
  const state = await a.getState();
  return !/^1{32}$/.test(String(state.codeHash));
}

async function deploy(a: Account, file: string, initArgs: Record<string, unknown>, isReady: () => Promise<unknown>) {
  if (!(await hasCode(a))) {
    const code = wasm(file);
    await a.deployContract(code);
    console.log(`  deployed ${file} (${code.length} bytes) to ${a.accountId}`);
  }
  const ready = await isReady().catch(() => false);
  if (!ready) {
    const r = await chain.call(a, "new", initArgs, {}, a.accountId);
    console.log(`  initialised ${a.accountId} ${EXPLORER_TX}${r.txHash}`);
  }
}

async function ftRegister(accountId: string) {
  const bal = await chain.view<unknown>("storage_balance_of", { account_id: accountId }, ftId);
  if (!bal) {
    await chain.call(owner, "storage_deposit", { account_id: accountId, registration_only: true }, { deposit: "0.00125" }, ftId);
    console.log(`  registered ${accountId} on tUSDC`);
  }
}

async function main() {
  console.log("Balances:");
  for (const a of [owner, lab, contract, ft]) console.log(`  ${a.accountId.padEnd(32)} ${await near(a)} NEAR`);
  const { publicKey, codehash } = labEnv();

  console.log("Funding contract storage:");
  await topUp(lab, contract, "4.9", "2");
  await topUp(owner, ft, "1.7", "0.5");

  console.log("Deploying:");
  await deploy(ft, "mock_ft/mock_ft.wasm", {}, () => chain.view("ft_metadata", {}, ftId));
  await deploy(
    contract,
    "rerun/rerun.wasm",
    { owner: ownerId, collateral_token: ftId, treasury: ownerId, lab_fee_recipient: ownerId },
    () => chain.view("get_config"),
  );

  console.log("Configuring:");
  if (!(await chain.view<boolean>("is_codehash_approved", { codehash }))) {
    await chain.call(owner, "approve_codehash", { codehash });
    console.log(`  approved Lab codehash ${codehash.slice(0, 16)}... (local Lab, no TEE yet)`);
  }
  if (!(await chain.view<unknown>("get_lab", { lab_account: lab.accountId }))) {
    await chain.call(owner, "register_lab_local", { lab_account: lab.accountId, codehash, enc_pubkey: publicKey });
    console.log(`  registered Lab ${lab.accountId}`);
  }
  await ftRegister(chain.contractId);
  await ftRegister(ownerId);
  await ftRegister(ftId);

  const config = await chain.view<{ owner: string; collateral_token: string; fee_bps: number; run_timeout_secs: number }>("get_config");
  console.log("\nDeployed on testnet:");
  console.log(`  market contract  ${chain.contractId}  https://testnet.nearblocks.io/address/${chain.contractId}`);
  console.log(`  tUSDC            ${ftId}  https://testnet.nearblocks.io/address/${ftId}`);
  console.log(`  owner            ${config.owner}`);
  console.log(`  Lab              ${lab.accountId}`);
  console.log(`  fee              ${config.fee_bps / 100}%, run timeout ${config.run_timeout_secs}s, unit ${UNIT}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
