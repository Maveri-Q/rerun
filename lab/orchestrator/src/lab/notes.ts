import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Community notes and conflict-of-interest declarations on a claim. Each one is signed by a NEAR
 * wallet (NEP-413), so nobody can post in someone else's name and no transaction is needed.
 * Notes are only ever shown to people: they never reach the AI, a run, a receipt or a verdict.
 */

export const NOTES_RECIPIENT = "rerun-notes";
export const MAX_NOTE_CHARS = 600;
const MAX_AGE_MS = 10 * 60_000;
const MAX_PER_HOUR = 6;

const Message = z.object({
  app: z.literal(NOTES_RECIPIENT),
  market: z.number().int().nonnegative(),
  kind: z.enum(["note", "reply", "declare"]),
  text: z.string().max(MAX_NOTE_CHARS),
  role: z.enum(["author", "creator"]).nullable(),
  parent: z.string().nullable(),
  time: z.number().int(),
});
export type NoteMessage = z.infer<typeof Message>;

export interface Note {
  id: string;
  market: number;
  account: string;
  kind: NoteMessage["kind"];
  text: string;
  role: NoteMessage["role"];
  parent: string | null;
  at: number;
  /** Removed by the operator, for spam or abuse. The text is no longer served. */
  hidden?: boolean;
}

export interface SignedNote {
  account_id: string;
  public_key: string;
  /** Base64. */
  signature: string;
  /** Base64, 32 bytes. */
  nonce: string;
  /** The exact JSON text the wallet signed. Only this is trusted, never other fields in the request. */
  message: string;
}

export interface NoteDeps {
  /** Throws unless this signature is good and the key is a full-access key of the account. */
  verify: (accountId: string, publicKey: string, message: string, nonce: Uint8Array, signature: Uint8Array) => Promise<void>;
  /** The account that opened the market, or null if there's no such market. */
  creatorOf: (market: number) => Promise<string | null>;
  now?: () => number;
}

export class NoteError extends Error {}

interface NoteFile {
  notes: Note[];
  seen: string[];
}

export class NotesStore {
  private readonly file: string;

  constructor(
    dir: string,
    private readonly deps: NoteDeps,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "notes.json");
  }

  private load(): NoteFile {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as NoteFile) : { notes: [], seen: [] };
  }

  private save(data: NoteFile) {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 1));
    renameSync(temp, this.file);
  }

  list(market: number): Note[] {
    return this.load()
      .notes.filter((n) => n.market === market && !n.hidden)
      .sort((a, b) => a.at - b.at);
  }

  async add(signed: SignedNote): Promise<Note> {
    const now = this.deps.now?.() ?? Date.now();
    if (typeof signed?.message !== "string" || typeof signed.account_id !== "string" || typeof signed.public_key !== "string") throw new NoteError("That note wasn't signed properly.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(signed.message);
    } catch {
      throw new NoteError("That note wasn't signed properly.");
    }
    const check = Message.safeParse(parsed);
    if (!check.success) throw new NoteError(`Keep a note to ${MAX_NOTE_CHARS} characters.`);
    const m = check.data;
    if (Math.abs(now - m.time) > MAX_AGE_MS) throw new NoteError("That signature is too old. Post the note again.");

    const nonce = Buffer.from(signed.nonce ?? "", "base64");
    const signature = Buffer.from(signed.signature ?? "", "base64");
    if (nonce.length !== 32 || signature.length === 0) throw new NoteError("That note wasn't signed properly.");
    try {
      await this.deps.verify(signed.account_id, signed.public_key, signed.message, nonce, signature);
    } catch {
      throw new NoteError("Your wallet's signature didn't check out, so the note wasn't posted.");
    }

    const data = this.load();
    const seenKey = createHash("sha256").update(signature).digest("hex");
    if (data.seen.includes(seenKey)) throw new NoteError("That note was already posted.");
    const recent = data.notes.filter((n) => n.account === signed.account_id && n.at > now - 3_600_000).length;
    if (recent >= MAX_PER_HOUR) throw new NoteError(`That's ${MAX_PER_HOUR} notes this hour, the most one account can post. Try again later.`);

    const creator = await this.deps.creatorOf(m.market);
    if (creator === null) throw new NoteError(`There is no claim ${m.market}.`);
    const text = m.text.trim();
    const declared = data.notes.find((n) => n.market === m.market && n.account === signed.account_id && n.kind === "declare" && !n.hidden);

    if (m.kind === "declare") {
      if (m.role === null) throw new NoteError("Say whether you're an author or the claim's creator.");
      if (m.role === "creator" && signed.account_id !== creator) throw new NoteError("Only the account that opened this claim can declare itself its creator.");
      if (declared) throw new NoteError("You've already declared your connection to this claim.");
    } else if (!text) {
      throw new NoteError("Write something before posting.");
    }
    if (m.kind === "reply") {
      if (!declared) throw new NoteError("Declare your connection to this claim before replying as an author.");
      if (!m.parent || !data.notes.some((n) => n.id === m.parent && n.market === m.market && n.kind === "note" && !n.hidden)) throw new NoteError("The note you're replying to isn't there any more.");
    }

    const note: Note = {
      id: seenKey.slice(0, 16),
      market: m.market,
      account: signed.account_id,
      kind: m.kind,
      text,
      role: m.kind === "declare" ? m.role : (declared?.role ?? null),
      parent: m.kind === "reply" ? m.parent : null,
      at: now,
    };
    data.notes.push(note);
    data.seen.push(seenKey);
    this.save(data);
    return note;
  }
}
