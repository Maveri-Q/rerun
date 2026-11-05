import { describe, expect, it } from "vitest";
import { parseQuoteRequest, quoteBody, quoteView, usdcUnits } from "./intents";

const TOKENS = [
  { assetId: "near-usdc", blockchain: "near", symbol: "USDC" },
  { assetId: "base-usdc", blockchain: "base", symbol: "USDC" },
  { assetId: "base-eth", blockchain: "base", symbol: "ETH" },
];

describe("usdcUnits", () => {
  it("converts to smallest units", () => {
    expect(usdcUnits("10")).toBe("10000000");
    expect(usdcUnits("1.5")).toBe("1500000");
  });
  it("refuses amounts outside the range or badly written", () => {
    for (const bad of ["0.5", "10001", "1.234", "abc", "", "-5", "1e3"]) expect(usdcUnits(bad)).toBeNull();
  });
});

describe("parseQuoteRequest", () => {
  it("accepts only listed chains and directions", () => {
    expect(parseQuoteRequest({ direction: "fund", chain: "base", amount: "10" })).not.toBeNull();
    expect(parseQuoteRequest({ direction: "steal", chain: "base", amount: "10" })).toBeNull();
    expect(parseQuoteRequest({ direction: "fund", chain: "constructor", amount: "10" })).toBeNull();
    expect(parseQuoteRequest(null)).toBeNull();
  });
});

describe("quoteBody", () => {
  it("is always a dry quote and never carries a user's details", () => {
    const body = quoteBody({ direction: "fund", chain: "base", amount: "10" }, TOKENS, 0)!;
    expect(body.dry).toBe(true);
    expect(body.originAsset).toBe("base-usdc");
    expect(body.destinationAsset).toBe("near-usdc");
    expect(body.recipient).toBe("intents.near");
  });
  it("reverses for a payout", () => {
    const body = quoteBody({ direction: "payout", chain: "base", amount: "10" }, TOKENS, 0)!;
    expect(body.originAsset).toBe("near-usdc");
    expect(body.destinationAsset).toBe("base-usdc");
  });
  it("gives up when a token isn't listed", () => {
    expect(quoteBody({ direction: "fund", chain: "sol", amount: "10" }, TOKENS, 0)).toBeNull();
  });
});

describe("quoteView", () => {
  it("reads the formatted amounts and rejects anything else", () => {
    expect(quoteView({ quote: { amountInFormatted: "10", amountOutFormatted: "9.97", timeEstimate: 20 } })).toEqual({ amount_in: "10", amount_out: "9.97", seconds: 20 });
    expect(quoteView({ quote: {} })).toBeNull();
    expect(quoteView(null)).toBeNull();
  });
});
