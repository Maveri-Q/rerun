import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KeyPair, KeyPairSigner, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { afterEach, describe, expect, it } from "vitest";
import { NOTES_RECIPIENT, NotesStore, type NoteMessage, type SignedNote } from "./notes.ts";

const NOW = 1_800_000_000_000;
const pair = KeyPair.fromRandom("ed25519");
const signer = new KeyPairSigner(pair);
const dirs: string[] = [];

/** Real signing and real verification. Only the chain's list of keys is stubbed. */
function store(permission: unknown = "FullAccess") {
  const dir = mkdtempSync(path.join(tmpdir(), "notes-"));
  dirs.push(dir);
  // The chain answers only for accounts that really hold this key.
  const provider = {
    viewAccessKey: async ({ accountId }: { accountId: string }) => {
      if (accountId === "bob.testnet") throw new Error("access key does not exist");
      return { permission };
    },
  } as unknown as Provider;
  return new NotesStore(dir, {
    now: () => NOW,
    creatorOf: async (m) => (m === 1 ? "creator.testnet" : null),
    verify: (accountId, publicKey, message, nonce, signature) => verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, payload: { message, recipient: NOTES_RECIPIENT, nonce }, signature, provider }),
  });
}

let counter = 0;
async function sign(account: string, over: Partial<NoteMessage>): Promise<SignedNote> {
  const message = JSON.stringify({ app: NOTES_RECIPIENT, market: 1, kind: "note", text: "A point about the data", role: null, parent: null, time: NOW, ...over });
  const nonce = new Uint8Array(32).fill(++counter % 255);
  const signed = await signer.signNep413Message(account, { message, recipient: NOTES_RECIPIENT, nonce });
  return { account_id: account, public_key: pair.getPublicKey().toString(), signature: Buffer.from(signed.signature).toString("base64"), nonce: Buffer.from(nonce).toString("base64"), message };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("NotesStore", () => {
  it("posts a signed note under the signing account", async () => {
    const s = store();
    const note = await s.add(await sign("alice.testnet", {}));
    expect(note.account).toBe("alice.testnet");
    expect(s.list(1).map((n) => n.text)).toEqual(["A point about the data"]);
  });

  it("refuses text changed after signing", async () => {
    const s = store();
    const signed = await sign("alice.testnet", {});
    signed.message = signed.message.replace("A point", "Another point");
    await expect(s.add(signed)).rejects.toThrow(/didn't check out/);
    expect(s.list(1)).toEqual([]);
  });

  it("refuses a signature from someone else's name", async () => {
    const s = store();
    const signed = await sign("alice.testnet", {});
    signed.account_id = "bob.testnet";
    await expect(s.add(signed)).rejects.toThrow(/didn't check out/);
  });

  it("refuses a key that isn't full access", async () => {
    await expect(store({ FunctionCall: {} }).add(await sign("alice.testnet", {}))).rejects.toThrow(/didn't check out/);
  });

  it("refuses the same signature twice, and old signatures", async () => {
    const s = store();
    const signed = await sign("alice.testnet", {});
    await s.add(signed);
    await expect(s.add(signed)).rejects.toThrow(/already posted/);
    await expect(s.add(await sign("alice.testnet", { time: NOW - 11 * 60_000 }))).rejects.toThrow(/too old/);
  });

  it("limits how much one account can post", async () => {
    const s = store();
    for (let i = 0; i < 6; i++) await s.add(await sign("alice.testnet", { text: `note ${i}` }));
    await expect(s.add(await sign("alice.testnet", {}))).rejects.toThrow(/this hour/);
  });

  it("only lets a claim's real creator declare as its creator", async () => {
    const s = store();
    await expect(s.add(await sign("alice.testnet", { kind: "declare", role: "creator", text: "" }))).rejects.toThrow(/Only the account/);
    expect((await s.add(await sign("creator.testnet", { kind: "declare", role: "creator", text: "" }))).role).toBe("creator");
  });

  it("marks later notes from someone who declared", async () => {
    const s = store();
    await s.add(await sign("author.testnet", { kind: "declare", role: "author", text: "I wrote this paper" }));
    expect((await s.add(await sign("author.testnet", {}))).role).toBe("author");
    await expect(s.add(await sign("author.testnet", { kind: "declare", role: "author", text: "" }))).rejects.toThrow(/already declared/);
  });

  it("lets only a declared person reply, and only to a note on this claim", async () => {
    const s = store();
    const first = await s.add(await sign("alice.testnet", {}));
    await expect(s.add(await sign("carol.testnet", { kind: "reply", parent: first.id }))).rejects.toThrow(/Declare/);
    await s.add(await sign("author.testnet", { kind: "declare", role: "author", text: "" }));
    expect((await s.add(await sign("author.testnet", { kind: "reply", parent: first.id, text: "Here's why" }))).parent).toBe(first.id);
    await expect(s.add(await sign("author.testnet", { kind: "reply", parent: "nope" }))).rejects.toThrow(/isn't there/);
  });

  it("refuses unknown claims, empty notes and long notes", async () => {
    const s = store();
    await expect(s.add(await sign("alice.testnet", { market: 2 }))).rejects.toThrow(/no claim 2/);
    await expect(s.add(await sign("alice.testnet", { text: "   " }))).rejects.toThrow(/Write something/);
    await expect(s.add(await sign("alice.testnet", { text: "x".repeat(601) }))).rejects.toThrow(/600 characters/);
  });
});
