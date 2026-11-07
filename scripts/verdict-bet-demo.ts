/**
 * Proves another app can plug into RERUN: deploys contracts/verdict-bet on testnet, has two throwaway
 * accounts bet on a settled claim, and lets the contract settle itself from RERUN's verdict. Nobody tells
 * it who won. Testnet only, using faucet accounts. Keys are throwaway and are not saved or printed.
 *
 *   cd contracts/verdict-bet && cargo near build non-reproducible-wasm --no-abi
 *   pnpm verdict-bet-demo 26
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KeyPair, nearToYocto } from "near-api-js";
import { EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const FAUCET_URL = process.env.NEAR_TESTNET_FAUCET_URL || "https://helper.nearprotocol.com/account";
const WASM = path.resolve(import.meta.dirname, "../contracts/target/near/verdict_bet/verdict_bet.wasm");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const claim = Number(process.argv[2] ?? 26);
  const chain = testnetChain();
  const verdict = await chain.view<{ is_final: boolean; outcome: string } | null>("get_verdict", { claim_id: claim });
  if (!verdict?.is_final) throw new Error(`Claim ${claim} isn't final, so the bet can't settle yet.`);

  const tag = randomBytes(3).toString("hex");
  const make = async (name: string) => {
    const accountId = `rerun-bet-${name}-${tag}.testnet`;
    const key = KeyPair.fromRandom("ed25519");
    const res = await fetch(FAUCET_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }) });
    if (!res.ok) throw new Error(`The faucet said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await wait(4000);
    return chain.account(accountId, key.toString());
  };
  const [contract, alice, bob] = [await make("app"), await make("a"), await make("b")];
  const appId = contract.accountId;
  await contract.deployContract(readFileSync(WASM));
  await wait(2000);
  const proof = (step: string, tx: string) => console.log(`${step}: ${EXPLORER_TX}${tx}`);

  proof("set up", (await chain.call(contract, "new", { rerun: chain.contractId, claim_id: claim }, {}, appId)).txHash);
  proof("alice bets it holds up", (await chain.call(alice, "bet", { holds_up: true }, { deposit: "1" }, appId)).txHash);
  proof("bob bets it doesn't", (await chain.call(bob, "bet", { holds_up: false }, { deposit: "1" }, appId)).txHash);
  const settled = await chain.call(contract, "settle", {}, {}, appId);
  proof("the contract settles itself from RERUN's verdict", settled.txHash);
  console.log(`  ${settled.logs.join(" ")}`);

  const winner = verdict.outcome === "REPRODUCED" ? alice : bob;
  const before = (await winner.getState()).balance.total;
  proof(`${winner.accountId} collects`, (await chain.call(winner, "collect", {}, {}, appId)).txHash);
  const gained = (await winner.getState()).balance.total - before;
  console.log(`  the winner gained about ${Number(gained / (nearToYocto("1") / 1000n)) / 1000} NEAR, after gas`);
  console.log(`contract: https://testnet.nearblocks.io/address/${appId}`);
  console.log(`RERUN said claim ${claim} was ${verdict.outcome}.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
