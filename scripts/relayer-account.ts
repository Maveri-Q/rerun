/**
 * Creates the gas-free relayer's own testnet account from the faucet (10 test NEAR). It has no owner rights:
 * it only pays gas for points-mode calls and prepays storage. The key goes into the gitignored .env.testnet
 * and is never printed. Safe to run twice. For the hosted site, copy RELAYER_ACCOUNT and RELAYER_PRIVATE_KEY
 * into the site's server environment (never a NEXT_PUBLIC_ variable).
 *
 *   pnpm relayer:account
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { loadEnv } from "../lab/orchestrator/src/env.ts";
import { need } from "../lab/orchestrator/src/lab/setup.ts";

const OUT = path.resolve(import.meta.dirname, "../.env.testnet");
const FAUCET_URL = process.env.NEAR_TESTNET_FAUCET_URL || "https://helper.nearprotocol.com/account";

async function main() {
  loadEnv();
  if (process.env.RELAYER_ACCOUNT && process.env.RELAYER_PRIVATE_KEY) {
    console.log(`${process.env.RELAYER_ACCOUNT} already exists. Its key is in .env.testnet.`);
    return;
  }
  const suffix = need("TESTNET_OWNER_ACCOUNT").replace(/^rerun-/, "").replace(/\.testnet$/, "");
  const accountId = `rerun-relay-${suffix}.testnet`;
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`The faucet said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  appendFileSync(OUT, `\n# The gas-free relayer's own account. It has no owner rights.\nRELAYER_ACCOUNT=${accountId}\nRELAYER_PRIVATE_KEY=${key.toString()}\n`);
  console.log(`created ${accountId}. Its key is in .env.testnet.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
