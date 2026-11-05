import saved from "./facts.json";

/** Written by `pnpm facts`. The verdict and numbers aren't stored here: pages read them from the chain. */
export interface FactEntry {
  summary: string;
  background: string;
  result: string;
  model: string;
  writtenAt: string;
}

const data = saved as { entries: Record<string, FactEntry>; citedBy: Record<string, number> };

export const factsFor = (specHash: string) => ({ entry: data.entries[specHash], citedBy: data.citedBy[specHash] });

export function citedByText(n: number | undefined): string | null {
  if (!n) return null;
  return n === 1 ? "Cited by 1 study" : `Cited by ${n.toLocaleString("en-US")} studies`;
}
