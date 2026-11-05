"use client";

import { useState } from "react";
import { INTENT_CHAINS, type IntentChain, type IntentDirection, type QuoteView } from "@/lib/intents";

/** A live NEAR Intents price for moving USDC to or from another chain. Nothing moves from this panel. */
export function AnyChainPanel() {
  const [direction, setDirection] = useState<IntentDirection>("fund");
  const [chain, setChain] = useState<IntentChain>("base");
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = INTENT_CHAINS[chain].label;

  const ask = async () => {
    setBusy(true);
    setQuote(null);
    setError(null);
    try {
      const res = await fetch("/api/intents/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction, chain, amount }) });
      const body = (await res.json()) as QuoteView & { error?: string };
      if (body.error) setError(body.error);
      else setQuote(body);
    } catch {
      setError("NEAR Intents didn't answer. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section any-chain">
      <div className="section-head">
        <h2>Fund from any chain, collect to any chain</h2>
      </div>
      <p className="any-chain-label">Live quote via NEAR Intents. Real transfers come with real-money mode.</p>
      <p className="hint" style={{ maxWidth: "62ch" }}>
        USDC can move between other chains and NEAR with no bridge to set up. Forecasts here use test USDC, and real money is a future decision, pending legal review.
      </p>
      <form
        className="any-chain-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label>
          <span>Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as IntentDirection)}>
            <option value="fund">Fund from another chain</option>
            <option value="payout">Collect to another chain</option>
          </select>
        </label>
        <label>
          <span>Chain</span>
          <select value={chain} onChange={(e) => setChain(e.target.value as IntentChain)}>
            {(Object.keys(INTENT_CHAINS) as IntentChain[]).map((c) => (
              <option key={c} value={c}>
                {INTENT_CHAINS[c].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>USDC</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Asking NEAR Intents…" : "Get a live price"}
        </button>
      </form>
      {error && <p className="notice notice--error" role="status">{error}</p>}
      {quote && (
        <p className="notice notice--ok" role="status">
          Send {quote.amount_in} USDC {direction === "fund" ? `on ${label}` : "on NEAR"}, receive {quote.amount_out} USDC {direction === "fund" ? "on NEAR" : `on ${label}`}
          {quote.seconds !== null ? `, in about ${quote.seconds} seconds` : ""}. This is a quote: no money moved.
        </p>
      )}
    </section>
  );
}
