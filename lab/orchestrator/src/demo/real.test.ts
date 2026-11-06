import { describe, expect, it } from "vitest";
import { specHash } from "@rerun/shared";
import { extractMetric } from "../pipeline/extract.ts";
import { PROVENANCE } from "../../../../web/lib/provenance.ts";
import { loadReal, REAL_NAMES } from "./real.ts";

describe("real claims", () => {
  it("has the published papers", () => {
    expect(REAL_NAMES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(REAL_NAMES)("%s is a valid spec, pinned to real GitHub code", (name) => {
    const { spec, noDoi } = loadReal(name);
    expect(spec.artifact.repo_url).toMatch(/^https:\/\/github\.com\//);
    expect(spec.artifact.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(spec.source.doi || noDoi).toBeTruthy();
    expect(spec.title).not.toContain("[DEMO]");
    expect(specHash(spec)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the site's labels match the claims being posted, and the flagship is the debt paper", () => {
    const entries = Object.entries(PROVENANCE);
    for (const [hash, p] of entries) expect(specHash(loadReal(p.name).spec)).toBe(hash);
    const flagship = entries.filter(([, p]) => p.flagship);
    expect(flagship).toHaveLength(1);
    expect(flagship[0]![1].name).toBe("reinhart-rogoff");
    // At least one claim running the authors' own code stays on the home page, under "More science".
    expect(entries.some(([, p]) => p.origin === "authors" && p.science && !p.hideUntilFinal)).toBe(true);
    expect(PROVENANCE[specHash(loadReal("parkinsons-spread").spec)]!.origin).toBe("rebuild");
    expect(loadReal("parkinsons-spread").spec.title).toMatch(/^Independent rebuild/);
  });

  it("reads the wildfire number from R's printed output", () => {
    const { spec } = loadReal("wildfire-water");
    const output = "lm(formula = ER ~ Tavg, data = et)\nMultiple R-squared:  0.136,\nlm(formula = ET ~ Tavg, data = et)\nMultiple R-squared:  0.1495,\tAdjusted";
    expect(extractMetric(output, "regex", spec.artifact.output.extractor.expr)).toBe("0.1495");
  });

  it("reads the Parkinson's number at 3 months, not another month", () => {
    const { spec } = loadReal("parkinsons-spread");
    const output = "Month Post Injection 1\nNumber of Regions used:  50\nPearson correlation coefficient 0.559\n\nMonth Post Injection 3\nNumber of Regions used:  58\nPearson correlation coefficient 0.696123\n";
    expect(extractMetric(output, "regex", spec.artifact.output.extractor.expr)).toBe("0.696123");
  });

  it("reads negative numbers from the budworm output", () => {
    const { spec } = loadReal("budworm-timing");
    expect(extractMetric("slope -0.045612\n", "regex", spec.artifact.output.extractor.expr)).toBe("-0.045612");
  });
});
