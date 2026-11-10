import { actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, KeyPair } from "near-api-js";
import { describe, expect, it, vi } from "vitest";
import { DailyCaps, MIN_STORAGE, relay, RELAYS_PER_ACCOUNT_PER_DAY, TOP_UP, type RelayDeps } from "./relay";

const CONTRACT = "rerun.rerun-43f5f2.testnet";
const key = KeyPair.fromRandom("ed25519");

function signed(opts: { receiver?: string; method?: string; args?: object; deposit?: bigint; tgas?: bigint; extra?: boolean } = {}): string {
  const call = actions.functionCall(opts.method ?? "buy", opts.args ?? { market_id: 7, outcome: "YES", amount: "1000000", min_shares_out: "0" }, (opts.tgas ?? 100n) * 10n ** 12n, opts.deposit ?? 0n);
  const delegateAction = buildDelegateAction({
    senderId: "someone.testnet",
    receiverId: opts.receiver ?? CONTRACT,
    actions: opts.extra ? [call, call] : [call],
    nonce: 5n,
    maxBlockHeight: 1_000n,
    publicKey: key.getPublicKey(),
  });
  const { signature } = key.sign(new Uint8Array(encodeDelegateAction(delegateAction)));
  const wrapped = actions.signedDelegate({ delegateAction, signature: { ed25519Signature: { data: signature } } as never });
  return Buffer.from(encodeSignedDelegate(wrapped.signedDelegate!)).toString("base64");
}

function deps(over: Partial<RelayDeps> = {}): RelayDeps & { sent: number; toppedUp: bigint[] } {
  const d = {
    sent: 0,
    toppedUp: [] as bigint[],
    marketMode: async () => "points",
    storageBalance: async () => MIN_STORAGE,
    topUp: async (_: string, y: bigint) => void d.toppedUp.push(y),
    send: async () => {
      d.sent += 1;
      return { hash: "abc" };
    },
    ...over,
  };
  return d;
}

describe("gas-free relayer", () => {
  it("submits a points forecast and reports the transaction", async () => {
    const d = deps();
    await expect(relay(signed(), CONTRACT, new DailyCaps(), d)).resolves.toEqual({ submitted: true, hash: "abc" });
    expect(d.sent).toBe(1);
  });

  it("refuses, without sending, anything outside a points forecast", async () => {
    const cases: Array<[string, Parameters<typeof signed>[0], Partial<RelayDeps>?]> = [
      ["another contract", { receiver: "evil.testnet" }],
      ["a method it doesn't pay for", { method: "withdraw", args: {} }],
      ["a deposit", { deposit: 1n }],
      ["too much gas", { tgas: 300n }],
      ["two calls", { extra: true }],
      ["a money claim", {}, { marketMode: async () => "money" }],
      ["a missing claim", {}, { marketMode: async () => null }],
    ];
    for (const [, opts, over] of cases) {
      const d = deps(over);
      await expect(relay(signed(opts), CONTRACT, new DailyCaps(), d)).rejects.toMatchObject({ name: "Error" });
      expect(d.sent).toBe(0);
    }
    await expect(relay("not a delegate", CONTRACT, new DailyCaps(), deps())).rejects.toThrow("isn't a signed delegate");
  });

  it("lets claim_points through without naming a claim", async () => {
    const d = deps({ marketMode: vi.fn() });
    await relay(signed({ method: "claim_points", args: {} }), CONTRACT, new DailyCaps(), d);
    expect(d.marketMode).not.toHaveBeenCalled();
    expect(d.sent).toBe(1);
  });

  it("prepays storage once a day for an account that has none", async () => {
    const caps = new DailyCaps(() => "2026-11-10");
    const d = deps({ storageBalance: async () => 0n });
    await relay(signed(), CONTRACT, caps, d);
    expect(d.toppedUp).toEqual([TOP_UP]);
    await expect(relay(signed(), CONTRACT, caps, d)).rejects.toThrow("already prepaid");
    expect(d.sent).toBe(1);
  });

  it("caps each account per day, and resets the next day", async () => {
    let day = "2026-11-10";
    const caps = new DailyCaps(() => day);
    const d = deps();
    for (let i = 0; i < RELAYS_PER_ACCOUNT_PER_DAY; i++) await relay(signed(), CONTRACT, caps, d);
    await expect(relay(signed(), CONTRACT, caps, d)).rejects.toMatchObject({ status: 429 });
    day = "2026-11-11";
    await expect(relay(signed(), CONTRACT, caps, d)).resolves.toMatchObject({ submitted: true });
  });
});
