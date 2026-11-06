/** Where each value falls on the line, as a share of its width. For display only: the contract decides verdicts. */
export function linePositions(reported: number, margin: number, measured: number | null) {
  const low = reported - margin;
  const high = reported + margin;
  const lowest = Math.min(low, measured ?? low);
  const highest = Math.max(high, measured ?? high);
  // Room around the allowed range, so a run that lands inside it can still be seen to be near or far from the edges.
  const pad = Math.max((highest - lowest) * 0.25, margin * 1.2, Math.abs(reported) * 0.01, 1e-9);
  const from = lowest - pad;
  const span = highest + pad - from;
  const at = (v: number) => ((v - from) / span) * 100;
  return { low: at(low), high: at(high), paper: at(reported), lab: measured === null ? null : at(measured) };
}
