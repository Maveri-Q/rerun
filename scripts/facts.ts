/**
 * Writes Verified Facts entries with the private NEAR AI model, for published papers whose claims are
 * final, and refreshes each paper's citation count from OpenAlex. Reads the chain and signs nothing.
 * Safe to run twice: an entry already written is kept unless you pass --rewrite.
 *
 *   pnpm facts [--rewrite]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeFact } from "../lab/orchestrator/src/lab/facts.ts";
import { testnetChain } from "../lab/orchestrator/src/lab/setup.ts";
import { LlmClient, llmConfigFromEnv } from "../lab/orchestrator/src/nearai/client.ts";
import { NearAiModel } from "../lab/orchestrator/src/pipeline/model.ts";
import { NEVER_CHECKED, ORIGIN_LABEL, PROVENANCE } from "../web/lib/provenance.ts";
import { verdictWords, type Outcome } from "../web/lib/market.ts";

const FILE = path.resolve(import.meta.dirname, "../web/lib/facts.json");
const MODEL = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";

interface Market {
  id: number;
  state: string;
  outcome: Outcome | null;
  invalid_reason: string | null;
  spec: { spec_hash: string; title: string; reported_value: string };
}

async function citations(doi: string): Promise<number | undefined> {
  const res = await fetch(`https://api.openalex.org/works/https://doi.org/${doi}`, { headers: { "user-agent": "rerun-facts" } }).catch(() => null);
  if (!res?.ok) return undefined;
  return ((await res.json()) as { cited_by_count?: number }).cited_by_count;
}

async function main() {
  const chain = testnetChain();
  const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { entries: {}, citedBy: {} };
  const rewrite = process.argv.includes("--rewrite");
  const save = () => writeFileSync(FILE, JSON.stringify(saved, null, 2) + "\n");

  for (const [hash, p] of Object.entries(PROVENANCE)) {
    if (!p.citeDoi) continue;
    const n = await citations(p.citeDoi);
    if (n !== undefined) saved.citedBy[hash] = n;
    console.log(`${p.name}: cited by ${n ?? "unknown"}`);
  }
  save();

  const llm = new LlmClient(llmConfigFromEnv());
  llm.newRun();
  const model = new NearAiModel(llm, MODEL);
  await model.attest();

  const markets = await chain.view<Market[]>("list_markets", { limit: 200 });
  for (const m of markets) {
    const p = PROVENANCE[m.spec.spec_hash];
    if (!p || m.state !== "Final" || !m.outcome) continue;
    if (saved.entries[m.spec.spec_hash] && !rewrite) {
      console.log(`claim ${m.id}: already written`);
      continue;
    }
    const receipts = await chain.view<{ measured_value: string | null }[]>("get_receipts", { market_id: m.id });
    const measured = receipts.at(-1)?.measured_value ?? "";
    const raw = await chain.view<string>("get_spec", { market_id: m.id });
    const words = verdictWords(m.outcome, m.invalid_reason, measured, m.spec.reported_value)!;
    saved.entries[m.spec.spec_hash] = await writeFact(model, {
      question: p.question ?? m.spec.title,
      statement: (JSON.parse(raw) as { statement: string }).statement,
      paperSays: p.paperSays?.quote ?? m.spec.reported_value,
      measured,
      reported: m.spec.reported_value,
      verdict: words.words,
      verdictReason: words.reason,
      whoseCode: ORIGIN_LABEL[p.origin],
      notChecked: [...NEVER_CHECKED, ...(p.notChecked ?? [])],
    });
    save();
    console.log(`claim ${m.id}: written. ${saved.entries[m.spec.spec_hash].summary}`);
  }
  console.log(`spent $${llm.spentThisRun.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
