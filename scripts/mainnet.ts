/**
 * Mainnet, one step at a time. Each step prints exactly what it would sign and sends it only with --send,
 * so every mainnet transaction gets a yes first. Keys go into the gitignored .env and are never printed.
 *
 *   pnpm mainnet key                     makes the owner key; prints the funding address (signs nothing)
 *   pnpm mainnet status                  balances, accounts, the build to deploy (signs nothing)
 *   pnpm mainnet home [--send]           creates the home account (owner, treasury, Lab fee recipient)
 *   pnpm mainnet contract [--send]       creates the contract account, deploys the mainnet build, initialises it
 *   pnpm mainnet relayer [--send]        creates the gas-free relayer's account with 1 NEAR
 *   pnpm mainnet fan [--send]            creates the second forecasting account with 0.1 NEAR
 *   pnpm mainnet lab <ed25519:key> [--send]   creates the Lab account with the secure hardware's key as its only key
 *   pnpm mainnet setup [--send]          money settings for a 5 USDC claim; registers the contract and fan with USDC
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { Account, actions, JsonRpcProvider, KeyPair, nearToYocto, yoctoToNear, type KeyPairString } from "near-api-js";
import { loadEnv } from "../lab/orchestrator/src/env.ts";

loadEnv();
const root = path.resolve(import.meta.dirname, "..");
const ENV = path.join(root, ".env");
const RPC = process.env.NEAR_MAINNET_RPC_URL || "https://rpc.mainnet.fastnear.com";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WASM = path.join(root, "contracts/target/near/rerun-mainnet/rerun.wasm");
const HOME = process.env.MAINNET_OWNER_ACCOUNT || "rerun-app.near";
const ACCOUNTS = { contract: `market.${HOME}`, relayer: `relay.${HOME}`, fan: `fan.${HOME}`, lab: `lab.${HOME}` };
const TGAS = 10n ** 12n;
const UNIT = 1_000_000n;

const provider = new JsonRpcProvider({ url: RPC });
const [step, ...rest] = process.argv.slice(2);
const send = rest.includes("--send");
const args = rest.filter((a) => a !== "--send");

function saveKey(name: string, key: KeyPair) {
  appendFileSync(ENV, `\n${name}=${key.toString()}\n`);
  process.env[name] = key.toString();
}

function ownerKey(): KeyPair {
  const k = process.env.MAINNET_OWNER_PRIVATE_KEY;
  if (!k) throw new Error("No owner key yet. Run `pnpm mainnet key` first.");
  return KeyPair.fromString(k as KeyPairString);
}

const implicitOf = (key: KeyPair) => Buffer.from(key.getPublicKey().data).toString("hex");

async function exists(id: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

async function balance(id: string): Promise<string> {
  try {
    const a = await provider.viewAccount({ accountId: id });
    return `${yoctoToNear(a.amount, 3)} NEAR`;
  } catch {
    return "doesn't exist";
  }
}

const signer = (id: string) => new Account(id, provider, ownerKey().toString() as KeyPairString);

/** Prints the plan; with --send, signs and sends it and prints the explorer link. */
async function transaction(from: string, receiverId: string, plan: string[], acts: ReturnType<typeof actions.transfer>[]) {
  console.log(`\nFrom ${from} to ${receiverId}:`);
  for (const line of plan) console.log(`  - ${line}`);
  if (!send) {
    console.log("\nNothing signed. Add --send to sign this on mainnet.");
    return;
  }
  const out = (await signer(from).signAndSendTransaction({ receiverId, actions: acts })) as { transaction: { hash: string }; status: { Failure?: unknown } };
  if (out.status?.Failure) throw new Error(`failed: ${JSON.stringify(out.status.Failure)}`);
  console.log(`\nSent: https://nearblocks.io/txns/${out.transaction.hash}`);
}

/** A sub-account of the home account, with a key and some NEAR. */
async function subAccount(id: string, near: string, keyName: string | null, publicKey?: string) {
  if (await exists(id)) return console.log(`${id} already exists.`);
  let pub = publicKey;
  if (!pub) {
    const key = keyName && process.env[keyName] ? KeyPair.fromString(process.env[keyName] as KeyPairString) : KeyPair.fromRandom("ed25519");
    if (keyName && !process.env[keyName]) saveKey(keyName, key);
    pub = key.getPublicKey().toString();
  }
  await transaction(HOME, id, [`create ${id}`, `send it ${near} NEAR`, `give it the key ${pub}${keyName ? ` (its private half is in .env as ${keyName})` : " (made inside the secure hardware; nobody else has it)"}`], [
    actions.createAccount(),
    actions.transfer(nearToYocto(near as `${number}`)),
    actions.addFullAccessKey(pub as never),
  ]);
}

async function main() {
  switch (step) {
    case "key": {
      if (process.env.MAINNET_OWNER_PRIVATE_KEY) {
        console.log(`The owner key exists. Funding address: ${implicitOf(ownerKey())}`);
        return;
      }
      const key = KeyPair.fromRandom("ed25519");
      saveKey("MAINNET_OWNER_PRIVATE_KEY", key);
      appendFileSync(ENV, `MAINNET_OWNER_ACCOUNT=${HOME}\n`);
      console.log(`Owner key made and saved in .env (not printed).\nFunding address (send NEAR here, on the NEAR network): ${implicitOf(key)}`);
      return;
    }
    case "status": {
      const wasm = readFileSync(WASM);
      console.log(`Build: ${WASM} (${wasm.length} bytes, sha256 ${createHash("sha256").update(wasm).digest("hex")})`);
      if (process.env.MAINNET_OWNER_PRIVATE_KEY) console.log(`funding ${implicitOf(ownerKey())}: ${await balance(implicitOf(ownerKey()))}`);
      for (const id of [HOME, ...Object.values(ACCOUNTS)]) console.log(`${id}: ${await balance(id)}`);
      return;
    }
    case "home": {
      if (await exists(HOME)) return console.log(`${HOME} already exists.`);
      const funding = implicitOf(ownerKey());
      const keep = 0.05;
      const have = Number(yoctoToNear((await provider.viewAccount({ accountId: funding })).amount, 3));
      const move = (have - keep).toFixed(2);
      if (Number(move) < 1) throw new Error(`The funding address has ${have} NEAR. Send NEAR to ${funding} first.`);
      await transaction(funding, "near", [`create ${HOME} through the near account's create_account, with the owner key`, `send it ${move} NEAR (keeping ${keep} for this account's own gas)`], [
        actions.functionCall("create_account", { new_account_id: HOME, new_public_key: ownerKey().getPublicKey().toString() }, 50n * TGAS, nearToYocto(move as `${number}`)),
      ]);
      return;
    }
    case "contract": {
      if (await exists(ACCOUNTS.contract)) return console.log(`${ACCOUNTS.contract} already exists.`);
      const wasm = readFileSync(WASM);
      const key = process.env.MAINNET_CONTRACT_PRIVATE_KEY ? KeyPair.fromString(process.env.MAINNET_CONTRACT_PRIVATE_KEY as KeyPairString) : KeyPair.fromRandom("ed25519");
      const init = { owner: HOME, collateral_token: USDC, treasury: HOME, lab_fee_recipient: HOME };
      const plan = [
        `create ${ACCOUNTS.contract} and send it 5.3 NEAR (5.08 is the code's storage)`,
        `give it a key whose private half goes in .env as MAINNET_CONTRACT_PRIVATE_KEY (needed for upgrades until a multisig replaces it)`,
        `deploy ${path.relative(root, WASM)}: ${wasm.length} bytes, sha256 ${createHash("sha256").update(wasm).digest("hex")}`,
        `call new(${JSON.stringify(init)})`,
      ];
      if (send && !process.env.MAINNET_CONTRACT_PRIVATE_KEY) saveKey("MAINNET_CONTRACT_PRIVATE_KEY", key);
      await transaction(HOME, ACCOUNTS.contract, plan, [
        actions.createAccount(),
        actions.transfer(nearToYocto("5.3")),
        actions.addFullAccessKey(key.getPublicKey()),
        actions.deployContract(wasm),
        actions.functionCall("new", init, 100n * TGAS, 0n),
      ]);
      return;
    }
    case "relayer":
      return subAccount(ACCOUNTS.relayer, "1", "MAINNET_RELAYER_PRIVATE_KEY");
    case "fan":
      return subAccount(ACCOUNTS.fan, "0.1", "MAINNET_FAN_PRIVATE_KEY");
    case "lab": {
      const pub = args[0];
      if (!pub || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(pub)) throw new Error("Give the key the mainnet CVM printed: pnpm mainnet lab ed25519:...");
      return subAccount(ACCOUNTS.lab, "0.3", null, pub);
    }
    case "setup": {
      const money = { creation_bond: (2n * UNIT).toString(), repro_fee: (UNIT / 2n).toString(), min_liquidity: (5n * UNIT).toString(), challenge_bond_min: UNIT.toString(), challenge_bond_bps: 500 };
      await transaction(HOME, ACCOUNTS.contract, [`set_mode_params(money, ${JSON.stringify(money)}): a 5 USDC prize pool minimum, 2 USDC bond, 0.5 USDC Lab fee, 1 USDC minimum challenge bond`], [
        actions.functionCall("set_mode_params", { mode: "money", params: money }, 30n * TGAS, 0n),
      ]);
      await transaction(HOME, USDC, [`register ${ACCOUNTS.contract} with USDC (0.00125 NEAR)`, `register ${ACCOUNTS.fan} with USDC (0.00125 NEAR)`], [
        actions.functionCall("storage_deposit", { account_id: ACCOUNTS.contract, registration_only: true }, 30n * TGAS, nearToYocto("0.00125")),
        actions.functionCall("storage_deposit", { account_id: ACCOUNTS.fan, registration_only: true }, 30n * TGAS, nearToYocto("0.00125")),
      ]);
      return;
    }
    default:
      console.log("Steps: key, status, home, contract, relayer, fan, lab <key>, setup. See the top of scripts/mainnet.ts.");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
