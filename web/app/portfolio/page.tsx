"use client";

import Link from "next/link";
import { useState } from "react";
import { Stamp } from "@/components/Stamp";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { fmtUnits, modeUnit, stateLabel, type Market, type Position } from "@/lib/market";
import { explainError, useWallet } from "@/lib/wallet";

/** Current worth: pool price while open; the payout once final. */
function worth(m: Market, p: Position): bigint {
  const yes = BigInt(p.yes);
  const no = BigInt(p.no);
  if (m.outcome === "REPRODUCED") return yes;
  if (m.outcome === "NOT_REPRODUCED" || m.outcome === "BROKEN") return no;
  if (m.outcome === "INVALID") return yes / 2n + no / 2n;
  const price = BigInt(m.yes_price_ppm);
  return (yes * price + no * (1_000_000n - price)) / 1_000_000n;
}

export default function PortfolioPage() {
  const wallet = useWallet();
  const account = wallet.accountId;
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const data = usePoll(
    async () => {
      if (!account) return null;
      const ids = await chain.accountMarkets(account);
      const rows = await Promise.all(
        ids.map(async (id) => {
          const [market, position] = await Promise.all([chain.market(id), chain.position(account, id)]);
          return market && position ? { market, position } : null;
        }),
      );
      const [points, money] = await Promise.all([chain.balance(account, "points"), chain.balance(account, "money")]);
      return { rows: rows.filter((r): r is NonNullable<typeof r> => r !== null).reverse(), points, money };
    },
    [account],
    20_000,
  );

  if (!account) {
    return (
      <>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Your forecasts</h1>
        <p className="lede prose">Connect a wallet to see your forecasts, what you can collect, and your balance.</p>
        <button style={{ marginTop: 16 }} onClick={wallet.signIn} disabled={wallet.loading}>
          Connect wallet
        </button>
      </>
    );
  }

  const withdraw = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await wallet.call("withdraw", {}, { deposit: "1", tgas: 100 });
      setMessage({ ok: true, text: "Withdrew your tUSDC to your wallet." });
      void data.refresh();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  };

  const d = data.data;
  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Your forecasts</h1>
      <div className="figures">
        <div className="figure">
          <b>{d ? fmtUnits(d.points) : "…"}</b>
          <span>points</span>
        </div>
        <div className="figure">
          <b>{d ? fmtUnits(d.money) : "…"}</b>
          <span>tUSDC ready to withdraw</span>
        </div>
      </div>
      {d && BigInt(d.money) > 0n && (
        <button style={{ marginTop: 16 }} disabled={busy} onClick={() => void withdraw()}>
          Withdraw {fmtUnits(d.money)} tUSDC
        </button>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}

      <section className="section">
        <div className="section-head">
          <h2>Your forecasts</h2>
        </div>
        {data.error && !d && <p className="notice notice--error">Unable to load your forecasts. This page keeps trying.</p>}
        {data.loading && !d && <p className="dim">Loading your forecasts…</p>}
        {d && d.rows.length === 0 && (
          <p className="empty">
            You have no forecasts yet. <Link href="/">Pick a claim</Link> and make your first one.
          </p>
        )}
        {d && d.rows.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Claim</th>
                  <th className="num">YES</th>
                  <th className="num">NO</th>
                  <th className="num">Worth now</th>
                  <th className="num">Profit or loss</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map(({ market: m, position: p }) => {
                  const now = worth(m, p);
                  const pnl = BigInt(p.received) + now - BigInt(p.spent);
                  const redeemable = m.state === "Final" && (BigInt(p.yes) > 0n || BigInt(p.no) > 0n || BigInt(p.lp) > 0n);
                  return (
                    <tr key={m.id}>
                      <td style={{ minWidth: 220 }}>
                        <Link href={`/market/${m.id}`}>{m.spec.title}</Link>
                      </td>
                      <td className="num mono">{fmtUnits(p.yes)}</td>
                      <td className="num mono">{fmtUnits(p.no)}</td>
                      <td className="num mono">
                        {fmtUnits(now)} {modeUnit(m.mode)}
                      </td>
                      <td className="num mono">
                        {pnl >= 0n ? "+" : ""}
                        {fmtUnits(pnl)}
                      </td>
                      <td>{m.outcome ? <Stamp outcome={m.outcome} size="sm" /> : stateLabel(m.state)}{redeemable && <div><Link href={`/market/${m.id}`}>Collect</Link></div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Profit or loss counts what you put in, what you took out, and today&apos;s value of your shares. Money you added to a prize pool isn&apos;t counted until you take it out.</p>
      </section>
    </>
  );
}
