/**
 * Copies what the Lab serves for finished claims into web/public, so the hosted site can still show
 * write-ups, stress tests and the scout's log while no Lab is running. Only files named by a receipt
 * on the chain are copied, byte for byte, so their fingerprints still match. Reads and signs nothing else.
 *
 * Mainnet receipts are copied from the mainnet Lab over HTTP (MAINNET_LAB_URL), and each file is kept only
 * if its sha256 matches the hash on the chain, so the receipt links keep working while that Lab is stopped.
 *
 *   pnpm site-snapshot
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Chain } from "../lab/orchestrator/src/chain/near.ts";
import { testnetChain } from "../lab/orchestrator/src/lab/setup.ts";

const DATA = path.resolve(import.meta.dirname, "../lab/orchestrator/.data");
const PUBLIC = path.resolve(import.meta.dirname, "../web/public");
const OUT = path.join(PUBLIC, "lab-files");

interface Receipt {
  report_hash: string;
  log_hash: string;
  nearai: { attestation_digest: string };
}

let copied = 0;
const missing: string[] = [];

function copy(kind: string, hash: string, to: string, ext: string): string | null {
  const from = path.join(DATA, kind, hash + (kind === "attestations" ? ".json" : ""));
  if (!/^[0-9a-f]{16,}$/.test(hash) || !existsSync(from)) {
    missing.push(`${kind}/${hash}`);
    return null;
  }
  mkdirSync(path.join(OUT, to), { recursive: true });
  copyFileSync(from, path.join(OUT, to, `${hash}${ext}`));
  copied++;
  return from;
}

const chain = testnetChain();
const markets = await chain.view<{ id: number }[]>("list_markets", { limit: 200 });

// Copies are named by their hash, so old ones are never wrong; keeping them means a Lab that's off can't erase them.
for (const market of markets) {
  const receipts = await chain.view<Receipt[]>("get_receipts", { market_id: market.id });
  for (const r of receipts) {
    const report = copy("reports", r.report_hash, "reports", ".txt");
    copy("logs", r.log_hash, "logs", ".txt");
    copy("attestations", r.nearai.attestation_digest, "attestations", ".json");
    const evidence = report && /Evidence file sha256: ([0-9a-f]{64})/.exec(readFileSync(report, "utf8"))?.[1];
    if (evidence) copy("evidences", evidence, "evidence", ".json");
  }
}

const MAINNET_LAB = (process.env.MAINNET_LAB_URL || "").replace(/\/$/, "");
const KINDS = { reports: ["reports", ".txt"], logs: ["logs", ".txt"], evidence: ["evidence", ".json"] } as const satisfies Record<string, readonly [string, string]>;

async function fetchCopy(kind: keyof typeof KINDS, hash: string): Promise<string | null> {
  const [dir, ext] = KINDS[kind];
  const to = path.join(OUT, dir, `${hash}${ext}`);
  if (existsSync(to)) return readFileSync(to, "utf8");
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${MAINNET_LAB}/${kind}/${hash}`).catch(() => null);
    if (!res?.ok) continue;
    const body = Buffer.from(await res.arrayBuffer());
    if (createHash("sha256").update(body).digest("hex") !== hash) {
      missing.push(`mainnet ${kind}/${hash} (fingerprint mismatch)`);
      return null;
    }
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, body);
    copied++;
    return body.toString("utf8");
  }
  missing.push(`mainnet ${kind}/${hash}`);
  return null;
}

if (MAINNET_LAB) {
  const main = new Chain(process.env.NEAR_MAINNET_RPC_URL || "https://free.rpc.fastnear.com", process.env.MAINNET_CONTRACT_ACCOUNT || "market.rerun-app.near");
  const mainMarkets = await main.view<{ id: number }[]>("list_markets", { limit: 200 });
  for (const market of mainMarkets) {
    for (const r of await main.view<Receipt[]>("get_receipts", { market_id: market.id })) {
      const report = await fetchCopy("reports", r.report_hash);
      await fetchCopy("logs", r.log_hash);
      const evidence = report && /Evidence file sha256: ([0-9a-f]{64})/.exec(report)?.[1];
      if (evidence) await fetchCopy("evidence", evidence);
    }
  }
  console.log(`mainnet: checked ${mainMarkets.length} claims`);
}

const latest = path.join(DATA, "attestations", "latest.json");
if (existsSync(latest)) {
  mkdirSync(path.join(OUT, "attestations"), { recursive: true });
  copyFileSync(latest, path.join(OUT, "attestations", "latest.json"));
}
const scout = path.join(DATA, "scout", "state.json");
if (existsSync(scout)) copyFileSync(scout, path.join(PUBLIC, "scout.json"));

console.log(`copied ${copied} files from ${markets.length} claims`);
if (missing.length) console.log(`not on this computer (${missing.length}), so those pages say the file is unavailable:\n  ${missing.join("\n  ")}`);
