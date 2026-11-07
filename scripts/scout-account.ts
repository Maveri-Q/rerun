/**
 * Creates the safe approver's own testnet account, from the faucet, and claims its points. It has no
 * owner rights. The key goes into the gitignored .env.testnet and is never printed. Safe to run twice.
 *
 *   pnpm scout:account
 */
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const OUT = path.resolve(import.meta.dirname, "../.env.testnet");
const FAUCET_URL = process.env.NEAR_TESTNET_FAUCET_URL || "https://helper.nearprotocol.com/account";

async function main() {
  const chain = testnetChain();
  let accountId = process.env.SCOUT_ACCOUNT;
  let privateKey = process.env.SCOUT_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    const suffix = need("TESTNET_OWNER_ACCOUNT").replace(/^rerun-/, "").replace(/\.testnet$/, "");
    accountId = `rerun-scout-${suffix}-${randomBytes(2).toString("hex")}.testnet`;
    const key = KeyPair.fromRandom("ed25519");
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`The faucet said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    privateKey = key.toString();
    appendFileSync(OUT, `\n# The safe approver's own account. It has no owner rights.\nSCOUT_ACCOUNT=${accountId}\nSCOUT_PRIVATE_KEY=${privateKey}\n`);
    console.log(`created ${accountId}. Its key is in .env.testnet.`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (accountId === need("TESTNET_OWNER_ACCOUNT")) throw new Error("The safe approver must not use the owner's account.");
  const scout = chain.account(accountId, privateKey);
  try {
    await chain.call(scout, "claim_points", {}, { deposit: "0.01" });
    console.log("points claimed");
  } catch (e) {
    if (!/already claimed/.test((e as Error).message)) throw e;
    console.log("points were already claimed");
  }
  console.log(`points balance: ${await chain.view("get_balance", { mode: "points", account_id: accountId }).catch(() => "unknown")}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
