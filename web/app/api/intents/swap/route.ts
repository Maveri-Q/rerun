import { NETWORK } from "@/lib/config";
import { checkSwapQuote, parseSwapRequest, swapBody } from "@/lib/intents";
import { fetchRetry, loadTokens, ONECLICK } from "@/lib/oneclick";

export const dynamic = "force-dynamic";

const UNREACHABLE = "NEAR Intents didn't answer. Try again in a minute.";
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * NEAR → USDC. `{ account, near }` gets a price; with `commit: true` (mainnet only) it gets a deposit
 * address. `{ submit: { txHash, depositAddress, account } }` tells 1Click the deposit was sent.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { commit?: unknown; submit?: { txHash?: unknown; depositAddress?: unknown; account?: unknown } } | null;
  if (body?.submit) {
    const { txHash, depositAddress, account } = body.submit;
    if (typeof txHash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(txHash) || typeof depositAddress !== "string" || typeof account !== "string") {
      return Response.json({ error: "Send the transaction hash, deposit address and account." }, { status: 400 });
    }
    try {
      const res = await fetchRetry(`${ONECLICK}/deposit/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, depositAddress, nearSenderAccount: account }) });
      return Response.json({ ok: res.ok });
    } catch {
      return Response.json({ ok: false });
    }
  }
  const parsed = parseSwapRequest(body);
  if (!parsed) return Response.json({ error: "Enter 0.1 to 5 NEAR, with at most 3 decimals, from a mainnet account." }, { status: 400 });
  const commit = body?.commit === true;
  if (commit && NETWORK !== "mainnet") return Response.json({ error: "Real swaps only run on mainnet." }, { status: 400 });
  try {
    const sent = swapBody(parsed, await loadTokens(), !commit, Date.now());
    if (!sent) return Response.json({ error: "NEAR Intents doesn't list NEAR to USDC right now." }, { status: 502 });
    const res = await fetchRetry(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) }, commit ? 1 : 3);
    const quote = res.ok ? checkSwapQuote(await res.json(), sent) : null;
    if (!quote) return Response.json({ error: "NEAR Intents has no safe price for that amount right now. Try a different amount." }, { status: 502 });
    return Response.json(quote, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: UNREACHABLE }, { status: 502 });
  }
}

/** Where a swap is: `?depositAddress=`. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (!HEX64.test(address) && !/^[a-z0-9._-]{2,64}$/.test(address)) return Response.json({ error: "Give a deposit address." }, { status: 400 });
  try {
    const res = await fetchRetry(`${ONECLICK}/status?depositAddress=${encodeURIComponent(address)}`);
    const s = (await res.json()) as { status?: string; swapDetails?: { amountOutFormatted?: string; refundedAmountFormatted?: string } };
    return Response.json({ status: s.status ?? "UNKNOWN", usdc: s.swapDetails?.amountOutFormatted ?? null, refunded: s.swapDetails?.refundedAmountFormatted ?? null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "UNKNOWN" });
  }
}
