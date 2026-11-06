import { readFileSync } from "node:fs";
import path from "node:path";
import { specHash } from "@rerun/shared";
import { describe, expect, it } from "vitest";
import { demoForSpec, DEMO_NAMES, loadDemo } from "./fixtures.ts";

const keys = { publicKey: new Uint8Array(32).fill(7) } as never;
const OLD = path.resolve(import.meta.dirname, "../../../../claims/demo/_old");

describe("demo claims", () => {
  it.each(DEMO_NAMES)("%s says it's made up, as a plain question", (name) => {
    const { spec } = loadDemo(name, keys);
    expect(spec.title).toMatch(/^Demo: .*Will the re-run agree\?$/);
    expect(spec.statement).toContain("Made-up practice data, not real research.");
  });

  it("gives a forecaster no hint which ones are wrong", () => {
    expect(loadDemo("misreported", keys).spec.statement).toBe(loadDemo("reproduces", keys).spec.statement);
  });

  it("still recognises the old demos already on testnet, which lock on their own", () => {
    const onChain = {
      broken: "095cd48cf1aac81d27e9ac8df19b66e4fbfc698a7c58c110e4f6d8a33edef6a8",
      repairable: "7307d651f5e782ddb931062bca81ec13b420e9015fd094c8f637f1147b164cf9",
      misreported: "913616f92919657ffae80932f9e0f250d322c71acf60c17a3ae1a810795a39d7",
      reproduces: "5082cac3ebc8904e3559bca9af1c2d8f4c68df3c4565be2c5547e61f4ae3bbd8",
    } as const;
    for (const [name, hash] of Object.entries(onChain)) {
      const old = loadDemo(name as keyof typeof onChain, keys, OLD);
      expect(specHash(old.spec)).toBe(hash);
      expect(demoForSpec(old.spec, keys)?.name).toBe(name);
    }
    expect(readFileSync(path.join(OLD, "_data/trials.csv")).length).toBeGreaterThan(0);
  }, 300_000);
});
