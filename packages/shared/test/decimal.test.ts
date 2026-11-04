import { describe, expect, it } from "vitest";
import { normalizeDecimal, parseDecimal, withinTolerance } from "../src/index.ts";

const S = 10n ** 18n;

// Same vectors as the Rust tests in contracts/rerun/src/math.rs.
describe("parseDecimal (matches the contract)", () => {
  it("parses valid decimals", () => {
    expect(parseDecimal("0.912")).toBe(912_000_000_000_000_000n);
    expect(parseDecimal("-1.5")).toBe(-1_500_000_000_000_000_000n);
    expect(parseDecimal("3")).toBe(3n * S);
    expect(parseDecimal("0.000000000000000001")).toBe(1n);
  });

  it.each(["", "-", ".5", "5.", "1e3", "+1", " 1", "1.0000000000000000001", "0x10", "1,5", "--1"])("rejects %j", (bad) => {
    expect(() => parseDecimal(bad)).toThrow();
  });
});

describe("withinTolerance (matches the contract)", () => {
  const d = parseDecimal;

  it("absolute tolerance is inclusive", () => {
    expect(withinTolerance(d("0.922"), d("0.912"), "abs", d("0.01"))).toBe(true);
    expect(withinTolerance(d("0.902"), d("0.912"), "abs", d("0.01"))).toBe(true);
    expect(withinTolerance(d("0.9221"), d("0.912"), "abs", d("0.01"))).toBe(false);
  });

  it("relative tolerance scales with the reported value", () => {
    expect(withinTolerance(d("-210"), d("-200"), "rel", d("0.05"))).toBe(true);
    expect(withinTolerance(d("-210.000000000000000001"), d("-200"), "rel", d("0.05"))).toBe(false);
    const big = d("99999999999999999999.999999999999999999");
    expect(withinTolerance(big, big, "rel", d("0.05"))).toBe(true);
  });
});

describe("normalizeDecimal", () => {
  it.each([
    ["0.912", "0.912"],
    [0.912, "0.912"],
    ["1.5e-3", "0.0015"],
    ["1.5E+3", "1500"],
    ["-2.50", "-2.5"],
    [".5", "0.5"],
    ["7.", "7"],
    ["007", "7"],
    [1e-7, "0.0000001"],
    ["0.1234567890123456789999", "0.123456789012345678"],
    ["-0.0", "0"],
  ])("%j -> %s", (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });

  it.each(["abc", "", "NaN", "1.2.3", "1e999", "inf"])("rejects %j", (bad) => {
    expect(() => normalizeDecimal(bad)).toThrow();
  });
});
