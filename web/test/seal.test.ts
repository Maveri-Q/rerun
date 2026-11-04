import { describe, expect, it } from "vitest";
import { generateLabKeyPair, openSealed } from "@rerun/shared";
import { sealForLab, sha256Hex } from "../lib/seal";
import { fmtUnits, parseUnits, quoteBuy, quoteSell, relativeTime, toleranceText, type Market } from "../lib/market";

describe("browser sealing", () => {
  it("produces files the Lab can open", async () => {
    const lab = generateLabKeyPair();
    const plain = new TextEncoder().encode("patient,readmitted\nP1,0\n");
    const sealed = await sealForLab(plain, lab.publicKey);
    expect(Buffer.from(sealed).includes(Buffer.from(plain))).toBe(false);
    expect(openSealed(sealed, lab.privateKey, lab.publicKey).toString()).toBe("patient,readmitted\nP1,0\n");
  });

  it("hashes like everyone else", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("amounts", () => {
  it("formats without floating point", () => {
    expect(fmtUnits("1234560000")).toBe("1,234.56");
    expect(fmtUnits(1_005_000n)).toBe("1.01");
    expect(fmtUnits("-2500000")).toBe("-2.50");
    expect(fmtUnits("999999999999999999", 6)).toBe("999,999,999,999.999999");
  });

  it("parses what people type", () => {
    expect(parseUnits("1.5")).toBe(1_500_000n);
    expect(parseUnits("10")).toBe(10_000_000n);
    for (const bad of ["", "0", "-1", "1.1234567", "abc", "1e3"]) expect(parseUnits(bad)).toBeNull();
  });
});

describe("display", () => {
  it("describes tolerance", () => {
    expect(toleranceText("abs", "0.01")).toBe("± 0.01");
    expect(toleranceText("rel", "0.05")).toBe("± 5%");
  });

  it("describes time", () => {
    const now = 1_800_000_000_000;
    expect(relativeTime(1_800_000_000 + 7 * 86400, now)).toBe("in 7 days");
    expect(relativeTime(1_800_000_000 - 3600 * 3, now)).toBe("3 hours ago");
    expect(relativeTime(1_800_000_000 + 60, now)).toBe("in 60 seconds");
  });
});

// Numbers from the FPMM on testnet: market 1, a NO buy of 10 from a 50/50 pool of 50.
describe("quotes mirror the contract", () => {
  const m = (yes: bigint, no: bigint) => ({ yes_pool: String(yes), no_pool: String(no) }) as Market;

  it("buy matches the contract's rounding", () => {
    const pool = m(50_000_000n, 50_000_000n);
    const q = quoteBuy(pool, "YES", 10_000_000n, 100)!;
    const invest = 9_900_000n;
    const thisAfter = (50_000_000n * 50_000_000n + (50_000_000n + invest) - 1n) / (50_000_000n + invest);
    expect(q.out).toBe(50_000_000n + invest - thisAfter);
    expect(q.yesPriceAfterPpm).toBeGreaterThan(500_000);
  });

  it("a round trip never makes money", () => {
    const pool = m(80_000_000n, 40_000_000n);
    const bought = quoteBuy(pool, "NO", 5_000_000n, 100)!;
    const after = m(80_000_000n + 4_950_000n, 40_000_000n + 4_950_000n - bought.out);
    const sold = quoteSell(after, "NO", bought.out, 100)!;
    expect(sold.out).toBeLessThan(5_000_000n);
  });

  it("refuses empty pools and amounts", () => {
    expect(quoteBuy(m(0n, 0n), "YES", 1n, 100)).toBeNull();
    expect(quoteSell(m(1n, 1n), "YES", 0n, 100)).toBeNull();
  });
});
