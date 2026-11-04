"use client";

import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { accountLink } from "@/lib/config";
import { fmtUnits } from "@/lib/market";
import { useWallet } from "@/lib/wallet";

const START = 1_000_000_000n;

export default function LeaderboardPage() {
  const board = usePoll(() => chain.leaderboard(), [], 30_000);
  const wallet = useWallet();
  return (
    <>
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Best forecasters</h1>
      <p className="lede prose">Everyone starts with 1,000 free points. Points can&apos;t be bought or transferred, so the only way up this list is forecasting well.</p>
      <section className="section">
        {board.error && !board.data && <p className="notice notice--error">Unable to load the leaderboard. This page keeps trying.</p>}
        {board.loading && !board.data && <p className="dim">Loading the leaderboard…</p>}
        {board.data && board.data.length === 0 && <p className="empty">Nobody has claimed points yet. Open any claim that uses points to be first.</p>}
        {board.data && board.data.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Forecaster</th>
                  <th className="num">Points</th>
                  <th className="num">Since start</th>
                </tr>
              </thead>
              <tbody>
                {board.data.map((e, i) => {
                  const change = BigInt(e.points) - START;
                  const mine = e.account_id === wallet.accountId;
                  return (
                    <tr key={e.account_id} style={mine ? { fontWeight: 700 } : undefined}>
                      <td className="num mono">{i + 1}</td>
                      <td className="break">
                        <a href={accountLink(e.account_id)}>{e.account_id}</a>
                        {mine && " (you)"}
                      </td>
                      <td className="num mono">{fmtUnits(e.points)}</td>
                      <td className="num mono">
                        {change >= 0n ? "+" : ""}
                        {fmtUnits(change)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Points in open forecasts don&apos;t count until you collect them, so someone with many open forecasts may rank lower for now.</p>
      </section>
    </>
  );
}
