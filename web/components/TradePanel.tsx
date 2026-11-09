"use client";

import { nearToYocto } from "near-api-js";
import { useState } from "react";
import { chain } from "@/lib/chain";
import Link from "next/link";
import { FT, REAL_MONEY } from "@/lib/config";
import { fmtUnits, modeUnit, parseUnits, quoteBuy, quoteSell, relativeTime, type Config, type Market, type Position, type Side } from "@/lib/market";
import { explainError, useWallet } from "@/lib/wallet";
import { usePoll } from "./usePoll";

const STORAGE_NEAR = () => nearToYocto("0.02").toString(); // covers new storage; the excess is refunded
const FT_REGISTER_NEAR = () => nearToYocto("0.00125").toString();
const MIN_PREPAID = 10n ** 22n; // 0.01 NEAR
const FAUCET_UNITS = 100_000_000n;

export function useFunds(market: Market) {
  const wallet = useWallet();
  const account = wallet.accountId;
  return usePoll(
    async () => {
      if (!account) return null;
      const internal = BigInt(await chain.balance(account, market.mode));
      const walletToken = market.mode === "money" ? BigInt(await chain.view<string>("ft_balance_of", { account_id: account }, FT)) : 0n;
      return { internal, walletToken };
    },
    [account, market.id, market.mode],
    20_000,
  );
}

/** Makes sure a tUSDC deposit can land: registered on the token, and prepaid storage on the market contract. */
export async function prepareMoney(wallet: ReturnType<typeof useWallet>) {
  const registered = await chain.view<unknown>("storage_balance_of", { account_id: wallet.accountId }, FT);
  if (!registered) await wallet.call("storage_deposit", { registration_only: true }, { deposit: FT_REGISTER_NEAR(), contractId: FT });
  if (BigInt(await chain.storageBalance(wallet.accountId)) < MIN_PREPAID) {
    await wallet.call("storage_deposit", {}, { deposit: nearToYocto("0.05").toString() });
  }
}

export const ftTransferCall = (wallet: ReturnType<typeof useWallet>, contract: string, amount: bigint, msg: unknown) =>
  wallet.call("ft_transfer_call", { receiver_id: contract, amount: amount.toString(), msg: JSON.stringify(msg) }, { deposit: "1", tgas: 200, contractId: FT });

export function TradePanel({ market, config, position, contract, onDone }: { market: Market; config: Config; position: Position | null | undefined; contract: string; onDone: () => void }) {
  const wallet = useWallet();
  const funds = useFunds(market);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("10");
  const [slippage, setSlippage] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const unit = modeUnit(market.mode);
  const parsed = parseUnits(amount);
  const held = position ? BigInt(side === "YES" ? position.yes : position.no) : 0n;
  const internal = funds.data?.internal ?? 0n;
  const available = market.mode === "money" ? internal + (funds.data?.walletToken ?? 0n) : internal;
  const quote = parsed ? (action === "buy" ? quoteBuy(market, side, parsed, config.fee_bps) : quoteSell(market, side, parsed, config.fee_bps)) : null;
  const short = parsed !== null && (action === "buy" ? parsed > available : parsed > held);

  const run = async (label: string, done: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: done });
      onDone();
      void funds.refresh();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    if (!parsed || !quote) return;
    const minOut = (quote.out * BigInt(Math.round((100 - slippage) * 100))) / 10_000n;
    if (action === "sell") {
      return run("Selling…", `Sold ${amount} ${side} shares.`, () =>
        wallet.call("sell", { market_id: market.id, outcome: side, shares: parsed.toString(), min_collateral_out: minOut.toString() }, { deposit: STORAGE_NEAR() }),
      );
    }
    const label = `Bought ${side} with ${amount} ${unit}. Forecasting ends ${relativeTime(market.lock_time)}, then the Lab reruns the claim. If ${side} wins, collect from this page or your Portfolio.`;
    if (market.mode === "points") {
      return run("Buying…", label, () =>
        wallet.call("buy", { market_id: market.id, outcome: side, amount: parsed.toString(), min_shares_out: minOut.toString() }, { deposit: STORAGE_NEAR() }),
      );
    }
    return run("Buying…", label, async () => {
      await prepareMoney(wallet);
      if (internal >= parsed) {
        await wallet.call("buy", { market_id: market.id, outcome: side, amount: parsed.toString(), min_shares_out: minOut.toString() }, { deposit: STORAGE_NEAR() });
      } else {
        await ftTransferCall(wallet, contract, parsed, { action: "buy", market_id: market.id, outcome: side, min_shares_out: minOut.toString() });
      }
    });
  };

  const yesPct = (market.yes_price_ppm / 10_000).toFixed(0);
  const noPct = (100 - market.yes_price_ppm / 10_000).toFixed(0);

  if (!wallet.accountId) {
    return (
      <div className="panel">
        <h2>Will it hold up?</h2>
        <p className="hint">{market.trades > 0 ? `Forecasters put it at ${yesPct}% so far. ` : "Nobody has forecast this yet. "}{market.mode === "points" ? "Make your own call with free points, so there's nothing to lose." : "Make your own call with free test money."}</p>
        <button className="w-full" style={{ marginTop: 12 }} onClick={wallet.signIn}>
          Connect wallet to forecast
        </button>
        <p className="hint">You&apos;ll need a wallet account on NEAR&apos;s test network. It&apos;s free, and your wallet opens in its own window.</p>
      </div>
    );
  }

  const needsPoints = funds.data && internal === 0n && market.mode === "points";
  const payout = quote ? fmtUnits(quote.out) : null;
  const moved = quote ? (quote.yesPriceAfterPpm / 10_000).toFixed(0) : null;

  return (
    <div className="panel forecast">
      <h2 style={{ marginBottom: 12 }}>Will it hold up?</h2>
      {needsPoints && (
        <button
          className="w-full"
          style={{ marginBottom: 14 }}
          disabled={busy !== null}
          onClick={() => void run("Claiming…", "1,000 points added. Now make your call.", () => wallet.call("claim_points", {}, { deposit: STORAGE_NEAR() }))}
        >
          First, claim your 1,000 free points
        </button>
      )}
      {action === "sell" && <p className="hint" style={{ margin: "0 0 10px" }}>You&apos;re selling what you already hold.</p>}
      <div className="call" role="group" aria-label="Your call">
        <button className="call-yes" aria-pressed={side === "YES"} onClick={() => setSide("YES")}>
          <b>YES</b>
          <span>It holds up</span>
          <small>{market.trades > 0 ? `${yesPct}% say so` : "Be the first"}</small>
        </button>
        <button className="call-no" aria-pressed={side === "NO"} onClick={() => setSide("NO")}>
          <b>NO</b>
          <span>It won&apos;t</span>
          <small>{market.trades > 0 ? `${noPct}% say so` : "Be the first"}</small>
        </button>
      </div>
      <label className="field">
        <span>{action === "buy" ? (market.mode === "points" ? "How many points?" : REAL_MONEY ? "How much USDC? At most 5." : "How much test USDC? At most 5.") : `How many ${side} shares to sell?`}</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={parsed === null} />
      </label>
      {action === "buy" && (
        <div className="call-amounts" role="group" aria-label="Quick amounts">
          {(market.mode === "money" ? ["1", "2", "5"] : ["10", "50", "100"]).map((a) => (
            <button key={a} className="quiet btn--small" aria-pressed={amount === a} onClick={() => setAmount(a)}>
              {a}
            </button>
          ))}
        </div>
      )}
      <div className="call-result" aria-live="polite">
        {quote ? (
          action === "buy" ? (
            <>
              <p>
                <span>If you&apos;re right</span> <b>{payout} {unit}</b>
              </p>
              <p>
                <span>If you&apos;re wrong</span> <b className="dim">you lose your {amount} {unit}</b>
              </p>
              <p className="hint">Your forecast moves the odds of YES to about {moved}%.</p>
            </>
          ) : (
            <p>
              <span>You&apos;d get back about</span> <b>{payout} {unit}</b>
            </p>
          )
        ) : (
          <p className="dim">Enter a number, with at most 6 decimals.</p>
        )}
      </div>
      <button className="w-full" disabled={!funds.data || !quote || short || busy !== null} onClick={submit}>
        {busy ?? (!funds.data ? "Checking your balance…" : short ? (action === "buy" ? `You don't have enough ${unit}` : "You don't hold that many") : action === "buy" ? `Forecast ${side} with ${amount} ${unit}` : `Sell ${amount} ${side} shares`)}
      </button>
      <p className="hint">
        You have {funds.data ? fmtUnits(market.mode === "money" ? available : internal) : "…"} {unit}
        {position && (BigInt(position.yes) > 0n || BigInt(position.no) > 0n) ? `, and you've already forecast: ${fmtUnits(position.yes)} YES, ${fmtUnits(position.no)} NO` : ""}.
      </p>
      {market.mode === "money" && !REAL_MONEY && <p className="hint">This is test USDC with no real value.</p>}
      {market.mode === "money" && REAL_MONEY && (
        <p className="notice" role="note">
          Beta: real funds at your own risk, small amounts only. At most 5 USDC a prediction and 50 USDC in a claim. <Link href="/terms">Read the terms</Link>.
        </p>
      )}
      {market.mode === "money" && !REAL_MONEY && (
        <button
          className="quiet w-full"
          style={{ marginTop: 8 }}
          disabled={busy !== null}
          onClick={() =>
            void run("Adding…", "Added 100 test USDC to your wallet.", async () => {
              await prepareMoney(wallet);
              await wallet.call("mint", { amount: FAUCET_UNITS.toString() }, { contractId: FT });
            })
          }
        >
          Get 100 test USDC
        </button>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}

      <details style={{ marginTop: 16 }}>
        <summary>Changed your mind?</summary>
        <p className="hint" style={{ marginBottom: 8 }}>Until forecasting closes, you can sell what you bought at today&apos;s odds.</p>
        <div className="seg" role="group" aria-label="Buy or sell">
          <button aria-pressed={action === "buy"} onClick={() => setAction("buy")}>
            Forecast
          </button>
          <button aria-pressed={action === "sell"} onClick={() => setAction("sell")}>
            Sell
          </button>
        </div>
      </details>
      <details style={{ marginTop: 8 }}>
        <summary>If the odds move while you confirm</summary>
        <label className="field" style={{ marginTop: 8 }}>
          <span>Cancel my forecast if the odds move more than</span>
          <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))}>
            <option value={0.5}>0.5%</option>
            <option value={1}>1%</option>
            <option value={3}>3%</option>
            <option value={10}>10%</option>
          </select>
        </label>
      </details>
      <details style={{ marginTop: 8 }}>
        <summary>Add to the prize pool</summary>
        <p className="hint" style={{ marginBottom: 8 }}>
          For experienced forecasters. Adding to the pool makes the odds harder to move. You earn {(config.fee_bps * (10_000 - config.treasury_fee_share_bps)) / 10_000 / 100}% of every trade, but you can lose money depending on the verdict.
        </p>
        <button
          className="quiet w-full"
          disabled={!parsed || busy !== null}
          onClick={() =>
            void run("Adding…", `Added ${amount} ${unit} to the pool.`, async () => {
              if (market.mode === "points") {
                await wallet.call("add_liquidity", { market_id: market.id, amount: parsed!.toString() }, { deposit: STORAGE_NEAR() });
              } else {
                await prepareMoney(wallet);
                await ftTransferCall(wallet, contract, parsed!, { action: "add_liquidity", market_id: market.id });
              }
            })
          }
        >
          Add {amount} {unit}
        </button>
        {position && BigInt(position.lp) > 0n && (
          <button
            className="quiet w-full"
            style={{ marginTop: 8 }}
            disabled={busy !== null}
            onClick={() => void run("Removing…", "Took your money out of the pool. You now hold YES and NO shares instead.", () => wallet.call("remove_liquidity", { market_id: market.id }, { deposit: STORAGE_NEAR() }))}
          >
            Take my money out of the pool
          </button>
        )}
      </details>
    </div>
  );
}
