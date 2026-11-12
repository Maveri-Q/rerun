import { describe, expect, it } from "vitest";
import { answerText } from "../components/usePoll";
import { linePositions } from "../lib/line";
import { binOf } from "../lib/scout-bins";
import { challengeBond, countsIf, durationWords, isPractice, type Config, type Market } from "../lib/market";
import { claimName, isListed, PROVENANCE, resultSentence } from "../lib/provenance";

describe("linePositions", () => {
  it("puts a run inside the range inside the band", () => {
    const p = linePositions(2.76, 0.05, 2.7536);
    expect(p.lab!).toBeGreaterThan(p.low);
    expect(p.lab!).toBeLessThan(p.high);
    expect(p.paper).toBeCloseTo((p.low + p.high) / 2);
  });

  it("keeps a far-off run on the line, outside the band", () => {
    const p = linePositions(-0.1, 0.05, 2.168);
    expect(p.lab!).toBeGreaterThan(p.high);
    expect(p.lab!).toBeLessThan(100);
    expect(p.low).toBeGreaterThan(0);
  });

  it("has no Lab position before a run", () => {
    expect(linePositions(1.559, 0.078, null).lab).toBeNull();
  });
});

describe("binOf", () => {
  it("sorts the scout's real reasons, and never loses an unknown one", () => {
    expect(binOf(["It doesn't link to a GitHub repository, which the Lab needs."])).toBe(0);
    expect(binOf(["GitHub can't identify an open licence."])).toBe(1);
    expect(binOf(["Depends on pytorch, which usually needs a graphics card. The Lab only has CPUs."])).toBe(2);
    expect(binOf(["Mostly C++. The Lab only runs Python and R."])).toBe(3);
    expect(binOf(["Open licence: MIT.", "Two AIs disagreed: the first picked 1, the second 2."])).toBe(1);
    expect(binOf(["A reason nobody has written yet."])).toBe(9);
  });
});

describe("challenge window", () => {
  it("says the length in words", () => {
    expect(durationWords(60)).toBe("1 minute");
    expect(durationWords(86_400)).toBe("24 hours");
    expect(durationWords(604_800)).toBe("7 days");
  });

  it("charges a share of the pool, with a floor", () => {
    const config = { points: { challenge_bond_bps: 500, challenge_bond_min: "5000000" }, money: { challenge_bond_bps: 500, challenge_bond_min: "5000000" } } as unknown as Config;
    expect(challengeBond({ mode: "points", collateral: "40000000" } as Market, config)).toBe(5_000_000n);
    expect(challengeBond({ mode: "points", collateral: "1000000000" } as Market, config)).toBe(50_000_000n);
  });
});

describe("answerText", () => {
  it("copes with a balance held as a bigint", () => {
    expect(answerText({ internal: 5n })).toBe('{"internal":"5"}');
    expect(answerText(undefined)).toBe("null");
  });
});

describe("what gets listed", () => {
  it("lists real claims only, and keeps back the one whose answer is already out", () => {
    const hash = (name: string) => Object.entries(PROVENANCE).find(([, p]) => p.name === name)![0];
    const claim = (state: string, title: string, spec_hash = "x") => ({ state, spec: { title, spec_hash } });
    expect(isListed(claim("Open", "A paper's claim"))).toBe(true);
    expect(isListed(claim("Open", "Demo: our practice dataset says something. Will the rerun agree?"))).toBe(false);
    expect(isListed(claim("Final", "[TEST] Pipeline check"))).toBe(false);
    expect(isListed(claim("Open", "Rebuild", hash("parkinsons-spread")))).toBe(false);
    expect(isListed(claim("Final", "Rebuild", hash("parkinsons-spread")))).toBe(true);
  });

  it("says each result in one sentence", () => {
    const debt = Object.entries(PROVENANCE).find(([, p]) => p.name === "reinhart-rogoff")![0];
    expect(resultSentence({ state: "Final", outcome: "NOT_REPRODUCED", spec: { spec_hash: debt } })).toMatch(/^The study said .*The Lab retraced it: ✗ different result\.$/);
    expect(resultSentence({ state: "Open", outcome: null, spec: { spec_hash: debt } })).toMatch(/The Lab will retrace it when forecasting closes\.$/);
    expect(resultSentence({ state: "Open", spec: { spec_hash: "unknown" } })).toBeNull();
  });

  it("treats our demos and pipeline checks as practice, and nothing else", () => {
    expect(isPractice({ spec: { title: "[DEMO] A sample model" } } as Market)).toBe(true);
    expect(isPractice({ spec: { title: "[TEST] Pipeline check" } } as Market)).toBe(true);
    expect(isPractice({ spec: { title: "Demo: our practice dataset says something." } } as Market)).toBe(true);
    expect(isPractice({ spec: { title: "Does raising the minimum wage cost jobs?" } } as Market)).toBe(false);
  });

  it("words the range the way the site does", () => {
    expect(countsIf("2.76", "abs", "0.05")).toBe("Counts if between 2.71 and 2.81");
  });

  it("names a claim without its label", () => {
    expect(claimName({ spec: { spec_hash: "unknown", title: "[DEMO] A sample model" } })).toBe("A sample model");
  });

  it("words demo titles the site's way, never 'rerun'", () => {
    const title = "Demo: our practice dataset says sunny days sell 20% more ice cream. Will the Lab's rerun agree?";
    expect(claimName({ spec: { spec_hash: "unknown", title } })).toBe("Practice data says sunny days sell 20% more ice cream. Will the Lab agree?");
    expect(claimName({ spec: { spec_hash: "unknown", title: "Demo: our practice dataset says X. Will the re-run agree?" } })).toBe("Practice data says X. Will the Lab agree?");
  });
});

describe("the sentence on a claim with a posted result", () => {
  const hash = Object.entries(PROVENANCE).find(([, p]) => p.name === "budworm-spread")![0];
  const claim = (state: string, outcome: string | null = null) => ({ state, outcome, spec: { spec_hash: hash } });

  it("never says it will retrace a claim that has already run", () => {
    expect(resultSentence(claim("Proposed"), "INVALID")).toContain("The Lab couldn't retrace it fairly");
    expect(resultSentence(claim("Proposed"), "INVALID")).toContain("can still be challenged");
    expect(resultSentence(claim("Proposed"))).toContain("has posted its result");
    expect(resultSentence(claim("Proposed"))).not.toContain("when forecasting closes");
    expect(resultSentence(claim("Open"))).toContain("when forecasting closes");
    expect(resultSentence(claim("Final", "REPRODUCED"))).not.toContain("challenged");
  });
});
