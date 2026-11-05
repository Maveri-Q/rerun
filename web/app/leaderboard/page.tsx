"use client";

import { RollingNumber } from "@/components/RollingNumber";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { accountLink } from "@/lib/config";
import { fmtUnits } from "@/lib/market";
import { useWallet } from "@/lib/wallet";

const START = 1_000_000_000n;

const short = (id: string) => (id.length > 20 ? `${id.slice(0, 17)}…` : id);
const signed = (points: string) => {
  const change = BigInt(points) - START;
  return `${change >= 0n ? "+" : ""}${fmtUnits(change)}`;
};

export default function LeaderboardPage() {
  const board = usePoll(() => chain.leaderboard(), [], 30_000, "leaderboard");
  const wallet = useWallet();
  const rows = board.data ?? [];
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const highest = rows.length ? Number(fmtUnits(rows[0]!.points).replaceAll(",", "")) || 1 : 1;
  return (
    <>
      <h1 className="page-title">Best forecasters</h1>
      <p className="lede">Everyone starts with 1,000 free points. Points can&apos;t be bought or transferred, so the only way up this list is forecasting well.</p>

      {board.error && !board.data && <p className="notice notice--error">Unable to load the leaderboard. This page keeps trying.</p>}
      {board.loading && !board.data && <p className="empty">Adding up everyone&apos;s points…</p>}
      {board.data && rows.length === 0 && <p className="empty">Nobody has claimed points yet. Open any claim that uses points to be first.</p>}

      {top.length > 0 && (
        <div className="podium">
          <div className="receipt-slot podium-slot" aria-hidden="true" />
          <ol className="podium-list">
            {top.map((e, i) => (
              <li key={e.account_id} className={`pod pod--${i + 1}`} style={{ "--i": i } as React.CSSProperties}>
                <div className="pod-paper">
                  <span className="pod-rank">{i + 1}</span>
                  <a className="pod-name" href={accountLink(e.account_id)} title={e.account_id}>
                    {short(e.account_id)}
                  </a>
                  {e.account_id === wallet.accountId && <span className="pod-you">You</span>}
                  <RollingNumber value={fmtUnits(e.points, 0)} className="pod-points" />
                  <span className="pod-change">{signed(e.points)} since the start</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {rest.length > 0 && (
        <ol className="ranks" start={4}>
          {rest.map((e, i) => {
            const value = Number(fmtUnits(e.points).replaceAll(",", "")) || 0;
            return (
              <li key={e.account_id} className={e.account_id === wallet.accountId ? "rank rank--you" : "rank"}>
                <span className="rank-no">{i + 4}</span>
                <a href={accountLink(e.account_id)} className="break">
                  {e.account_id}
                </a>
                <span className="rank-points">{fmtUnits(e.points)}</span>
                <span className="rank-change">{signed(e.points)}</span>
                <i className="rank-bar" style={{ transform: `scaleX(${Math.max(value / highest, 0.02)})` }} />
              </li>
            );
          })}
        </ol>
      )}
      <p className="hint" style={{ marginTop: 24 }}>Points in open forecasts don&apos;t count until you collect them, so someone with many open forecasts may rank lower for now.</p>
    </>
  );
}
