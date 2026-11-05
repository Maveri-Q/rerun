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
});
