"use client";

import { useEffect, useState } from "react";
import { chain } from "@/lib/chain";
import { NETWORK } from "@/lib/config";
import { OFFICIAL_USDC, SWAP_DONE, WNEAR, type SwapQuote } from "@/lib/intents";
import { explainError, useWallet } from "@/lib/wallet";

type Status = { status: string; usdc: string | null; refunded: string | null };

const STATUS_WORDS: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your NEAR to arrive…",
  KNOWN_DEPOSIT_TX: "Your NEAR arrived. Swapping…",
  PROCESSING: "Swapping…",
  SUCCESS: "Done.",
  REFUNDED: "The swap didn't go through, and your NEAR was sent back as wNEAR.",
  FAILED: "The swap failed. Anything that arrived is refunded to your account.",
  INCOMPLETE_DEPOSIT: "Less NEAR arrived than the price was for, so it's being refunded.",
};

/** Storage registration on a token, from its own bounds, or 0 if the account already has it. */
async function registration(token: string, account: string): Promise<bigint> {
  const balance = await chain.view<unknown>("storage_balance_of", { account_id: account }, token);
  if (balance) return 0n;
  const bounds = await chain.view<{ min: string }>("storage_balance_bounds", {}, token);
  return BigInt(bounds.min);
}

/**
 * NEAR to USDC through NEAR Intents, into the connected account, ready for money claims. On testnet it
 * only shows the live mainnet price.
 */
export function NearSwapPanel() {
  const wallet = useWallet();
  const live = NETWORK === "mainnet" && Boolean(wallet.accountId);
  const [near, setNear] = useState("3");
  const [price, setPrice] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const ask = async (commit: boolean): Promise<SwapQuote | null> => {
    const res = await fetch("/api/intents/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: live ? wallet.accountId : "intents.near", near, commit }),
    });
    const body = (await res.json()) as SwapQuote & { error?: string };
    if (body.error) {
      setError(body.error);
      return null;
    }
    return body;
  };

  const getPrice = async () => {
    setBusy("Asking NEAR Intents…");
    setError(null);
    setPrice(null);
    try {
      setPrice(await ask(false));
    } catch {
      setError("NEAR Intents didn't answer. Try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const swap = async () => {
    setBusy("Getting a deposit address…");
    setError(null);
    setStatus(null);
    try {
      const quote = await ask(true);
      if (!quote?.depositAddress) return;
      if (Date.parse(quote.deadline) < Date.now() + 2 * 60_000) throw new Error("That price is about to expire. Try again.");
      setPrice(quote);
      const account = wallet.accountId;
      const [usdcReg, wnearReg] = await Promise.all([registration(OFFICIAL_USDC, account), registration(WNEAR, account)]);
      const transactions = [];
      // USDC needs the account registered before 1Click can deliver to it.
      if (usdcReg > 0n) transactions.push({ receiverId: OFFICIAL_USDC, actions: [{ method: "storage_deposit", args: { account_id: account, registration_only: true }, deposit: usdcReg.toString() }] });
      // One transaction: wrap exactly the quoted NEAR (plus registration if new), then send it to the deposit address.
      // If the transfer fails, the whole transaction is undone.
      transactions.push({
        receiverId: WNEAR,
        actions: [
          { method: "near_deposit", args: {}, deposit: (BigInt(quote.amountIn) + wnearReg).toString() },
          { method: "ft_transfer", args: { receiver_id: quote.depositAddress, amount: quote.amountIn }, deposit: "1", tgas: 50 },
        ],
      });
      setBusy("Approve the swap in your wallet…");
      const hashes = await wallet.send(transactions);
      const txHash = hashes[hashes.length - 1]!;
      setDeposit(quote.depositAddress);
      await fetch("/api/intents/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ submit: { txHash, depositAddress: quote.depositAddress, account } }) }).catch(() => {});
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!deposit) return;
    let stop = false;
    const tick = async () => {
      const s = (await fetch(`/api/intents/swap?depositAddress=${deposit}`).then((r) => r.json()).catch(() => null)) as Status | null;
      if (stop) return;
      if (s) setStatus(s);
      if (!s || !(SWAP_DONE as readonly string[]).includes(s.status)) window.setTimeout(() => void tick(), 5000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [deposit]);

  return (
    <section className="section any-chain">
      <div className="section-head">
        <h2>Swap NEAR for USDC</h2>
      </div>
      <p className="hint" style={{ maxWidth: "62ch" }}>
        {live
          ? "Money claims are forecast in USDC. Swap NEAR for it here through NEAR Intents: your wallet sends the NEAR, and USDC arrives in this same account in about a minute. If the swap can't happen, the NEAR comes back."
          : NETWORK === "mainnet"
            ? "Money claims are forecast in USDC. Swap NEAR for it here through NEAR Intents. Here's today's live price; connect a wallet to swap, and nothing moves until you approve it there."
            : "On mainnet, money claims are forecast in USDC, and you can swap NEAR for it here through NEAR Intents. Here's today's live mainnet price. Nothing moves from this page on the test network."}
      </p>
      <form
        className="any-chain-form"
        onSubmit={(e) => {
          e.preventDefault();
          void getPrice();
        }}
      >
        <label>
          <span>NEAR</span>
          <input inputMode="decimal" value={near} onChange={(e) => {
              setNear(e.target.value);
              setPrice(null);
            }} />
        </label>
        <button type="submit" className={live ? "quiet" : undefined} disabled={busy !== null}>
          {busy === "Asking NEAR Intents…" ? busy : "Get a live price"}
        </button>
        {live && (
          <button type="button" disabled={busy !== null || !price} onClick={() => void swap()}>
            {busy && busy !== "Asking NEAR Intents…" ? busy : `Swap ${near} NEAR for USDC`}
          </button>
        )}
      </form>
      {error && (
        <p className="notice notice--error" role="status">
          {error}
        </p>
      )}
      {price && !status && (
        <p className="notice notice--ok" role="status">
          {price.near} NEAR gets about {price.usdc} USDC, and at least {price.minUsdc}
          {price.seconds !== null ? `, in about ${price.seconds} seconds` : ""}.{live ? "" : " This is a price only: nothing moved."}
        </p>
      )}
      {status && (
        <p className={`notice ${status.status === "SUCCESS" ? "notice--ok" : status.status === "FAILED" ? "notice--error" : ""}`} role="status">
          {status.status === "SUCCESS" ? `Done: ${status.usdc ?? "your"} USDC is in your wallet. You can forecast with it on money claims.` : (STATUS_WORDS[status.status] ?? "Checking the swap…")}
        </p>
      )}
      <p className="hint">
        USDC on NEAR is Circle&apos;s token <code>{OFFICIAL_USDC.slice(0, 8)}…{OFFICIAL_USDC.slice(-6)}</code>. Swaps go through NEAR Intents, which charges a small fee, and are limited to 0.1 to 5 NEAR at a time.
      </p>
    </section>
  );
}
