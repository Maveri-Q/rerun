import { describe, expect, it } from "vitest";
import { checkSwapQuote, nearUnits, OFFICIAL_USDC, parseQuoteRequest, parseSwapRequest, quoteBody, quoteView, SWAP_FROM, SWAP_TO, swapBody, usdcUnits } from "./intents";

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

describe("NEAR to USDC swaps", () => {
  const tokens = [
    { assetId: SWAP_FROM, blockchain: "near", symbol: "wNEAR" },
    { assetId: SWAP_TO, blockchain: "near", symbol: "USDC" },
  ];
  const req = { account: "alice.near", near: "2.5" };

  it("only accepts a mainnet account and 0.1 to 5 NEAR", () => {
    expect(parseSwapRequest(req)).toEqual(req);
    expect(parseSwapRequest({ account: "a".repeat(64).replace(/a/g, "f"), near: "1" })).not.toBeNull();
    for (const bad of [{ account: "alice.testnet", near: "1" }, { account: "alice.near", near: "6" }, { account: "alice.near", near: "0.05" }, { account: "alice.near", near: "1.2345" }, { account: "Alice.near", near: "1" }, null]) {
      expect(parseSwapRequest(bad)).toBeNull();
    }
    expect(nearUnits("2.5")).toBe("2500000000000000000000000");
  });

  it("sends USDC and refunds to the same account, only to Circle's USDC", () => {
    const body = swapBody(req, tokens, false, 0)!;
    expect(body).toMatchObject({ dry: false, originAsset: "nep141:wrap.near", destinationAsset: `nep141:${OFFICIAL_USDC}`, recipient: "alice.near", refundTo: "alice.near", amount: "2500000000000000000000000" });
    expect(swapBody(req, [tokens[0]!], false, 0)).toBeNull();
  });

  const answer = (over: Record<string, unknown> = {}, req2: Record<string, unknown> = {}) => {
    const sent = swapBody(req, tokens, false, 0)!;
    return {
      sent,
      response: {
        quoteRequest: { ...sent, ...req2 },
        quote: { depositAddress: "a".repeat(64), amountIn: sent.amount, amountOut: "8900000", minAmountOut: "8811000", deadline: "2026-11-11T00:10:00Z", timeEstimate: 20, ...over },
      },
    };
  };

  it("reads a committed quote", () => {
    const { sent, response } = answer();
    expect(checkSwapQuote(response, sent)).toEqual({ depositAddress: "a".repeat(64), amountIn: sent.amount, near: "2.5", usdc: "8.9", minUsdc: "8.811", deadline: "2026-11-11T00:10:00Z", seconds: 20 });
  });

  it("refuses a quote that doesn't echo what was asked, or looks wrong", () => {
    const cases = [
      answer({}, { recipient: "mallory.near" }),
      answer({}, { refundTo: "mallory.near" }),
      answer({}, { destinationAsset: "nep141:fake-usdc.near" }),
      answer({ amountIn: "1" }),
      answer({ minAmountOut: "0" }),
      answer({ minAmountOut: "9000000" }),
      answer({ depositAddress: undefined }),
      answer({ depositMemo: "123" }),
      answer({ depositAddress: "alice.near" }),
    ];
    for (const { sent, response } of cases) expect(checkSwapQuote(response, sent)).toBeNull();
  });
});
