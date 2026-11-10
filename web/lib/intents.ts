/**
 * NEAR Intents. Moving USDC between another chain and NEAR is read-only: dry quotes, which move nothing
 * and create no deposit address. Swapping NEAR for USDC on NEAR is real on mainnet (below).
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

/*
 * NEAR → USDC on NEAR, for real, on mainnet. The person's wallet wraps NEAR and sends the wNEAR to a
 * deposit address from NEAR Intents' 1Click API, and 1Click delivers USDC to the same account. Refunds
 * go back to that account too. The server only builds and checks quotes: it never holds funds or keys.
 */

/** Circle's USDC on NEAR (native, not bridged). Check against https://developers.circle.com/stablecoins/usdc-contract-addresses */
export const OFFICIAL_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR = "wrap.near";
export const SWAP_FROM = `nep141:${WNEAR}`;
export const SWAP_TO = `nep141:${OFFICIAL_USDC}`;
export const MIN_SWAP_NEAR = 0.1;
export const MAX_SWAP_NEAR = 5;
const YOCTO = 10n ** 24n;

export interface SwapRequest {
  account: string;
  near: string;
}

/** NEAR as yoctoNEAR, if it's a plain number of NEAR within the limits, with at most 3 decimals. */
export function nearUnits(near: string): string | null {
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(near)) return null;
  const value = Number(near);
  if (value < MIN_SWAP_NEAR || value > MAX_SWAP_NEAR) return null;
  const [whole, fraction = ""] = near.split(".");
  return (BigInt(whole!) * YOCTO + BigInt(fraction.padEnd(24, "0"))).toString();
}

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function parseSwapRequest(body: unknown): SwapRequest | null {
  const b = body as Partial<SwapRequest> | null;
  if (!b || typeof b.account !== "string" || typeof b.near !== "string") return null;
  if (b.account.length < 2 || b.account.length > 64 || !ACCOUNT.test(b.account)) return null;
  if (!b.account.endsWith(".near") && !/^[0-9a-f]{64}$/.test(b.account)) return null;
  if (nearUnits(b.near) === null) return null;
  return { account: b.account, near: b.near };
}

/** The 1Click quote: exact NEAR in, USDC out to the same account, 1% slippage, refunds to the same account. */
export function swapBody(req: SwapRequest, tokens: IntentToken[], dry: boolean, now: number) {
  if (!tokens.some((t) => t.assetId === SWAP_FROM) || !tokens.some((t) => t.assetId === SWAP_TO && t.symbol === "USDC" && t.blockchain === "near")) return null;
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: SWAP_FROM,
    destinationAsset: SWAP_TO,
    amount: nearUnits(req.near)!,
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    recipient: req.account,
    refundTo: req.account,
    deadline: new Date(now + 10 * 60_000).toISOString(),
    referral: "rerun",
  };
}

export interface SwapQuote {
  depositAddress: string | null;
  amountIn: string;
  near: string;
  usdc: string;
  minUsdc: string;
  deadline: string;
  seconds: number | null;
}

const units = (raw: string, decimals: number) => {
  const s = raw.padStart(decimals + 1, "0");
  const out = `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/0+$/, "").replace(/\.$/, "");
  return out;
};

/**
 * Reads 1Click's answer, refusing it unless it echoes exactly what was asked: the same assets, amount,
 * recipient and refund account. A committed quote must carry a NEAR deposit address and no memo.
 */
export function checkSwapQuote(response: unknown, sent: ReturnType<typeof swapBody>): SwapQuote | null {
  if (!sent) return null;
  const r = response as { quoteRequest?: Record<string, unknown>; quote?: Record<string, unknown> } | null;
  const req = r?.quoteRequest;
  const q = r?.quote;
  if (!req || !q) return null;
  for (const k of ["originAsset", "destinationAsset", "amount", "recipient", "refundTo", "swapType"] as const) if (req[k] !== sent[k]) return null;
  if (q.amountIn !== sent.amount || typeof q.amountOut !== "string" || typeof q.minAmountOut !== "string") return null;
  // A price has no deadline of its own; a committed quote must say when its deposit address stops working.
  if (!sent.dry && typeof q.deadline !== "string") return null;
  if (!/^\d+$/.test(q.amountOut) || !/^\d+$/.test(q.minAmountOut) || BigInt(q.minAmountOut) > BigInt(q.amountOut) || BigInt(q.minAmountOut) === 0n) return null;
  let depositAddress: string | null = null;
  if (!sent.dry) {
    if (typeof q.depositAddress !== "string" || q.depositMemo) return null;
    if (!/^[0-9a-f]{64}$/.test(q.depositAddress) && !/^[a-z0-9._-]{2,64}$/.test(q.depositAddress)) return null;
    if (q.depositAddress === sent.recipient) return null;
    depositAddress = q.depositAddress;
  }
  return {
    depositAddress,
    amountIn: sent.amount,
    near: units(sent.amount, 24),
    usdc: units(q.amountOut, 6),
    minUsdc: units(q.minAmountOut, 6),
    deadline: typeof q.deadline === "string" ? q.deadline : sent.deadline,
    seconds: typeof q.timeEstimate === "number" ? q.timeEstimate : null,
  };
}

/** The 1Click states that end a swap. */
export const SWAP_DONE = ["SUCCESS", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"] as const;
