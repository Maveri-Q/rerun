import { parseQuoteRequest, quoteBody, quoteView } from "@/lib/intents";
import { fetchRetry, loadTokens, ONECLICK } from "@/lib/oneclick";

const UNREACHABLE = "NEAR Intents didn't answer. Try again in a minute.";

export async function POST(req: Request) {
  const parsed = parseQuoteRequest(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "Enter an amount from 1 to 10,000 USDC, with at most 2 decimals." }, { status: 400 });
  try {
    const body = quoteBody(parsed, await loadTokens(), Date.now());
    if (!body) return Response.json({ error: "NEAR Intents doesn't list USDC on that chain right now." }, { status: 502 });
    const res = await fetchRetry(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const view = res.ok ? quoteView(await res.json()) : null;
    if (!view) return Response.json({ error: "NEAR Intents has no price for that amount right now. Try a different amount." }, { status: 502 });
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: UNREACHABLE }, { status: 502 });
  }
}
