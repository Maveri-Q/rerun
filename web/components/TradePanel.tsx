"use client";

import { nearToYocto } from "near-api-js";
import { useState } from "react";
import { chain } from "@/lib/chain";
import { FT } from "@/lib/config";
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
  const [slippage, setSlippage] = useState(1);
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
    const label = `Bought ${side} with ${amount} ${unit}. Forecasting ends ${relativeTime(market.lock_time)}, then the Lab re-runs the claim. If ${side} wins, collect from this page or your Portfolio.`;
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

  if (!wallet.accountId) {
    return (
      <div className="panel">
        <h2>Make a forecast</h2>
        <p className="hint">Connect a NEAR testnet wallet to forecast. {market.mode === "points" ? "Points are free." : "tUSDC is a free test token here."}</p>
        <button className="w-full" style={{ marginTop: 12 }} onClick={wallet.signIn}>
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 style={{ marginBottom: 4 }}>Make a forecast</h2>
      <p className="hint" style={{ margin: "0 0 12px" }}>YES means you expect this claim to hold up. NO means you don&apos;t.</p>
      <div className="seg" role="group" aria-label="Buy or sell">
        <button aria-pressed={action === "buy"} onClick={() => setAction("buy")}>
          Buy
        </button>
        <button aria-pressed={action === "sell"} onClick={() => setAction("sell")}>
          Sell
        </button>
      </div>
      <div className="seg" role="group" aria-label="Outcome">
        <button className="yes" aria-pressed={side === "YES"} onClick={() => setSide("YES")}>
          YES {(market.yes_price_ppm / 10_000).toFixed(0)}%
        </button>
        <button className="no" aria-pressed={side === "NO"} onClick={() => setSide("NO")}>
          NO {(100 - market.yes_price_ppm / 10_000).toFixed(0)}%
        </button>
      </div>
      <label className="field">
        <span>{action === "buy" ? `Amount to spend, in ${unit}` : `${side} shares to sell`}</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={parsed === null} />
      </label>
      <label className="field">
        <span>Stop if the price moves more than</span>
        <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))}>
          <option value={0.5}>0.5%</option>
          <option value={1}>1%</option>
          <option value={3}>3%</option>
          <option value={10}>10%</option>
        </select>
      </label>
      <div className="quote mono">
        {quote ? (
          <>
            <div className="row">
              <span>{action === "buy" ? "You get about" : "You receive about"}</span>
              <b>
                {fmtUnits(quote.out)} {action === "buy" ? `${side} shares` : unit}
              </b>
            </div>
            <div className="row">
              <span>Chance of YES after</span>
              <span>{(quote.yesPriceAfterPpm / 10_000).toFixed(1)}%</span>
            </div>
            {action === "buy" && (
              <div className="row">
                <span>You win if {side} is right</span>
                <span>{fmtUnits(quote.out)} {unit}</span>
              </div>
            )}
          </>
        ) : (
          <span className="dim">Enter an amount with at most 6 decimals.</span>
        )}
      </div>
      <button className="w-full" disabled={!quote || short || busy !== null} onClick={submit}>
        {busy ?? (short ? (action === "buy" ? `Not enough ${unit}` : "Not enough shares") : `${action === "buy" ? "Buy" : "Sell"} ${side}`)}
      </button>
      <p className="hint">
        You have {fmtUnits(market.mode === "money" ? available : internal)} {unit}
        {position && (BigInt(position.yes) > 0n || BigInt(position.no) > 0n) ? `, ${fmtUnits(position.yes)} YES and ${fmtUnits(position.no)} NO shares` : ""}.
      </p>
      {funds.data && internal === 0n && market.mode === "points" && (
        <button
          className="quiet w-full"
          style={{ marginTop: 8 }}
          disabled={busy !== null}
          onClick={() => void run("Claiming…", "Claimed your free points.", () => wallet.call("claim_points", {}, { deposit: STORAGE_NEAR() }))}
        >
          Claim 1,000 free points
        </button>
      )}
      {market.mode === "money" && <p className="hint">Test USDC on testnet only. Real money is a future decision, pending legal review.</p>}
      {market.mode === "money" && (
        <button
          className="quiet w-full"
          style={{ marginTop: 8 }}
          disabled={busy !== null}
          onClick={() =>
            void run("Minting…", "Added 100 test tUSDC to your wallet.", async () => {
              await prepareMoney(wallet);
              await wallet.call("mint", { amount: FAUCET_UNITS.toString() }, { contractId: FT });
            })
          }
        >
          Get 100 test tUSDC
        </button>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}

      <details style={{ marginTop: 16 }}>
        <summary>Add to the prize pool (advanced)</summary>
        <p className="hint" style={{ marginBottom: 8 }}>
          Adding money makes the odds harder to move. You earn {(config.fee_bps * (10_000 - config.treasury_fee_share_bps)) / 10_000 / 100}% of every trade, but you can lose money depending on the verdict.
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
