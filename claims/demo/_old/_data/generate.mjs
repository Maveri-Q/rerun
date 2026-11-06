// Writes trials.csv: a synthetic, seeded dataset for the demo claims. Not real patient data.
import { writeFileSync } from "node:fs";

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = mulberry32(20261104);
const rows = ["age,dose,biomarker,response"];
for (let i = 0; i < 800; i++) {
  const age = 30 + Math.floor(r() * 50);
  const dose = 10 + Math.floor(r() * 90);
  const biomarker = Number((r() * 4).toFixed(3));
  const logit = -3.2 + 0.045 * dose + 0.9 * biomarker - 0.025 * (age - 50) + (r() - 0.5) * 2;
  rows.push(`${age},${dose},${biomarker},${logit > 0 ? 1 : 0}`);
}
writeFileSync(new URL("./trials.csv", import.meta.url), `${rows.join("\n")}\n`);
