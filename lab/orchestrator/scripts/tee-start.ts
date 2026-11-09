/**
 * How the Lab starts inside a Phala Cloud CVM. It asks the secure hardware for the Lab's keys and a quote
 * that binds them to this exact code, publishes that attestation, makes sure the sandbox images are
 * there, then runs the usual Lab loop. No key for the Lab account is ever given to the CVM: the CVM
 * derives it, and only this code running in this app can derive it again.
 *
 * Settings, given as Phala encrypted secrets or compose environment:
 *   TEE_LAB_ACCOUNT        the Lab's NEAR account, whose only key is the derived one
 *   TEE_CREATE_ACCOUNT=1   testnet only: create that account from the faucet on first start
 *   SANDBOX_IMAGE_PYTHON, SANDBOX_IMAGE_R   sandbox images pinned by digest, pulled through the CVM's Docker
 *   plus the Lab's usual settings (NEARAI_CLOUD_API_KEY, TESTNET_CONTRACT_ACCOUNT, LAB_PUBLIC_URL, ...)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dstackEndpoint, teeIdentity } from "../src/tee/dstack.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../.data");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it to the CVM's encrypted secrets.`);
  return v;
}

/** Pulls each pinned sandbox image and gives it the local name the Lab runs. */
function prepareSandboxImages() {
  const docker = process.env.DOCKER_BIN || "docker";
  for (const [runtime, env] of [["python3.11", "SANDBOX_IMAGE_PYTHON"], ["r4.4", "SANDBOX_IMAGE_R"]] as const) {
    const pinned = process.env[env];
    const local = `rerun-sandbox:${runtime}`;
    if (!pinned) {
      console.log(`${env} not set: the ${runtime} sandbox is unavailable`);
      continue;
    }
    if (!/@sha256:[0-9a-f]{64}$/.test(pinned)) throw new Error(`${env} must be pinned by digest (image@sha256:...), so the attested code fixes it`);
    for (const args of [["pull", pinned], ["tag", pinned, local]]) {
      const r = spawnSync(docker, args, { stdio: "inherit" });
      if (r.status !== 0) throw new Error(`docker ${args.join(" ")} failed`);
    }
  }
}

async function ensureTestnetAccount(accountId: string, publicKey: string) {
  const rpc = process.env.NEAR_TESTNET_RPC_URL || "https://test.rpc.fastnear.com";
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }),
  });
  const body = (await res.json()) as { error?: unknown; result?: unknown };
  if (body.result) return;
  if (process.env.TEE_CREATE_ACCOUNT !== "1") throw new Error(`${accountId} doesn't exist. Create it with ${publicKey} as its only key.`);
  const faucet = process.env.NEAR_TESTNET_FAUCET_URL || "https://helper.nearprotocol.com/account";
  const made = await fetch(faucet, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }) });
  if (!made.ok) throw new Error(`The faucet refused ${accountId}: ${made.status} ${(await made.text()).slice(0, 200)}`);
  console.log(`created ${accountId}, whose only key was made inside the secure hardware`);
}

async function main() {
  const endpoint = dstackEndpoint();
  if (!endpoint) throw new Error("No dstack socket: this only runs inside a Phala Cloud CVM (or with DSTACK_SIMULATOR_ENDPOINT set).");
  const labAccount = need("TEE_LAB_ACCOUNT");
  const { keys, attestation } = await teeIdentity(endpoint, labAccount);
  console.log(`Lab ${labAccount}: NEAR key ${keys.nearPublicKey}, code fingerprint ${attestation.compose_hash}`);

  // Public only: the quote and the public keys. The secret halves stay in this process's memory.
  mkdirSync(path.join(DATA_DIR, "tee"), { recursive: true });
  writeFileSync(path.join(DATA_DIR, "tee", "attestation.json"), JSON.stringify(attestation, null, 2));

  if ((process.env.NEAR_NETWORK || "testnet") === "testnet") await ensureTestnetAccount(labAccount, keys.nearPublicKey);
  prepareSandboxImages();

  Object.assign(process.env, {
    TESTNET_LAB_ACCOUNT: labAccount,
    TESTNET_LAB_PRIVATE_KEY: keys.nearPrivateKey,
    LAB_ENC_PUBLIC_KEY: keys.encPublicKey,
    LAB_ENC_PRIVATE_KEY: keys.encPrivateKey,
    LAB_CODEHASH: attestation.compose_hash,
    LAB_TEE: "dstack",
  });
  await import("./watch.ts");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
