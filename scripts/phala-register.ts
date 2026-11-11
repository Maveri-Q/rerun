/**
 * Registers a Lab running in a Phala Cloud CVM on the market contract, after checking its attestation.
 *
 *   pnpm phala:register <lab url>            checks and prints what it would sign (signs nothing)
 *   pnpm phala:register <lab url> --send     testnet: approves the codehash and registers the Lab
 *   pnpm phala:register <lab url> --mainnet [--send]   the same on mainnet, signed by the mainnet owner
 *
 * Checks: the Intel TDX quote (DCAP), that it binds this Lab account and both public keys, the measured
 * boot's compose hash, and that every image in the compose file is pinned by digest. Only then does the
 * owner record the codehash and the attestation's fingerprint on NEAR, so anyone can fetch the same
 * attestation from the Lab and check it against the chain.
 */
import type { LabAttestation } from "../lab/orchestrator/src/tee/dstack.ts";
import { verifyLabAttestation } from "../lab/orchestrator/src/tee/verify.ts";
import { withNetworkRetry } from "../lab/orchestrator/src/nearai/attestation.ts";
import { Chain, EXPLORER_TX } from "../lab/orchestrator/src/chain/near.ts";
import { need, testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const [labUrl, ...flags] = process.argv.slice(2);
if (!labUrl) {
  console.error("Usage: pnpm phala:register <lab url> [--send]");
  process.exit(1);
}
const send = flags.includes("--send");
const mainnet = flags.includes("--mainnet");

const att = await withNetworkRetry(async () => {
  const res = await fetch(new URL("/tee/attestation", labUrl));
  if (!res.ok) throw new Error(`The Lab answered ${res.status}: is it running in the CVM?`);
  return (await res.json()) as LabAttestation;
});

const v = await verifyLabAttestation(att, { labAccount: process.env.TEE_LAB_ACCOUNT || undefined });
console.log(`Lab ${att.lab_account}, NEAR key ${att.near_public_key}`);
for (const c of v.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
console.log(`  images: ${v.images.join(", ") || "(none)"}`);
console.log(`codehash ${v.composeHash}\nattestation fingerprint ${v.fingerprint}`);
if (!v.ok) {
  console.error("\nNot registering: a check failed.");
  process.exit(1);
}

const HOME = process.env.MAINNET_OWNER_ACCOUNT || "rerun-app.near";
const chain = mainnet ? new Chain(process.env.NEAR_MAINNET_RPC_URL || "https://rpc.mainnet.fastnear.com", `market.${HOME}`) : testnetChain();
const explorer = mainnet ? "https://nearblocks.io/txns/" : EXPLORER_TX;
const calls = [
  { method: "approve_codehash", args: { codehash: v.composeHash } },
  { method: "register_lab_attested", args: { lab_account: att.lab_account, codehash: v.composeHash, enc_pubkey: att.enc_public_key, attestation_sha256: v.fingerprint } },
];
console.log(`\nOwner transactions on ${chain.contractId}:`);
for (const c of calls) console.log(`  ${c.method} ${JSON.stringify(c.args)}`);
if (!send) {
  console.log(`\nNothing signed. Add --send to sign these on ${mainnet ? "mainnet" : "testnet"}.`);
  process.exit(0);
}
const owner = mainnet ? chain.account(HOME, need("MAINNET_OWNER_PRIVATE_KEY")) : chain.account(need("TESTNET_OWNER_ACCOUNT"), need("TESTNET_OWNER_PRIVATE_KEY"));
if (await chain.view<boolean>("is_codehash_approved", { codehash: v.composeHash })) calls.shift();
for (const c of calls) {
  const tx = await chain.call(owner, c.method, c.args);
  console.log(`  ${c.method}: ${explorer}${tx.txHash}`);
}
console.log(`\nRegistered. On-chain: get_lab_attestation({"lab_account":"${att.lab_account}"}) = ${v.fingerprint}`);
