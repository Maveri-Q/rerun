/**
 * End-to-end check of gas-free calls on testnet: a brand-new faucet account with no prepaid storage claims
 * its points and forecasts on an open demo claim, both through the site's relayer, and its NEAR balance
 * must not move. Signs only with that throwaway account's key, which is never written anywhere.
 *
 *   pnpm relay:check [site url, default http://localhost:3000]
 */
import { randomBytes } from "node:crypto";
import { Account, actions, encodeSignedDelegate, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";

const SITE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const RPC = process.env.TESTNET_RPC_URL || "https://test.rpc.fastnear.com";
const CONTRACT = process.env.TESTNET_CONTRACT_ACCOUNT || "rerun.rerun-43f5f2.testnet";
const FAUCET_URL = process.env.NEAR_TESTNET_FAUCET_URL || "https://helper.nearprotocol.com/account";
const provider = new JsonRpcProvider({ url: RPC });

async function relayed(user: Account, method: string, args: Record<string, unknown>) {
  const meta = await user.createSignedMetaTransaction({ receiverId: CONTRACT, actions: [actions.functionCall(method, args, 100n * 10n ** 12n, 0n)] });
  const signedDelegate = Buffer.from(encodeSignedDelegate(meta.signedDelegate)).toString("base64");
  const res = await fetch(`${SITE}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedDelegate }) });
  const out = (await res.json()) as { submitted: boolean; hash?: string; failure?: string; reason?: string };
  if (!out.submitted || out.failure) throw new Error(`${method}: ${out.reason ?? out.failure}`);
  console.log(`${method}: gas paid by the relayer, https://testnet.nearblocks.io/txns/${out.hash}`);
}

async function main() {
  const status = (await (await fetch(`${SITE}/api/relay`)).json()) as { enabled: boolean; account: string | null };
  if (!status.enabled) throw new Error("The site's relayer is off: set RELAYER_ACCOUNT and RELAYER_PRIVATE_KEY.");
  console.log(`relayer: ${status.account}`);

  const accountId = `relay-check-${randomBytes(4).toString("hex")}.testnet`;
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }) });
  if (!res.ok) throw new Error(`The faucet said ${res.status}`);
  await new Promise((r) => setTimeout(r, 4000));
  const user = new Account(accountId, provider, key.toString() as KeyPairString);
  console.log(`new account: ${accountId}`);

  const storage = await provider.callFunction({ contractId: CONTRACT, method: "storage_balance_of", args: { account_id: accountId } });
  console.log(`prepaid storage before: ${storage}`);
  const before = (await user.getState()).balance.total;

  await relayed(user, "claim_points", {});
  const markets = (await provider.callFunction({ contractId: CONTRACT, method: "list_markets", args: { state: "Open", mode: "points", limit: 100 } })) as Array<{ id: number; lock_time: number }>;
  // Only a demo claim (made-up data), so the check never adds a forecast to real research.
  let open: { id: number } | undefined;
  for (const m of markets.filter((m) => m.lock_time > Date.now() / 1000 + 120)) {
    const spec = (await provider.callFunction({ contractId: CONTRACT, method: "get_spec", args: { market_id: m.id } })) as string | null;
    if (spec && (JSON.parse(spec) as { title?: string }).title?.startsWith("Demo:")) open = m;
  }
  if (!open) throw new Error("No open demo claim to forecast on. The Lab posts one every hour (ROLLING_DEMOS=1).");
  await relayed(user, "buy", { market_id: open.id, outcome: "YES", amount: "10000000", min_shares_out: "0" });

  const after = (await user.getState()).balance.total;
  const position = await provider.callFunction({ contractId: CONTRACT, method: "get_position", args: { account_id: accountId, market_id: open.id } });
  console.log(`claim ${open.id} position: ${JSON.stringify(position)}`);
  console.log(`NEAR balance before ${before}, after ${after}: ${before === after ? "unchanged" : "CHANGED"}`);
  if (before !== after) process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
