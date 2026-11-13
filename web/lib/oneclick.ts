import type { IntentToken } from "./intents.ts";

/** NEAR Intents' 1Click API, from the server only. */
export const ONECLICK = "https://1click.chaindefuser.com/v0";
const TOKENS_MS = 60 * 60_000;
let tokens: { at: number; list: IntentToken[] } | null = null;

/** The connection here drops out at times, so a failed request gets a couple more tries. */
export async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export async function loadTokens(): Promise<IntentToken[]> {
  if (tokens && Date.now() - tokens.at < TOKENS_MS) return tokens.list;
  const res = await fetchRetry(`${ONECLICK}/tokens`);
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  tokens = { at: Date.now(), list: (await res.json()) as IntentToken[] };
  return tokens.list;
}
