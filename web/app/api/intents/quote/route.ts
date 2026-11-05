import { parseQuoteRequest, quoteBody, quoteView, type IntentToken } from "@/lib/intents";

const API = "https://1click.chaindefuser.com/v0";
const TOKENS_MS = 60 * 60_000;

let tokens: { at: number; list: IntentToken[] } | null = null;

/** The connection here drops out at times, so a failed request gets a couple more tries. */
async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function loadTokens(): Promise<IntentToken[]> {
  if (tokens && Date.now() - tokens.at < TOKENS_MS) return tokens.list;
  const res = await fetchRetry(`${API}/tokens`);
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  tokens = { at: Date.now(), list: (await res.json()) as IntentToken[] };
  return tokens.list;
}

const UNREACHABLE = "NEAR Intents didn't answer. Try again in a minute.";

export async function POST(req: Request) {
  const parsed = parseQuoteRequest(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "Enter an amount from 1 to 10,000 USDC, with at most 2 decimals." }, { status: 400 });
  try {
    const body = quoteBody(parsed, await loadTokens(), Date.now());
    if (!body) return Response.json({ error: "NEAR Intents doesn't list USDC on that chain right now." }, { status: 502 });
    const res = await fetchRetry(`${API}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const view = res.ok ? quoteView(await res.json()) : null;
    if (!view) return Response.json({ error: "NEAR Intents has no price for that amount right now. Try a different amount." }, { status: 502 });
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: UNREACHABLE }, { status: 502 });
  }
}
