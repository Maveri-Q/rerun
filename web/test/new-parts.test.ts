import { describe, expect, it } from "vitest";
import { answerText } from "../components/usePoll";
import { linePositions } from "../lib/line";
import { binOf } from "../lib/scout-bins";
import { challengeBond, durationWords, type Config, type Market } from "../lib/market";

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
