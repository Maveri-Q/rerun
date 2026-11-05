/**
 * NEAR Intents, read-only: live prices for moving USDC between another chain and NEAR. Every request
 * here is a dry quote, which moves nothing and creates no deposit address. Sending real funds waits
 * for real-money mode, which is a future decision, pending legal review.
 */

export const INTENT_CHAINS = {
  eth: { label: "Ethereum", placeholder: "0x0000000000000000000000000000000000000001" },
  base: { label: "Base", placeholder: "0x0000000000000000000000000000000000000001" },
  arb: { label: "Arbitrum", placeholder: "0x0000000000000000000000000000000000000001" },
  sol: { label: "Solana", placeholder: "11111111111111111111111111111111" },
} as const;

export type IntentChain = keyof typeof INTENT_CHAINS;
export type IntentDirection = "fund" | "payout";

export const MIN_USDC = 1;
export const MAX_USDC = 10_000;
/** Named accounts that exist, used only to shape a dry quote. Nothing is ever sent to them. */
const NEAR_PLACEHOLDER = "intents.near";
const USDC_DECIMALS = 6;

export interface IntentToken {
  assetId: string;
  blockchain: string;
  symbol: string;
}

export interface QuoteRequest {
  direction: IntentDirection;
  chain: IntentChain;
  amount: string;
}

/** The whole-USDC amount as smallest units, or null if it's outside what the page allows. */
export function usdcUnits(amount: string): string | null {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(amount)) return null;
  const value = Number(amount);
  if (value < MIN_USDC || value > MAX_USDC) return null;
  const [whole, fraction = ""] = amount.split(".");
  return (BigInt(whole!) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"))).toString();
}

export function parseQuoteRequest(body: unknown): QuoteRequest | null {
  const b = body as Partial<QuoteRequest> | null;
  if (!b || (b.direction !== "fund" && b.direction !== "payout")) return null;
  if (typeof b.chain !== "string" || !Object.hasOwn(INTENT_CHAINS, b.chain)) return null;
  if (typeof b.amount !== "string" || usdcUnits(b.amount) === null) return null;
  return { direction: b.direction, chain: b.chain, amount: b.amount };
}

function usdcOn(tokens: IntentToken[], blockchain: string): string | null {
  return tokens.find((t) => t.symbol === "USDC" && t.blockchain === blockchain)?.assetId ?? null;
}

/** Always `dry: true`: this builder has no way to ask for a deposit address. */
export function quoteBody(req: QuoteRequest, tokens: IntentToken[], now: number) {
  const near = usdcOn(tokens, "near");
  const other = usdcOn(tokens, req.chain);
  if (!near || !other) return null;
  const fund = req.direction === "fund";
  const address = INTENT_CHAINS[req.chain].placeholder;
  return {
    dry: true as const,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: fund ? other : near,
    destinationAsset: fund ? near : other,
    amount: usdcUnits(req.amount)!,
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    recipient: fund ? NEAR_PLACEHOLDER : address,
    refundTo: fund ? address : NEAR_PLACEHOLDER,
    deadline: new Date(now + 15 * 60_000).toISOString(),
    referral: "rerun",
  };
}

export interface QuoteView {
  amount_in: string;
  amount_out: string;
  seconds: number | null;
}

export function quoteView(response: unknown): QuoteView | null {
  const q = (response as { quote?: { amountInFormatted?: unknown; amountOutFormatted?: unknown; timeEstimate?: unknown } } | null)?.quote;
  if (!q || typeof q.amountInFormatted !== "string" || typeof q.amountOutFormatted !== "string") return null;
  return { amount_in: q.amountInFormatted, amount_out: q.amountOutFormatted, seconds: typeof q.timeEstimate === "number" ? q.timeEstimate : null };
}
