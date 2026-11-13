/**
 * Prints the README's results table from the chain: each published claim the Lab has rerun, in the site's
 * own words, with links to its page and its record on NEAR. Reads only.
 *
 *   pnpm readme-results
 */
import { testnetChain } from "../lab/orchestrator/src/lab/setup.ts";
import { claimName, isListed, ORIGIN_LABEL, provenanceOf, resultSentence } from "../web/lib/provenance.ts";

const SITE = "https://rerun-testnet.vercel.app";

interface Row {
  id: number;
  state: string;
  outcome: string | null;
  spec: { spec_hash: string; title: string; reported_value: string };
}

async function main() {
  const chain = testnetChain();
  const list = await chain.view<Row[]>("list_markets", { limit: 200 });
  const done = list.filter((m) => isListed(m) && (m.state === "Final" || m.state === "Proposed"));
  done.sort((a, b) => (provenanceOf(a.spec.spec_hash)?.order ?? 99) - (provenanceOf(b.spec.spec_hash)?.order ?? 99) || a.id - b.id);
  console.log("| Question | What happened | Proof |");
  console.log("|---|---|---|");
  for (const m of done) {
    const receipts = await chain.view<{ measured_value: string | null; outcome: string }[]>("get_receipts", { market_id: m.id });
    const r = receipts.at(-1);
    const origin = provenanceOf(m.spec.spec_hash)?.origin;
    const said = resultSentence(m, r?.outcome) ?? "";
    const numbers = r?.measured_value ? ` Paper ${m.spec.reported_value}, the Lab ${Number(Number(r.measured_value).toPrecision(4))}.` : "";
    const code = origin ? ` _${ORIGIN_LABEL[origin]}._` : "";
    console.log(`| [${claimName(m)}](${SITE}/market/${m.id}) | ${said}${numbers}${code} | [Receipt](${SITE}/receipt/${m.id}/${r ? receipts.length - 1 : 0}) |`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
