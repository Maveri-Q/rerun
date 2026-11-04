import { describe, expect, it } from "vitest";
import { extractMetric } from "../src/pipeline/extract.ts";

describe("extractMetric", () => {
  it("reads JSON paths", () => {
    const json = '{"a":{"b":[{"acc":0.93}]},"odd key":"1.5e-3"}';
    expect(extractMetric(json, "jsonpath", "$.a.b[0].acc")).toBe("0.93");
    expect(extractMetric(json, "jsonpath", '$["odd key"]')).toBe("0.0015");
    expect(() => extractMetric(json, "jsonpath", "$.missing")).toThrow(/not found/);
    expect(() => extractMetric(json, "jsonpath", "$.a")).toThrow(/not a number/);
    expect(() => extractMetric(json, "jsonpath", "$.__proto__")).toThrow(/not found/);
  });

  it("reads regex capture groups", () => {
    expect(extractMetric("final accuracy: 0.912 done", "regex", "accuracy: ([0-9.]+)")).toBe("0.912");
    expect(extractMetric("score 7", "regex", "\\d+")).toBe("7");
    expect(() => extractMetric("nothing", "regex", "acc: (\\d+)")).toThrow(/did not match/);
  });

  it("stops a runaway regex on hostile output", () => {
    expect(() => extractMetric(`${"a".repeat(40)}!`, "regex", "^(a+)+$")).toThrow();
  }, 10_000);

  it("reads CSV cells by name, index, and negative row", () => {
    const csv = 'metric,value\nauc,0.91\n"quoted, name",0.5\n';
    expect(extractMetric(csv, "csv_cell", "0:value")).toBe("0.91");
    expect(extractMetric(csv, "csv_cell", "-1:1")).toBe("0.5");
    expect(() => extractMetric(csv, "csv_cell", "9:value")).toThrow(/no row/);
    expect(() => extractMetric(csv, "csv_cell", "0:nope")).toThrow(/no column/);
    expect(() => extractMetric(csv, "csv_cell", "value")).toThrow(/row:column/);
  });

  it("rejects values that are not finite numbers", () => {
    expect(() => extractMetric('{"a":"nan"}', "jsonpath", "$.a")).toThrow();
    expect(() => extractMetric('{"a":null}', "jsonpath", "$.a")).toThrow();
  });
});
