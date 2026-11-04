import { describe, expect, it } from "vitest";
import { checkPaperText, grimPossible, pValue } from "../src/papercheck.ts";

describe("pValue matches standard statistical tables", () => {
  it.each([
    ["t", 2.228, 10, 0, 0.05],
    ["t", 2.2, 28, 0, 0.0362],
    ["t", 12.706, 1, 0, 0.05],
    ["F", 3.316, 2, 30, 0.05],
    ["F", 4.351, 1, 20, 0.05],
    ["chi2", 3.841, 1, 0, 0.05],
    ["chi2", 5.991, 2, 0, 0.05],
    ["chi2", 18.307, 10, 0, 0.05],
    ["z", 1.96, 0, 0, 0.05],
    ["z", 2.576, 0, 0, 0.01],
    ["r", 0.444, 18, 0, 0.05],
  ] as const)("%s = %d (df %d, %d) -> p about %d", (test, stat, df1, df2, expected) => {
    expect(pValue(test, stat, df1, df2)).toBeCloseTo(expected, 3);
  });
});

describe("checkPaperText", () => {
  const one = (text: string) => {
    const { statistics } = checkPaperText(text);
    expect(statistics).toHaveLength(1);
    return statistics[0]!;
  };

  it.each([
    "t(28) = 2.20, p = .036",
    "t(28) = -2.20, p = .04",
    "t(28)=2.20,p<.05",
    "F(1, 20) = 4.35, p = .05",
    "χ2(1) = 3.84, p = .05",
    "χ²(1, N = 90) = 3.84, p = .05",
    "chi-square(2) = 5.99, p = .05",
    "r(18) = .44, p = .05",
    "z = 1.96, p = .05",
    "z = −1.96, p = .05",
  ])("accepts the consistent %s", (text) => {
    expect(one(text).result).toBe("consistent");
  });

  it("flags a p-value that does not match but keeps the same conclusion", () => {
    expect(one("t(28) = 2.20, p = .010").result).toBe("inconsistent");
  });

  it("flags when the correct p-value would change the conclusion", () => {
    const f = one("t(28) = 1.50, p = .03");
    expect(f.result).toBe("changes_conclusion");
    expect(f.computedP).toBeGreaterThan(0.05);
  });

  it("recognises a one-sided p-value and does not flag it", () => {
    expect(one("t(28) = 2.20, p = .018").result).toBe("one_sided");
    expect(checkPaperText("t(28) = 2.20, p = .018").flagged).toBe(0);
  });

  it("allows for rounding in the printed statistic", () => {
    expect(one("t(10) = 2.2, p = .05").result).toBe("consistent");
  });

  it("handles 'greater than' p-values", () => {
    expect(one("F(1, 20) = 1.00, p > .05").result).toBe("consistent");
    expect(one("F(1, 20) = 9.00, p > .05").result).toBe("changes_conclusion");
  });

  it("finds several results in running text and counts flags", () => {
    const text = "Group A scored higher, t(28) = 2.20, p = .036. The interaction was significant, F(2, 30) = 1.00, p < .01. Done.";
    const r = checkPaperText(text);
    expect(r.statistics).toHaveLength(2);
    expect(r.flagged).toBe(1);
  });

  it("returns nothing for text without statistics", () => {
    expect(checkPaperText("We thank our funders. In 2023 the p value was discussed.")).toEqual({ statistics: [], means: [], flagged: 0 });
  });
});

describe("GRIM test", () => {
  it("knows which means are possible with whole-number data", () => {
    expect(grimPossible("3.45", 20)).toBe(true); // 69 / 20
    expect(grimPossible("3.47", 20)).toBe(false); // no whole total gives 3.47
    expect(grimPossible("2.50", 10)).toBe(true);
    expect(grimPossible("2.53", 10)).toBe(false);
  });

  it("finds means printed beside a sample size", () => {
    const r = checkPaperText("Ratings were high (M = 3.47, SD = 1.20, n = 20).");
    expect(r.means).toEqual([expect.objectContaining({ mean: 3.47, n: 20, possible: false })]);
    expect(r.flagged).toBe(1);
  });

  it("skips samples too large for the test to mean anything", () => {
    expect(checkPaperText("(M = 3.47, n = 200)").means).toEqual([]);
  });
});
