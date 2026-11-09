import { describe, expect, it } from "vitest";
import { RollingDemos, type RollingMarket } from "./rolling.ts";

const NOW = 1_800_000_000;

function setup(markets: RollingMarket[] = [], opts = { windowSecs: 300, everySecs: 3600, maxPerDay: 3 }) {
  const posted: string[] = [];
  const finalized: number[] = [];
  let clock = NOW;
  const demos = new RollingDemos(
    {
      list: async () => markets,
      post: async (name) => {
        posted.push(name);
        return 100 + posted.length;
      },
      finalize: async (id) => void finalized.push(id),
      now: () => clock * 1000,
    },
    opts,
  );
  return { demos, posted, finalized, advance: (s: number) => (clock += s) };
}

const demo = (over: Partial<RollingMarket>): RollingMarket => ({ id: 1, state: "Open", lock_time: NOW + 200, challenge_deadline: null, spec: { title: "[DEMO] A claim" }, ...over });

describe("RollingDemos", () => {
  it("sends Try it now to the demo that's already open", async () => {
    const { demos, posted } = setup([demo({ id: 7 })]);
    expect(await demos.tryNow()).toBe(7);
    expect(posted).toEqual([]);
  });

  it("posts a new demo when the open one is about to lock", async () => {
    const { demos, posted } = setup([demo({ id: 7, lock_time: NOW + 10 })]);
    expect(await demos.tryNow()).toBe(101);
    expect(posted).toEqual(["reproduces"]);
  });

  it("ignores an older demo that stays open for days", async () => {
    const { demos, posted } = setup([demo({ id: 10, lock_time: NOW + 5 * 86_400 })]);
    expect(await demos.tryNow()).toBe(101);
    expect(posted).toHaveLength(1);
  });

  it("never treats a published paper's open claim as a demo", async () => {
    const { demos, posted } = setup([demo({ id: 20, spec: { title: "Temperature explains water loss" } })]);
    expect(await demos.tryNow()).toBe(101);
    expect(posted).toHaveLength(1);
  });

  it("alternates between claims that hold up and claims that don't", async () => {
    const { demos, posted } = setup();
    await demos.tryNow();
    await demos.tryNow();
    expect(posted).toEqual(["reproduces", "misreported"]);
  });

  it("stops at the daily limit", async () => {
    const { demos } = setup();
    await demos.tryNow();
    await demos.tryNow();
    await demos.tryNow();
    await expect(demos.tryNow()).rejects.toThrow(/used/);
  });

  it("posts on schedule, not on every tick", async () => {
    const { demos, posted, advance } = setup();
    await demos.tick();
    await demos.tick();
    expect(posted).toHaveLength(1);
    advance(3601);
    await demos.tick();
    expect(posted).toHaveLength(2);
  });

  it("finalizes only demos whose challenge window has passed", async () => {
    const { demos, finalized } = setup([
      demo({ id: 1, state: "Proposed", challenge_deadline: NOW - 1 }),
      demo({ id: 2, state: "Proposed", challenge_deadline: NOW + 60 }),
      demo({ id: 3, state: "Proposed", challenge_deadline: NOW - 1, spec: { title: "A published paper" } }),
    ]);
    await demos.tick();
    expect(finalized).toEqual([1]);
  });

  it("collects its share of a demo once it's final, so the liquidity comes back", async () => {
    const collected: number[] = [];
    const demos = new RollingDemos(
      { list: async () => [demo({ id: 4, state: "Proposed", challenge_deadline: NOW - 1 })], post: async () => 1, finalize: async () => {}, collect: async (id) => void collected.push(id), now: () => NOW * 1000 },
      { windowSecs: 300, everySecs: 3600, maxPerDay: 3 },
    );
    await demos.tick();
    expect(collected).toEqual([4]);
  });

  it("tops up the points before a demo when they run low, and clears the warning", async () => {
    let points = 78.74;
    const warned: (string | null)[] = [];
    const demos = new RollingDemos(
      { list: async () => [], post: async () => 9, finalize: async () => {}, balance: async () => points, topUp: async (n) => void (points += n), warn: (m) => warned.push(m), now: () => NOW * 1000 },
      { windowSecs: 300, everySecs: 3600, maxPerDay: 3, lowPoints: 1_000, topUpPoints: 5_000 },
    );
    expect(await demos.tryNow()).toBe(9);
    expect(points).toBeCloseTo(5_078.74);
    expect(warned.at(-1)).toBeNull();
  });

  it("warns and posts nothing when the top-up fails and the points can't pay for a demo", async () => {
    const warned: (string | null)[] = [];
    let posted = 0;
    const demos = new RollingDemos(
      {
        list: async () => [],
        post: async () => ++posted,
        finalize: async () => {},
        balance: async () => 78.74,
        topUp: async () => {
          throw new Error("owner only");
        },
        warn: (m) => warned.push(m),
        now: () => NOW * 1000,
      },
      { windowSecs: 300, everySecs: 3600, maxPerDay: 3 },
    );
    await expect(demos.tryNow()).rejects.toThrow("not enough points");
    expect(posted).toBe(0);
    expect(warned.at(-1)).toMatch(/demo points are low: 78.74 left.*New demos are paused/);
  });
});
