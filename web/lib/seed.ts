import { chain } from "./chain";
import type { Market } from "./market";
import { isListed, provenanceOf } from "./provenance";

/** Reads for the first HTML. A failed read just leaves that part for the browser to load. */
const attempt = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await read();
  } catch {
    return undefined;
  }
};
const clean = (seed: Record<string, unknown>) => Object.fromEntries(Object.entries(seed).filter(([, v]) => v !== undefined));

async function receiptsFor(markets: Market[]) {
  const seed: Record<string, unknown> = {};
  for (const m of markets) seed[`receipts.${m.id}`] = await attempt(() => chain.receipts(m.id));
  return seed;
}

export async function homeSeed() {
  const markets = await attempt(() => chain.markets());
  const listed = (markets ?? []).filter(isListed);
  const posted = await receiptsFor(listed.filter((m) => m.state === "Proposed" || m.state === "Challenged"));
  const flagship = listed.find((m) => m.outcome && provenanceOf(m.spec.spec_hash)?.flagship);
  const rows = flagship ? await attempt(() => chain.receipts(flagship.id)) : undefined;
  return clean({ markets, ...posted, ...(flagship && rows ? { [`receipt-slip.${flagship.id}`]: { id: flagship.id, rows } } : {}) });
}

export async function factsSeed() {
  const markets = await attempt(() => chain.markets());
  return clean({ markets, ...(await receiptsFor((markets ?? []).filter((m) => isListed(m) && m.state === "Final"))) });
}

export async function claimSeed(id: number) {
  const [market, config, spec, receipts] = await Promise.all([attempt(() => chain.market(id)), attempt(() => chain.config()), attempt(() => chain.spec(id)), attempt(() => chain.receipts(id))]);
  return clean({ [`market.${id}`]: market ?? undefined, config, [`spec.${id}`]: spec ?? undefined, [`receipts.${id}`]: receipts });
}
