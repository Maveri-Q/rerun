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
 *   pnpm mainnet post <demo> <points|money> <minutes open> <minutes to challenge> [--send]
 *                                        opens a demo claim (made-up data) from the home account, as a draft
 *   pnpm mainnet fund <claim id> [points|money] [--send]
 *                                        funds it: 40 points, or 5 USDC prize pool + 2 bond + 0.5 Lab fee
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { specHash, specJson } from "@rerun/shared";
import { Account, actions, JsonRpcProvider, KeyPair, nearToYocto, yoctoToNear, type KeyPairString } from "near-api-js";
import { loadDemo, type DemoName } from "../lab/orchestrator/src/demo/fixtures.ts";
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

const signer = (id: string, key: KeyPair = ownerKey()) => new Account(id, provider, key.toString() as KeyPairString);

/** Prints the plan; with --send, signs and sends it and prints the explorer link. */
async function transaction(from: string, receiverId: string, plan: string[], acts: ReturnType<typeof actions.transfer>[], key?: KeyPair): Promise<unknown> {
  console.log(`\nFrom ${from} to ${receiverId}:`);
  for (const line of plan) console.log(`  - ${line}`);
  if (!send) {
    console.log("\nNothing signed. Add --send to sign this on mainnet.");
    return null;
  }
  const out = (await signer(from, key).signAndSendTransaction({ receiverId, actions: acts })) as { transaction: { hash: string }; status: { Failure?: unknown; SuccessValue?: string } };
  if (out.status?.Failure) throw new Error(`failed: ${JSON.stringify(out.status.Failure)}`);
  console.log(`\nSent: https://nearblocks.io/txns/${out.transaction.hash}`);
  const value = out.status?.SuccessValue ? Buffer.from(out.status.SuccessValue, "base64").toString() : "";
  return value ? (JSON.parse(value) as unknown) : null;
}

async function view<T>(method: string, args: Record<string, unknown>, contractId = ACCOUNTS.contract): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
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
      const keep = 0.1; // the 50 TGas attached is prepaid at the gas price, about 0.05 NEAR on its own
      const have = (await exists(funding)) ? Number(yoctoToNear((await provider.viewAccount({ accountId: funding })).amount, 3)) : 0;
      const move = (have - keep).toFixed(2);
      if (Number(move) < 1) {
        if (send) throw new Error(`The funding address has ${have} NEAR. Send NEAR to ${funding} first.`);
        console.log(`(The funding address ${funding} has ${have} NEAR yet; the plan below uses everything but ${keep}.)`);
      }
      await transaction(funding, "near", [`create ${HOME} through the near account's create_account, with the owner key`, Number(move) > 0 ? `send it ${move} NEAR (keeping ${keep} for this account's own gas)` : `send it everything the funding address holds except ${keep} NEAR for its own gas`], [
        actions.functionCall("create_account", { new_account_id: HOME, new_public_key: ownerKey().getPublicKey().toString() }, 50n * TGAS, nearToYocto(move as `${number}`)),
      ]);
      return;
    }
    case "contract": {
      const wasm = readFileSync(WASM);
      const key = process.env.MAINNET_CONTRACT_PRIVATE_KEY ? KeyPair.fromString(process.env.MAINNET_CONTRACT_PRIVATE_KEY as KeyPairString) : KeyPair.fromRandom("ed25519");
      const init = { owner: HOME, collateral_token: USDC, treasury: HOME, lab_fee_recipient: HOME };
      if (!(await exists(ACCOUNTS.contract))) {
        if (send && !process.env.MAINNET_CONTRACT_PRIVATE_KEY) saveKey("MAINNET_CONTRACT_PRIVATE_KEY", key);
        await transaction(HOME, ACCOUNTS.contract, [
          `create ${ACCOUNTS.contract} and send it 5.3 NEAR (5.08 is the code's storage)`,
          `give it a key whose private half goes in .env as MAINNET_CONTRACT_PRIVATE_KEY (needed for upgrades until a multisig replaces it)`,
          `deploy ${path.relative(root, WASM)}: ${wasm.length} bytes, sha256 ${createHash("sha256").update(wasm).digest("hex")}`,
        ], [actions.createAccount(), actions.transfer(nearToYocto("5.3")), actions.addFullAccessKey(key.getPublicKey()), actions.deployContract(wasm)]);
      }
      // new() is #[private]: only the contract account itself may call it, so it is signed with the contract's own key.
      const initialised = await view("get_config", {}).then(() => true, () => false);
      if (initialised) return console.log(`${ACCOUNTS.contract} is deployed and initialised.`);
      await transaction(ACCOUNTS.contract, ACCOUNTS.contract, [`call new(${JSON.stringify(init)}), signed by the contract account itself`], [actions.functionCall("new", init, 100n * TGAS, 0n)], key);
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
    case "post": {
      const [name, mode, open, challenge] = args as [DemoName, string, string, string];
      if (!name || (mode !== "points" && mode !== "money") || !(Number(open) >= 5) || !(Number(challenge) >= 1)) {
        throw new Error("Usage: pnpm mainnet post <demo> <points|money> <minutes open, 5 or more> <minutes to challenge>");
      }
      // A public demo's spec doesn't use the Lab's sealing key; only private-data demos do.
      const spec = loadDemo(name, { publicKey: "", privateKey: "" } as never).spec;
      if (spec.private_data) throw new Error("Private-data demos need the mainnet Lab's sealing key. Post a public one.");
      const lockTime = Math.floor(Date.now() / 1000) + Math.round(Number(open) * 60);
      const body = { spec_json: specJson(spec), lock_time: lockTime, challenge_window: Math.round(Number(challenge) * 60), mode };
      const id = await transaction(
        HOME,
        ACCOUNTS.contract,
        [
          `create_market for the demo "${spec.title}" (fingerprint ${specHash(spec)})`,
          `${mode} mode; forecasting closes ${open} minutes after sending, then ${challenge} minutes to challenge`,
          "attach 0.1 NEAR for its storage (the unused part comes back)",
        ],
        [actions.functionCall("create_market", body, 100n * TGAS, nearToYocto("0.1"))],
      );
      if (id !== null) console.log(`Claim ${id} is a draft. Next: pnpm mainnet fund ${id}`);
      return;
    }
    case "fund": {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) throw new Error("Usage: pnpm mainnet fund <claim id> [points|money]");
      const market = (await exists(ACCOUNTS.contract)) ? await view<{ mode: string } | null>("get_market", { market_id: id }) : { mode: args[1] ?? "money" };
      if (!market) throw new Error(`There's no claim ${id}.`);
      if (market.mode === "points") {
        const points = (await exists(ACCOUNTS.contract)) ? BigInt(await view<string>("get_balance", { account_id: HOME, mode: "points" })) : 0n;
        if (points < 100n * UNIT) {
          await transaction(HOME, ACCOUNTS.contract, ["claim_points: the home account's 1,000 free points (0.02 NEAR attached for storage)"], [
            actions.functionCall("claim_points", {}, 30n * TGAS, nearToYocto("0.02")),
          ]);
        }
        await transaction(HOME, ACCOUNTS.contract, [`fund_market(${id}): 40 points of prize pool, plus the points bond and Lab fee`], [
          actions.functionCall("fund_market", { market_id: id, initial_liquidity: (40n * UNIT).toString() }, 100n * TGAS, nearToYocto("0.02")),
        ]);
        return;
      }
      await transaction(HOME, USDC, [`ft_transfer_call 7.5 USDC to ${ACCOUNTS.contract}: 5 prize pool, 2 bond, 0.5 Lab fee, opening claim ${id}`], [
        actions.functionCall(
          "ft_transfer_call",
          { receiver_id: ACCOUNTS.contract, amount: "7500000", msg: JSON.stringify({ action: "fund", market_id: id, initial_liquidity: (5n * UNIT).toString() }) },
          150n * TGAS,
          1n,
        ),
      ]);
      return;
    }
    default:
      console.log("Steps: key, status, home, contract, relayer, fan, lab <key>, setup, post, fund. See the top of scripts/mainnet.ts.");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
