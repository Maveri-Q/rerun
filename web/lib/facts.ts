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
  // A handful of citations says nothing to a reader, so only a real following is worth a line.
  if (!n || n < 10) return null;
  return `Cited by ${n.toLocaleString("en-US")} studies`;
}
