import { describe, expect, it, vi } from "vitest";
import { AUTO_LIMITS, checksFor, runApprover, type ApproverDeps } from "./approver.ts";
import { emptyState, type Candidate, type ScoutState } from "./scout.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const nowSecs = NOW.getTime() / 1000;

const draft = {
  repo_url: "https://github.com/someone/paper",
  commit: "a".repeat(40),
  title: "A finding",
  statement: "A finding people care about.",
  authors: "Someone",
  license: "MIT",
  runtime: "python3.11",
  setup: [],
  entrypoint: "python run.py",
  output_path: "out.json",
  extractor_type: "jsonpath",
  extractor_expr: "$.value",
  metric_name: "the value",
  reported_value: "1.5",
  notes: "",
  question: "Does this finding hold up?",
  topic: "health",
  relatability: 8,
  relatability_why: "Affects daily life.",
} as Candidate["draft"];

function candidate(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    source: "ReScience C",
    title: `Paper ${id}`,
    paperUrl: "https://doi.org/10.1/x",
    repoUrl: "https://github.com/someone/paper",
    status: "pending",
    reasons: ["Open licence: MIT.", "The number 1.5 appears near this wording in the paper, read from x, and a second AI on a different model picked it too."],
    checkedAt: NOW.toISOString(),
    license: "MIT",
    runtime: "python",
    draft,
    ...over,
  };
}

function setup(candidates: Candidate[], over: Partial<ApproverDeps> = {}) {
  let nextId = 100;
  const createDraft = vi.fn(async (_c: Candidate, _margin: string, _lockTime: number) => nextId++);
  const deps = {
    firstMargin: vi.fn(async () => "0.05"),
    secondMargin: vi.fn(async () => "0.05"),
    createDraft,
    open: vi.fn(async () => {}),
    stillDraft: vi.fn(async () => true),
    now: () => NOW,
    ...over,
  };
  const state: ScoutState = { ...emptyState(), candidates: Object.fromEntries(candidates.map((c) => [c.id, c])) };
  return { deps, state, createDraft };
}

describe("the safe approver", () => {
  it("makes a draft when everything passes, and it waits 6 hours", async () => {
    const { deps, state } = setup([candidate("a")]);
    const next = await runApprover(state, deps);
    expect(next.candidates.a).toMatchObject({ status: "waiting", marketId: 100, opensAt: nowSecs + 6 * 3600 });
    expect(deps.open).not.toHaveBeenCalled();
    expect(next.decisions!.at(-1)).toMatchObject({ result: "approved", id: "a" });
  });

  it("gives forecasters their full time after the wait", async () => {
    const { deps, state, createDraft } = setup([candidate("a")]);
    await runApprover(state, deps);
    expect(createDraft.mock.calls[0]![2]).toBe(nowSecs + AUTO_LIMITS.waitSecs + AUTO_LIMITS.forecastDays * 86_400);
  });

  it("opens a draft only after the wait, and only if nobody cancelled it", async () => {
    const waiting = candidate("a", { status: "waiting", marketId: 7, opensAt: nowSecs + 60 });
    const early = setup([waiting]);
    await runApprover(early.state, early.deps);
    expect(early.deps.open).not.toHaveBeenCalled();

    const due = setup([{ ...waiting, opensAt: nowSecs - 1 }]);
    const opened = await runApprover(due.state, due.deps);
    expect(due.deps.open).toHaveBeenCalledWith(7);
    expect(opened.candidates.a!.status).toBe("approved");

    const cancelled = setup([{ ...waiting, opensAt: nowSecs - 1 }], { stillDraft: vi.fn(async () => false) });
    const back = await runApprover(cancelled.state, cancelled.deps);
    expect(cancelled.deps.open).not.toHaveBeenCalled();
    expect(back.candidates.a).toMatchObject({ status: "pending", autoReviewed: true });
  });

  it("never approves more than 3 in a day, and looks at the rest tomorrow", async () => {
    const { deps, state } = setup(["a", "b", "c", "d", "e"].map((id) => candidate(id)));
    const next = await runApprover(state, deps);
    expect(deps.createDraft).toHaveBeenCalledTimes(3);
    const held = Object.values(next.candidates).filter((c) => c.status === "pending");
    expect(held).toHaveLength(2);
    expect(held.every((c) => !c.autoReviewed)).toBe(true);

    const again = await runApprover(next, deps);
    expect(deps.createDraft).toHaveBeenCalledTimes(3);
    const tomorrow = await runApprover(again, { ...deps, now: () => new Date(NOW.getTime() + 86_400_000) });
    expect(deps.createDraft).toHaveBeenCalledTimes(5);
    expect(tomorrow.candidates.e!.status).toBe("waiting");
  });

  it.each([
    ["an untrusted source", { source: "Hugging Face Papers" }, /Trusted source/],
    ["too few citations", { source: "Replication code on GitHub", attention: { source: "OpenAlex", label: "3", value: 3 } }, /Trusted source/],
    ["no reuse licence", { reasons: ["The number 1.5 appears near this wording in the paper, and a second AI on a different model picked it too."] }, /Reuse licence/],
    ["an unconfirmed number", { reasons: ["Open licence: MIT."] }, /Number near/],
    ["another language", { runtime: "julia" }, /Python or R/],
    ["no draft", { draft: undefined }, /Has a draft/],
  ] as const)("sends a paper with %s to you, and signs nothing", async (_, over, reason) => {
    const { deps, state } = setup([candidate("a", over as Partial<Candidate>)]);
    const next = await runApprover(state, deps);
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(next.candidates.a!.status).toBe("pending");
    expect(next.decisions!.at(-1)!.result).toBe("sent_to_you");
    expect(next.decisions!.at(-1)!.why).toMatch(reason);
  });

  it("sends it to you when the AIs disagree on the margin, or one can't answer", async () => {
    const differ = setup([candidate("a")], { secondMargin: vi.fn(async () => "0.5") });
    const next = await runApprover(differ.state, differ.deps);
    expect(differ.deps.createDraft).not.toHaveBeenCalled();
    expect(next.decisions!.at(-1)!.why).toMatch(/disagreed/);

    const down = setup([candidate("a")], { firstMargin: vi.fn(async () => { throw new Error("no reply"); }) });
    const after = await runApprover(down.state, down.deps);
    expect(down.deps.createDraft).not.toHaveBeenCalled();
    expect(after.candidates.a!.autoReviewed).toBe(true);
  });

  it("doesn't look at a paper twice, and spends no AI on one that already failed", async () => {
    const { deps, state } = setup([candidate("a", { source: "Hugging Face Papers" })]);
    const next = await runApprover(state, deps);
    await runApprover(next, deps);
    expect(deps.firstMargin).not.toHaveBeenCalled();
    expect((await runApprover(next, deps)).decisions).toHaveLength(1);
  });

  it("checks citations only for the GitHub route", () => {
    const passed = (c: Candidate) => checksFor(c).find((x) => x.name === "Trusted source")!.passed;
    expect(passed(candidate("a"))).toBe(true);
    expect(passed(candidate("a", { source: "Replication code on GitHub", attention: { source: "OpenAlex", label: "50", value: 50 } }))).toBe(true);
  });
});
