import { describe, expect, it } from "vitest";
import type { ClaimDraft } from "../src/lab/draft.ts";
import { checkRepo, isClearNumber, type RepoFacts } from "../src/scout/filters.ts";
import { emptyState, LIMITS, parseArticleYaml, repoRoot, runScout, SUGGESTED_BY, type Lead } from "../src/scout/scout.ts";

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({ license: "MIT", languages: { Python: 9000, Shell: 100 }, sizeKb: 2000, archived: false, files: ["run.py"], dependencyText: "numpy\npandas", ...over });

const draft = (over: Partial<ClaimDraft> = {}): ClaimDraft => ({ repo_url: "https://github.com/a/b", commit: "c".repeat(40), title: "T", statement: "S", authors: "A", license: "MIT", runtime: "python3.11", setup: [], entrypoint: "python run.py", output_path: "out.json", extractor_type: "jsonpath", extractor_expr: "$.x", metric_name: "m", reported_value: "0.9", notes: "", ...over });

const lead = (n: number, repoUrl: string | null = `https://github.com/a/r${n}`): Lead => ({ id: `x:${n}`, source: "test", title: `Paper ${n}`, paperUrl: "https://doi.org/1", repoUrl });

describe("scout filters", () => {
  it("accepts an open-licence Python repository, and says why", () => {
    const r = checkRepo(facts());
    expect(r.accepted).toBe(true);
    expect(r.runtime).toBe("python3.11");
    expect(r.reasons.join(" ")).toContain("MIT");
  });

  it.each([
    ["no licence", { license: null }, /licence/],
    ["a closed licence", { license: "NOASSERTION" }, /licence/],
    ["MATLAB", { languages: { MATLAB: 900 } }, /only runs Python and R/],
    ["Julia", { languages: { Julia: 900 } }, /only runs Python and R/],
    ["a graphics card", { dependencyText: "torch==2.0\nnumpy" }, /graphics card/],
    ["a huge repository", { sizeKb: 900 * 1024 }, /too big/],
  ])("turns down %s", (_name, over, why) => {
    const r = checkRepo(facts(over));
    expect(r.accepted).toBe(false);
    expect(r.reasons.join(" ")).toMatch(why);
  });

  it("doesn't confuse a word containing torch with the package", () => {
    expect(checkRepo(facts({ dependencyText: "torchlight-plots-helper-notreal" })).accepted).toBe(true);
  });

  it("recognises a clear number", () => {
    expect(isClearNumber("0.93")).toBe(true);
    expect(isClearNumber("-12")).toBe(true);
    expect(isClearNumber("")).toBe(false);
    expect(isClearNumber("about 93%")).toBe(false);
  });
});

describe("reading ReScience articles", () => {
  it("reads the title and the first code link", () => {
    const text = 'title: "[Re] A paper"\nauthors:\n  - name: A\ncode:\n  # the code\n  - url: https://github.com/a/b/tree/main/code\n  - doi: 10.1\ndata:\n  - url: https://x.test\n';
    expect(parseArticleYaml(text)).toEqual({ title: "[Re] A paper", repoUrl: "https://github.com/a/b" });
  });

  it("copes with a missing code link", () => {
    expect(parseArticleYaml('title: "X"\ncode:\n  - url:\n  - doi: 1\n').repoUrl).toBeNull();
  });

  it("finds the repository in any GitHub link", () => {
    expect(repoRoot("https://github.com/a/b.git")).toBe("https://github.com/a/b");
    expect(repoRoot("https://www.github.com/a/b/releases/tag/v1")).toBe("https://github.com/a/b");
    expect(repoRoot("https://gitlab.com/a/b")).toBeNull();
  });
});

describe("a scan", () => {
  const deps = (leads: Lead[], over = {}) => ({ leads: async () => leads, repoFacts: async () => facts(), draft: async () => draft(), ...over });

  it("queues a good paper for a person, labelled, and never approves it itself", async () => {
    const s = await runScout(emptyState(), deps([lead(1)]));
    const c = s.candidates["x:1"]!;
    expect(c.status).toBe("pending");
    expect(c.draft!.statement.endsWith(SUGGESTED_BY)).toBe(true);
    expect(Object.values(s.candidates).some((x) => x.status === "approved")).toBe(false);
  });

  it("logs why a paper was turned down, without spending on an AI draft", async () => {
    let drafts = 0;
    const s = await runScout(emptyState(), deps([lead(1)], { repoFacts: async () => facts({ license: null }), draft: async () => (drafts++, draft()) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/licence/);
    expect(drafts).toBe(0);
  });

  it("turns down a paper with no GitHub link", async () => {
    const s = await runScout(emptyState(), deps([lead(1, null)]));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
  });

  it("turns down a draft with no clear number", async () => {
    const s = await runScout(emptyState(), deps([lead(1)], { draft: async () => draft({ reported_value: "" }) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/clear number/);
  });

  it("stays inside the AI budget for a scan and for a day", async () => {
    let drafts = 0;
    const many = Array.from({ length: 6 }, (_, i) => lead(i));
    const count = { draft: async () => (drafts++, draft()) };
    const first = await runScout(emptyState(), deps(many, count));
    expect(drafts).toBe(LIMITS.draftsPerScan);
    expect(Object.values(first.candidates).filter((c) => c.status === "retry")).toHaveLength(4);

    const today = new Date().toISOString().slice(0, 10);
    drafts = 0;
    const spent = { ...emptyState(), draftsByDay: { [today]: LIMITS.draftsPerDay } };
    await runScout(spent, deps(many, count));
    expect(drafts).toBe(0);
  });

  it("tries again later after a network problem, and doesn't reject the paper for it", async () => {
    const bad = await runScout(emptyState(), deps([lead(1)], { repoFacts: async () => { throw new Error("GitHub answered 403"); } }));
    expect(bad.candidates["x:1"]!.status).toBe("retry");
    const good = await runScout(bad, deps([lead(1)]));
    expect(good.candidates["x:1"]!.status).toBe("pending");
  });

  it("doesn't check a paper twice", async () => {
    let reads = 0;
    const counting = deps([lead(1)], { repoFacts: async () => (reads++, facts()) });
    const once = await runScout(emptyState(), counting);
    await runScout(once, counting);
    expect(reads).toBe(1);
  });
});
