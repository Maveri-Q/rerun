import { describe, expect, it } from "vitest";
import { ClaimSpec, specHash, specJson } from "../src/index.ts";

const valid = {
  version: 1,
  title: "t",
  statement: "s",
  source: { type: "paper", url: "https://x.test/p", license: "MIT", authors: "a" },
  artifact: {
    repo_url: "https://x.test/r",
    commit: "a".repeat(40),
    data: [],
    runtime: "python3.11",
    setup: [],
    entrypoint: "python run.py",
    output: { path: "out.json", extractor: { type: "jsonpath", expr: "$.a" } },
  },
  metric: { name: "m", reported_value: "0.9", tolerance: { type: "abs", value: "0.01" }, comparison: "within_tolerance" },
  resources: { cpu: 1, mem_gb: 1, max_minutes: 1 },
  private_data: null,
};

describe("ClaimSpec", () => {
  it("accepts a valid claim and hashes its canonical form", () => {
    const spec = ClaimSpec.parse(valid);
    expect(specJson(spec).startsWith('{"artifact"')).toBe(true);
    expect(specHash(spec)).toMatch(/^[0-9a-f]{64}$/);
  });

  // An empty form field must be reported, not thrown: the create wizard validates as you type.
  it.each(["", "abc", "0", "-1"])("reports a bad tolerance %j without throwing", (value) => {
    const r = ClaimSpec.safeParse({ ...valid, metric: { ...valid.metric, tolerance: { type: "abs", value } } });
    expect(r.success).toBe(false);
  });

  it("rejects a float where a decimal string belongs", () => {
    expect(ClaimSpec.safeParse({ ...valid, metric: { ...valid.metric, reported_value: 0.9 } }).success).toBe(false);
  });
});
