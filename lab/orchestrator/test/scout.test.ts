import { describe, expect, it } from "vitest";
import { doiInText, EVERYDAY_TOPICS, searchWords, titleMatches, topicsForDay } from "../src/scout/scout.ts";
import { doiIn, fetchPaperText, htmlToText, isPrivateAddress, numberInText, numberNearWording, pdfLinkIn, sameNumber } from "../src/scout/paper.ts";
import { articleFile, type ClaimDraft } from "../src/lab/draft.ts";
import { checkRepo, hasDataInRepo, isClearNumber, type RepoFacts } from "../src/scout/filters.ts";
import { addSuggestion, emptyState, interestScore, LIMITS, parseArticleYaml, repoRoot, runScout, SUGGESTED_BY, type Lead, citationAttention } from "../src/scout/scout.ts";

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({ license: "MIT", languages: { Python: 9000, Shell: 100 }, sizeKb: 2000, archived: false, files: ["run.py"], dependencyText: "numpy\npandas", ...over });

const draft = (over: Partial<ClaimDraft> = {}): ClaimDraft => ({ question: "Does it hold up?", topic: "health", relatability: 7, relatability_why: "It affects people's health.",  repo_url: "https://github.com/a/b", commit: "c".repeat(40), title: "T", statement: "S", authors: "A", license: "MIT", runtime: "python3.11", setup: [], entrypoint: "python run.py", output_path: "out.json", extractor_type: "jsonpath", extractor_expr: "$.x", metric_name: "m", reported_value: "0.9", notes: "", ...over });

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

  it("ignores documents and styling when deciding what a project runs on", () => {
    const r = checkRepo(facts({ languages: { TeX: 90000, Python: 4000, HTML: 8000 } }));
    expect(r.accepted).toBe(true);
    expect(r.runtime).toBe("python3.11");
  });

  it("accepts R", () => {
    const r = checkRepo(facts({ languages: { R: 4000 } }));
    expect(r.accepted).toBe(true);
    expect(r.runtime).toBe("r4.4");
  });

  it("reads a licence file GitHub can't name, and asks a person to check it", () => {
    const r = checkRepo(facts({ license: "NOASSERTION", licenseText: "Permission is hereby granted, free of charge, to any person" }));
    expect(r.accepted).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/Check this one yourself/);
    expect(checkRepo(facts({ license: null, licenseText: "All rights reserved." })).accepted).toBe(false);
  });

  it("finds data in a repository, but not in config files", () => {
    expect(hasDataInRepo(["run.py", "data/trials.csv"])).toBe(true);
    expect(hasDataInRepo(["run.py", "package.json", "codemeta.json"])).toBe(false);
  });

  it("finds the paper's own text in a repository", () => {
    expect(articleFile(["README.md", "article/content.tex", "article/article.tex"])).toBe("article/content.tex");
    expect(articleFile(["paper.md"])).toBe("paper.md");
    expect(articleFile(["run.py"])).toBeUndefined();
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
  const paperFor = (d: ClaimDraft) => ({ text: `We measured ${d.metric_name}. ${d.question} The answer was ${d.reported_value} in the main test.`, from: "https://doi.org/1" });
  const deps = (leads: Lead[], over = {}) => ({ leads: async () => leads, repoFacts: async () => facts(), draft: async () => draft(), paperText: async () => paperFor(draft()), secondPick: async () => draft().reported_value, ...over });

  it("queues a good paper for a person, labelled, and never approves it itself", async () => {
    const s = await runScout(emptyState(), deps([lead(1)]));
    const c = s.candidates["x:1"]!;
    expect(c.status).toBe("pending");
    expect(c.draft!.statement.endsWith(SUGGESTED_BY)).toBe(true);
    expect(Object.values(s.candidates).some((x) => x.status === "approved")).toBe(false);
  });

  it("won't draft a paper it can't read, so no AI is spent on it", async () => {
    let drafts = 0;
    const s = await runScout(emptyState(), deps([lead(1)], { paperText: async () => null, draft: async () => (drafts++, draft()) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/free copy/);
    expect(drafts).toBe(0);
  });

  it("turns down a number that appears in the paper, but away from the claim's wording", async () => {
    const elsewhere = `${"Unrelated background on the history of the field. ".repeat(40)}The sample had ${draft().reported_value} items. ${"Unrelated background on the history of the field. ".repeat(40)}We measured ${draft().metric_name} and report it in a table.`;
    let asked = 0;
    const s = await runScout(emptyState(), deps([lead(1)], { paperText: async () => ({ text: elsewhere, from: "x" }), secondPick: async () => (asked++, draft().reported_value) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/doesn't state that number near/);
    expect(asked).toBe(0);
  });

  it("turns down a number when a second AI picks a different one, and never tells it the first", async () => {
    const seen: string[] = [];
    const picked = draft({ question: `Is it really ${draft().reported_value}?` });
    const s = await runScout(emptyState(), deps([lead(1)], { draft: async () => picked, paperText: async () => paperFor(picked), secondPick: async (wording: string) => (seen.push(wording), "12345") }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toContain("Two AIs disagreed");
    expect(seen[0]).not.toContain(picked.reported_value);
    expect(seen[0]).toContain("[number]");
  });

  it("treats a second AI that finds no number as a disagreement, and a failed call as try again", async () => {
    const none = await runScout(emptyState(), deps([lead(1)], { secondPick: async () => "" }));
    expect(none.candidates["x:1"]!.status).toBe("rejected");
    const failed = await runScout(emptyState(), deps([lead(1)], { secondPick: async () => { throw new Error("down"); } }));
    expect(failed.candidates["x:1"]!.status).toBe("retry");
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

  it("checks one project only once, even when it's published as many articles", async () => {
    let reads = 0;
    const same = [lead(1, "https://github.com/a/same"), lead(2, "https://github.com/a/same"), lead(3, "https://github.com/a/other")];
    await runScout(emptyState(), deps(same, { repoFacts: async () => (reads++, facts()) }));
    expect(reads).toBe(2);
  });

  it("asks a preprint to show a dataset", async () => {
    const preprint = { ...lead(1), needsDataCheck: true };
    const s = await runScout(emptyState(), deps([preprint], { repoFacts: async () => facts({ files: ["run.py"] }) }));
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/dataset/);
    const ok = await runScout(emptyState(), deps([preprint], { repoFacts: async () => facts({ files: ["run.py", "data/x.csv"] }) }));
    expect(ok.candidates["x:1"]!.status).toBe("pending");
  });

  it("skips anything below 4 for relatability, and says why", async () => {
    const s = await runScout(emptyState(), deps([lead(1)], { draft: async () => draft({ relatability: 3, relatability_why: "Only for specialists." }) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
    expect(s.candidates["x:1"]!.reasons.join(" ")).toMatch(/Relatability 3 of 10.*Only for specialists/);
  });

  it("keeps a paper scoring exactly 4", async () => {
    const s = await runScout(emptyState(), deps([lead(1)], { draft: async () => draft({ relatability: 4 }) }));
    expect(s.candidates["x:1"]!.status).toBe("pending");
  });

  it("the safety filters still apply, however relatable a paper is", async () => {
    const s = await runScout(emptyState(), deps([lead(1)], { repoFacts: async () => facts({ license: null }), draft: async () => draft({ relatability: 10 }) }));
    expect(s.candidates["x:1"]!.status).toBe("rejected");
  });

  it("ranks by how much people would care, then topic, then attention", () => {
    expect(interestScore(8, "other")).toBeGreaterThan(interestScore(7, "health"));
    expect(interestScore(7, "health")).toBeGreaterThan(interestScore(7, "other"));
    const cited = { source: "OpenAlex", label: "1000 citations", value: 1000 };
    expect(interestScore(5, "other", cited)).toBeGreaterThan(interestScore(5, "other"));
    // Fame alone can't lift a paper past one people care more about.
    expect(interestScore(5, "other", { ...cited, value: 1e9 })).toBeLessThan(interestScore(8, "health"));
  });

  it("carries on when attention data isn't available", async () => {
    const s = await runScout(emptyState(), deps([lead(1)], { attention: async () => { throw new Error("down"); } }));
    expect(s.candidates["x:1"]!.status).toBe("pending");
    expect(s.candidates["x:1"]!.interest).toBeGreaterThan(0);
  });

  it("spends the AI budget on the likeliest topics first", async () => {
    const titled = [{ ...lead(1), title: "Graph ordering in C" }, { ...lead(2), title: "Sleep and heart disease" }, { ...lead(3), title: "Inflation and wages" }];
    const drafted: string[] = [];
    await runScout(emptyState(), deps(titled, { draft: async (l: Lead) => (drafted.push(l.title), draft()) }));
    expect(drafted).toEqual(["Sleep and heart disease", "Inflation and wages"]);
  });

  it("takes a visitor's suggestion through the same checks, and first", async () => {
    const state = emptyState();
    expect(addSuggestion(state, "https://github.com/a/suggested/tree/main", "https://doi.org/10.1/x").ok).toBe(true);
    const c = state.candidates["suggested:https://github.com/a/suggested"]!;
    expect(c.status).toBe("retry");
    const checked: string[] = [];
    const s = await runScout(state, deps([lead(1)], { repoFacts: async (u: string) => (checked.push(u), facts({ license: null })) }));
    expect(checked[0]).toBe("https://github.com/a/suggested");
    expect(s.candidates[c.id]!.status).toBe("rejected");
    expect(addSuggestion(state, "not a link", "https://x.test").ok).toBe(false);
    expect(addSuggestion(state, "https://github.com/a/b", "nope").ok).toBe(false);
  });

  it("doesn't check a paper twice", async () => {
    let reads = 0;
    const counting = deps([lead(1)], { repoFacts: async () => (reads++, facts()) });
    const once = await runScout(emptyState(), counting);
    await runScout(once, counting);
    expect(reads).toBe(1);
  });
});

describe("citationAttention", () => {
  const byYear = (entries: [number, number][]) => entries.map(([year, cited_by_count]) => ({ year, cited_by_count }));

  it("ranks a paper still being cited above an older one with the same total", () => {
    const current = citationAttention({ cited_by_count: 100, counts_by_year: byYear([[2026, 30], [2025, 20]]) }, 2026)!;
    const faded = citationAttention({ cited_by_count: 100, counts_by_year: byYear([[2015, 60], [2014, 40]]) }, 2026)!;
    expect(current.value).toBeGreaterThan(faded.value);
    expect(current.label).toBe("100 citations, 50 since 2025");
    expect(faded.label).toBe("100 citations");
  });

  it("finds nothing for an uncited paper", () => {
    expect(citationAttention({ cited_by_count: 0 }, 2026)).toBeUndefined();
    expect(citationAttention({}, 2026)).toBeUndefined();
  });
});

describe("reading the paper", () => {
  const allow = async () => true;
  const page = (body: string, headers: Record<string, string> = { "content-type": "text/html" }, status = 200) => new Response(status >= 300 ? null : body, { status, headers });

  it("recognises older data formats", () => {
    expect(hasDataInRepo(["data/raw/public.dat"])).toBe(true);
    expect(hasDataInRepo(["RR-basic.dta"])).toBe(true);
    expect(hasDataInRepo(["survey.sav"])).toBe(true);
    expect(hasDataInRepo(["analysis.R", "README.md"])).toBe(false);
  });

  it("finds a number however its minus sign was typeset, and only the whole number", () => {
    expect(numberInText("-0.1", "growth averages −0.1 percent")).toBe(true);
    expect(numberInText("-0.1", "growth averages -0.1 percent")).toBe(true);
    expect(numberInText("2.76", "a gain of 2.76 FTE")).toBe(true);
    expect(numberInText("2.7", "a gain of 2.76 FTE")).toBe(false);
    expect(numberInText("0.1", "a value of 10.1 here")).toBe(false);
    expect(numberInText("-0.1", "a value of 0.1 here")).toBe(false);
  });

  it("needs the claim's words around the number, not just the number", () => {
    const wording = "change in jobs per store, New Jersey relative to Pennsylvania";
    expect(numberNearWording("2.76", wording, "The relative gain in employment per store between New Jersey and Pennsylvania jobs is 2.76 FTE.")).toBe(true);
    expect(numberNearWording("2.76", wording, `A price of 2.76 dollars. ${"Filler about something else entirely. ".repeat(40)} Jobs per store in New Jersey and Pennsylvania rose.`)).toBe(false);
    expect(numberNearWording("2.76", "", "2.76")).toBe(false);
  });

  it("compares numbers by value", () => {
    expect(sameNumber("2.20", "2.2")).toBe(true);
    expect(sameNumber("−0.1", "-0.1")).toBe(true);
    expect(sameNumber("0.1", "-0.1")).toBe(false);
    expect(sameNumber("", "0")).toBe(false);
    expect(sameNumber("about 3", "3")).toBe(false);
  });

  it("refuses private addresses, including in a redirect", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("192.168.1.9")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    const asked: string[] = [];
    const fetcher = (async (u: string) => {
      asked.push(u);
      return page("", { location: "https://inner.example/secret" }, 302);
    }) as typeof fetch;
    const found = await fetchPaperText("https://outer.example/paper", fetcher, async (h) => h !== "inner.example");
    expect(found).toBeNull();
    expect(asked).toEqual(["https://outer.example/paper"]);
  });

  it("won't read anything but https", async () => {
    const fetcher = (async () => page("x".repeat(5000))) as unknown as typeof fetch;
    expect(await fetchPaperText("http://example.org/paper", fetcher, allow)).toBeNull();
  });

  it("follows a redirect through http to https, but reads nothing over http", async () => {
    const text = `<p>${"A gain of 2.76 jobs. ".repeat(200)}</p>`;
    const through = (async (u: string) => (u.startsWith("https://a.example") ? page("", { location: "http://b.example/p" }, 302) : u.startsWith("http://b.example") ? page("", { location: "https://b.example/p" }, 301) : page(text))) as unknown as typeof fetch;
    expect((await fetchPaperText("https://a.example/p", through, allow))?.from).toBe("https://a.example/p");
    const ends = (async (u: string) => (u.startsWith("https://") ? page("", { location: "http://b.example/p" }, 302) : page(text))) as unknown as typeof fetch;
    expect(await fetchPaperText("https://a.example/p", ends, allow)).toBeNull();
  });

  it("reads a long page, and treats a short one as a paywall", async () => {
    const long = (async () => page(`<p>${"The gain was 2.76 jobs. ".repeat(200)}</p>`)) as unknown as typeof fetch;
    expect((await fetchPaperText("https://example.org/paper", long, allow))?.text).toContain("2.76");
    const short = (async () => page("<p>Subscribe to read this article.</p>")) as unknown as typeof fetch;
    expect(await fetchPaperText("https://example.org/paper", short, allow)).toBeNull();
  });

  it("finds the DOI and a page's PDF link, and strips markup", () => {
    expect(doiIn("https://doi.org/10.1257/aer.100.2.573")).toBe("10.1257/aer.100.2.573");
    expect(doiIn("https://example.org/paper")).toBeNull();
    expect(pdfLinkIn('<meta name="citation_pdf_url" content="/a/b.pdf">', "https://x.org/p")).toBe("https://x.org/a/b.pdf");
    expect(htmlToText("<style>a{}</style><p>Hi&nbsp;there</p>")).toBe("Hi there");
  });
});

describe("suggesting a paper again", () => {
  it("gives a turned-down paper a fresh look, and leaves one waiting for review alone", () => {
    const state = emptyState();
    addSuggestion(state, "https://github.com/a/b", "https://doi.org/10.1/x");
    const id = "suggested:https://github.com/a/b";
    state.candidates[id]!.status = "rejected";
    addSuggestion(state, "https://github.com/a/b", "https://doi.org/10.1/y");
    expect(state.candidates[id]!.status).not.toBe("rejected");
    expect(state.candidates[id]!.paperUrl).toBe("https://doi.org/10.1/y");
    state.candidates[id]!.status = "pending";
    addSuggestion(state, "https://github.com/a/b", "https://doi.org/10.1/z");
    expect(state.candidates[id]!.status).toBe("pending");
    expect(state.candidates[id]!.paperUrl).toBe("https://doi.org/10.1/y");
  });
});

describe("everyday leads", () => {
  it("finds a DOI in a README, without the punctuation after it", () => {
    expect(doiInText("See https://doi.org/10.1257/aer.100.2.573.")).toBe("10.1257/aer.100.2.573");
    expect(doiInText("No paper named here")).toBeNull();
  });

  it("only takes a title match when most of the words are really there", () => {
    const words = searchWords("Replication code and data for The Diffusion of Online Vaccine Misinformation");
    expect(words).toBe("Diffusion Online Vaccine Misinformation");
    expect(titleMatches(words, "The diffusion of online vaccine misinformation on social media")).toBe(true);
    expect(titleMatches(words, "Shopping for lower sales tax rates")).toBe(false);
  });

  it("takes turns through the topics", () => {
    const day = new Date(0);
    expect(topicsForDay(day, 2)).toEqual(EVERYDAY_TOPICS.slice(0, 2));
    expect(topicsForDay(new Date(86_400_000), 1)).toEqual([EVERYDAY_TOPICS[1]]);
  });
});
