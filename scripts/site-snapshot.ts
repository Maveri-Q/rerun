/**
 * Copies what the Lab serves for finished claims into web/public, so the hosted site can still show
 * write-ups, stress tests and the scout's log while no Lab is running. Only files named by a receipt
 * on the chain are copied, byte for byte, so their fingerprints still match. Reads and signs nothing else.
 *
 *   pnpm site-snapshot
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
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

rmSync(OUT, { recursive: true, force: true });
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

const latest = path.join(DATA, "attestations", "latest.json");
if (existsSync(latest)) {
  mkdirSync(path.join(OUT, "attestations"), { recursive: true });
  copyFileSync(latest, path.join(OUT, "attestations", "latest.json"));
}
const scout = path.join(DATA, "scout", "state.json");
if (existsSync(scout)) copyFileSync(scout, path.join(PUBLIC, "scout.json"));

console.log(`copied ${copied} files from ${markets.length} claims`);
if (missing.length) console.log(`not on this computer (${missing.length}), so those pages say the file is unavailable:\n  ${missing.join("\n  ")}`);
