"use client";

import { useState } from "react";
import { usePoll } from "@/components/usePoll";
import { chain } from "@/lib/chain";
import { lab, type ClaimNote } from "@/lib/lab";
import { fmtUnits, modeUnit, type Market } from "@/lib/market";
import { explainError, useWallet } from "@/lib/wallet";

const ROLE_LABEL = { author: "Says they're an author", creator: "Opened this claim" } as const;

/** A declared connection, and what that account currently holds, so readers can weigh what it says. */
function Badge({ note, market }: { note: ClaimNote; market: Market }) {
  const position = usePoll(() => chain.position(note.account, market.id), [note.account, market.id], 60_000);
  if (!note.role) return null;
  const p = position.data;
  const yes = p ? BigInt(p.yes) : 0n;
  const no = p ? BigInt(p.no) : 0n;
  const stake = yes > 0n || no > 0n ? `Holds ${fmtUnits(yes)} YES and ${fmtUnits(no)} NO, in ${modeUnit(market.mode)}` : "Holds no forecast here";
  return <span className="coi-badge">{ROLE_LABEL[note.role]}. {stake}.</span>;
}

export function ClaimNotes({ market }: { market: Market }) {
  const wallet = useWallet();
  const notes = usePoll(() => lab.notes(market.id), [market.id], 30_000);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [role, setRole] = useState<"author" | "creator">("author");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const all = notes.data ?? [];
  const me = wallet.accountId;
  const declared = all.find((n) => n.kind === "declare" && n.account === me);
  const declarations = all.filter((n) => n.kind === "declare");
  const top = all.filter((n) => n.kind === "note");

  const post = async (kind: "note" | "reply" | "declare", body: string, parent: string | null, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await lab.addNote(wallet, { market: market.id, kind, text: body, role: kind === "declare" ? role : null, parent });
      setText("");
      setReplyTo(null);
      setMessage({ ok: true, text: done });
      void notes.refresh();
    } catch (e) {
      setMessage({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section" id="notes">
      <div className="section-head">
        <h2>Community notes</h2>
      </div>
      <p className="hint" style={{ maxWidth: "62ch" }}>
        Notes are people&apos;s own words, signed by their wallets. They never change a verdict, and the Lab&apos;s AI never reads them.
      </p>

      {notes.error && !notes.data && <p className="dim">The Lab keeps these notes, and it isn&apos;t answering right now. The verdict and receipt above don&apos;t depend on it.</p>}
      {declarations.length > 0 && (
        <ul className="coi-list">
          {declarations.map((d) => (
            <li key={d.id}>
              <b className="mono">{d.account}</b> <Badge note={d} market={market} />
              {d.text && <p>{d.text}</p>}
            </li>
          ))}
        </ul>
      )}
      {notes.data && top.length === 0 && <p className="empty">No notes on this claim yet. Spotted something in the paper or the code? Add the first one.</p>}
      {top.length > 0 && (
        <ul className="note-list">
          {top.map((n) => (
            <li key={n.id} className="note">
              <p className="note-who"><b className="mono">{n.account}</b> <Badge note={n} market={market} /></p>
              <p>{n.text}</p>
              {all
                .filter((r) => r.kind === "reply" && r.parent === n.id)
                .map((r) => (
                  <div key={r.id} className="note note--reply">
                    <p className="note-who"><b className="mono">{r.account}</b> replied <Badge note={r} market={market} /></p>
                    <p>{r.text}</p>
                  </div>
                ))}
              {declared && (
                <button className="btn--small" onClick={() => setReplyTo(n.id)} disabled={busy}>
                  Reply to this note
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!me ? (
        <button onClick={wallet.signIn} disabled={wallet.loading}>Connect a wallet to add a note</button>
      ) : (
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post(replyTo ? "reply" : "note", text, replyTo, replyTo ? "Reply posted." : "Note posted.");
          }}
        >
          <label htmlFor="note-text">{replyTo ? "Your reply" : "Your note"}</label>
          <textarea id="note-text" value={text} maxLength={600} rows={3} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? "Waiting for your wallet…" : replyTo ? "Sign and post reply" : "Sign and post note"}
          </button>
          {replyTo && <button type="button" className="btn--small" onClick={() => setReplyTo(null)}>Cancel reply</button>}
        </form>
      )}

      {me && !declared && (
        <details className="note-declare">
          <summary>Connected to this paper or claim? Declare it</summary>
          <p className="hint">Your account gets a visible badge showing your connection and what you hold here. Authors can then reply to notes.</p>
          <select aria-label="Your connection" value={role} onChange={(e) => setRole(e.target.value as "author" | "creator")}>
            <option value="author">I&apos;m an author of the paper</option>
            {me === market.creator && <option value="creator">I opened this claim</option>}
          </select>
          <button disabled={busy} onClick={() => void post("declare", "", null, "Declared. Your badge is showing.")}>
            Sign and declare
          </button>
        </details>
      )}
      {message && <p className={`notice ${message.ok ? "notice--ok" : "notice--error"}`} role="status">{message.text}</p>}
    </section>
  );
}
