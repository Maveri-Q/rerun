"use client";

import { ClaimSpec, canonicalJson } from "@rerun/shared/browser";
import Link from "next/link";
import { nearToYocto } from "near-api-js";
import { useState } from "react";
import { ScoutSieve } from "@/components/ScoutSieve";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab, type ScoutCandidate } from "@/lib/lab";
import { rangeText, relativeTime } from "@/lib/market";
import { explainError, useWallet } from "@/lib/wallet";

const DECISION_WORDS = { approved: "Approved", sent_to_you: "Sent to a person", rejected: "Rejected" } as const;
const LIQUIDITY_UNITS = 40_000_000n;
const CHALLENGE_SECS = 24 * 3600;
const FORECAST_DAYS = 7;

function buildSpec(c: ScoutCandidate, margin: string) {
  const d = c.draft!;
  return ClaimSpec.safeParse({
    version: 1,
    title: (d.question || d.title).slice(0, 120),
    statement: d.statement,
    source: { type: "paper", url: c.paperUrl, license: c.license ?? d.license, authors: d.authors || "See the paper" },
    artifact: {
      repo_url: d.repo_url,
      commit: d.commit,
      data: [],
      runtime: d.runtime,
      setup: d.setup,
      entrypoint: d.entrypoint,
      output: { path: d.output_path, extractor: { type: d.extractor_type, expr: d.extractor_expr } },
    },
    metric: { name: d.metric_name || "reported result", reported_value: d.reported_value, tolerance: { type: "abs", value: margin }, comparison: "within_tolerance" },
    resources: { cpu: 2, mem_gb: 4, max_minutes: 15 },
    private_data: null,
  });
}

function Suggestion({ c, isOwner, onDone }: { c: ScoutCandidate; isOwner: boolean; onDone: () => void }) {
  const wallet = useWallet();
  const d = c.draft!;
  const [margin, setMargin] = useState("0.01");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const spec = buildSpec(c, margin);
  let range = "";
  try {
    range = rangeText(d.reported_value, "abs", margin);
  } catch {
    range = "";
  }

  const approve = async () => {
    if (!spec.success) return;
    const json = canonicalJson(spec.data);
    setMessage(null);
    try {
      setBusy("Saving the claim…");
      const deposit = nearToYocto((0.1 + json.length / 50_000).toFixed(4) as `${number}`).toString();
      await wallet.call("create_market", { spec_json: json, lock_time: Math.floor(Date.now() / 1000) + FORECAST_DAYS * 86_400, challenge_window: CHALLENGE_SECS, mode: "points" }, { deposit, tgas: 150 });
      const drafts = await chain.markets({ state: "Draft" }, 50);
      const mine = drafts.filter((m) => m.creator === wallet.accountId && m.spec.title === spec.data.title).at(-1);
      if (!mine) throw new Error("The claim was saved, but it couldn't be found to fund. Check For researchers.");
      setBusy("Opening it for forecasts…");
      await wallet.call("fund_market", { market_id: mine.id, initial_liquidity: LIQUIDITY_UNITS.toString() }, { deposit: nearToYocto("0.02").toString() });
      await lab.scoutApproved(c.id, mine.id);
      setMessage({ ok: true, text: `Claim ${mine.id} is open.` });
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="suggestion">
      <div className="receipt-top">
        <b>{c.source}</b>
        <span>{c.runtime === "r4.4" ? "R" : "Python"}</span>
      </div>
      <h3>{d.question || d.title}</h3>
      <p className="suggestion-score">
        <b>{d.relatability} of 10</b> for relatability, {d.topic}. {d.relatability_why}
        {c.attention && ` ${c.attention.label} (${c.attention.source}).`}
      </p>
      <p>{d.statement}</p>
      <dl className="receipt-lines">
        <div>
          <dt>Number to check</dt>
          <dd>{d.reported_value}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{c.license ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Run command</dt>
          <dd className="break">{d.entrypoint}</dd>
        </div>
      </dl>
      <p className="suggestion-links">
        <a href={c.paperUrl}>Read the paper</a> <a href={d.repo_url}>See the code</a>
      </p>
      {d.notes && <p className="suggestion-note">AI note: {d.notes}</p>}
      <details>
        <summary>Why the scout suggested this</summary>
        <ul>
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
      {isOwner ? (
        <div className="suggestion-approve">
          <label>
            Allowed margin
            <input className="mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
          </label>
          <p>{range ? `A rerun counts if it gets ${range}.` : "Enter a number, such as 0.01."}</p>
          <label className="suggestion-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>I checked {d.reported_value} against the paper. The AI drafted it from the repository, and it can be wrong.</span>
          </label>
          <button disabled={!checked || !spec.success || busy !== null} onClick={() => void approve()}>
            {busy ?? "Approve and open this claim"}
          </button>
          {!spec.success && <p className="notice notice--error">This draft can't be posted as it is: {spec.error.issues[0]?.message}. Use the form under For researchers to fix it.</p>}
        </div>
      ) : (
        <p className="hint">Only the site&apos;s owner can approve a suggestion.</p>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}
    </li>
  );
}

/** A claim the approver drafted, inside its 6-hour wait. Cancelling happens on the blockchain, so it works with the Lab off. */
function OpeningSoon({ marketId, title, opensAt, isOwner, onDone }: { marketId: number; title: string; opensAt?: number; isOwner: boolean; onDone: () => void }) {
  const wallet = useWallet();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const cancel = async () => {
    setMessage(null);
    setBusy(true);
    try {
      await wallet.call("cancel_draft", { market_id: marketId });
      setMessage({ ok: true, text: `Claim ${marketId} is cancelled. It won't open.` });
      setAsking(false);
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="opening-soon">
      <span className="mono">Claim {marketId}</span>
      <span>{title}</span>
      <span>{opensAt ? `Opens ${relativeTime(opensAt)}` : "Not open yet"}</span>
      {isOwner && !message?.ok && (
        <div className="opening-soon-cancel">
          {asking ? (
            <>
              <p className="hint">Cancel claim {marketId}? It won&apos;t open for forecasts, and you can&apos;t bring it back. A new one would need its own approval.</p>
              <button className="btn btn--small" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelling…" : `Cancel claim ${marketId}`}</button>{" "}
              <button className="btn quiet btn--small" disabled={busy} onClick={() => setAsking(false)}>Keep it</button>
            </>
          ) : (
            <button className="btn quiet btn--small" onClick={() => setAsking(true)}>Cancel this claim</button>
          )}
        </div>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}
    </li>
  );
}

export default function ScoutPage() {
  const wallet = useWallet();
  const scout = usePoll(() => lab.scout(), [], 30_000);
  const config = usePoll(() => chain.config(), []);
  const all = scout.data ? Object.values(scout.data.candidates) : [];
  const pending = all.filter((c) => c.status === "pending" && c.draft).sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0));
  const turnedDown = all.filter((c) => c.status === "rejected");
  const approved = all.filter((c) => c.status === "approved");
  const waiting = all.filter((c) => c.status === "waiting");
  const decisions = [...(scout.data?.decisions ?? [])].reverse().slice(0, 30);
  const isOwner = Boolean(wallet.accountId && wallet.accountId === config.data?.owner);
  // The blockchain says what's still waiting, so the owner can cancel even when the scout's list is old or the Lab is off.
  const drafts = usePoll(() => chain.markets({ state: "Draft" }, 100), [], 30_000);
  const known = new Set(waiting.map((c) => c.marketId));
  const opening = [
    ...waiting
      .filter((c) => c.marketId !== undefined && (!drafts.data || drafts.data.some((m) => m.id === c.marketId)))
      .map((c) => ({ marketId: c.marketId!, title: c.draft?.question ?? c.title, opensAt: c.opensAt })),
    ...(isOwner ? (drafts.data ?? []).filter((m) => !known.has(m.id) && m.creator !== wallet.accountId).map((m) => ({ marketId: m.id, title: m.spec.title, opensAt: undefined })) : []),
  ];
  const refreshWaiting = () => {
    void scout.refresh();
    void drafts.refresh();
  };

  return (
    <>
      <h1 className="page-title">The scout finds. A person decides.</h1>
      <p className="lede">Twice a day, an AI agent looks for published research with code and data anyone can rerun, and drafts a claim for each paper that passes its checks. Nothing goes live until a person approves it.</p>
      <p className="hint">{scout.data?.lastScanAt ? `Last scan: ${new Date(scout.data.lastScanAt).toLocaleString()}. ` : ""}It reads replication code on everyday topics from GitHub, the journal ReScience C and Hugging Face Papers. It never runs anyone&apos;s code.</p>

      {all.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="big-head">Most papers can&apos;t be rerun</h2>
          </div>
          <p className="lede">Of the {all.length} papers read so far, here&apos;s where each one stopped. Being turned down says nothing about the research. It means the Lab can&apos;t test it fairly, so the scout moves on.</p>
          <ScoutSieve candidates={all} />
          <p className="hint">Interest only decides which paper a person reviews first. Citations and an AI&apos;s score of how much people would care put the widely known papers on top, and neither can touch a verdict.</p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="big-head">Waiting for review</h2>
        </div>
        {scout.error && !scout.data && <p className="empty">The Lab is offline, so the scout&apos;s list isn&apos;t available right now.</p>}
        {scout.data && pending.length === 0 && <p className="empty">Nothing is waiting. New suggestions appear here after the next scan.</p>}
        <ul className="suggestions">
          {pending.map((c) => (
            <Suggestion key={c.id} c={c} isOwner={isOwner} onDone={() => void scout.refresh()} />
          ))}
        </ul>
      </section>

      {opening.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Opening soon</h2>
          </div>
          <p className="hint">The approver passed these. Each stays closed for 6 hours, so the site&apos;s owner can cancel it first.</p>
          <ul className="opening-list">
            {opening.map((o) => (
              <OpeningSoon key={o.marketId} {...o} isOwner={isOwner} onDone={refreshWaiting} />
            ))}
          </ul>
        </section>
      )}

      {approved.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Approved</h2>
          </div>
          <ul className="feed">
            {approved.map((c) => (
              <li key={c.id}>
                <Link className="mono" href={`/market/${c.marketId}`}>
                  Claim {c.marketId}
                </Link>
                <span>{c.draft?.title ?? c.title}</span>
                <span />
              </li>
            ))}
          </ul>
        </section>
      )}

      {decisions.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>What the approver decided</h2>
          </div>
          <ul className="decision-log">
            {decisions.map((d) => (
              <li key={`${d.at}-${d.id}-${d.result}`}>
                <b>{DECISION_WORDS[d.result]}</b>
                <span>{d.title}</span>
                <p className="hint">{d.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {turnedDown.length > 0 && (
        <section className="section">
          <details>
            <summary>Every paper turned down, and why ({turnedDown.length})</summary>
            <ul className="scout-rejected">
              {turnedDown.map((c) => (
                <li key={c.id}>
                  <a href={c.paperUrl}>{c.title}</a>
                  <p>{c.reasons.join(" ")}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
