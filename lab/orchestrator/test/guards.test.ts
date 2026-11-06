import { describe, expect, it } from "vitest";
import { reportFromReply } from "../src/pipeline/pipeline.ts";
import { proposeAndApplyRepair, resolveRepoFile, sourceForRepair } from "../src/pipeline/repair.ts";
import { checkEdit, parseJsonReply, type RepairEdit } from "../src/pipeline/guards.ts";

const ctx = { dataPaths: ["data/trials.csv"], outputPath: "results.json", privatePath: "private/x.csv", fileExists: true };
const edit = (e: Partial<RepairEdit>): RepairEdit => ({
  file: "reproduce.py",
  kind: "PATH",
  justification: "environment-only fix for this failure",
  search: 'pd.read_csv("/home/me/data/trials.csv")',
  replace: 'pd.read_csv("data/trials.csv")',
  ...e,
});

describe("repair guards: allowed", () => {
  it.each<[string, Partial<RepairEdit>]>([
    ["a laptop path in analysis code", {}],
    ["a dependency pin", { file: "requirements.txt", kind: "DEPENDENCY", search: "numpy==1.19.5", replace: "numpy==1.26.4" }],
    ["creating a missing requirements file", { file: "requirements.txt", kind: "DEPENDENCY", search: "", replace: "pandas\n" }],
    ["a deprecated import rename", { kind: "ENV", search: "from sklearn.externals import joblib", replace: "import joblib" }],
    ["an encoding", { kind: "ENV", search: 'read_text(encoding="latin-1")', replace: 'read_text(encoding="utf-8")' }],
  ])("%s", (_, e) => {
    expect(checkEdit(edit(e), { ...ctx, fileExists: e.search !== "" })).toBeNull();
  });
});

describe("repair guards: blocked (the science stays untouched)", () => {
  it.each<[string, Partial<RepairEdit>, RegExp]>([
    ["changing the metric", { search: "acc = accuracy_score(y, p)", replace: "acc = balanced_accuracy_score(y, p)" }, /analysis/],
    ["a stem-matched rename", { search: "acc = lt.compute(y)", replace: "acc = lt.compute_auc(y)" }, /analysis/],
    ["changing a seed", { search: "random_state=42", replace: "random_state=7" }, /numbers changed/],
    ["changing a hyperparameter", { search: "clf(c=1.0)", replace: "clf(c=10.0)" }, /numbers changed/],
    ["hardcoding a result", { search: "acc = m(y)", replace: "acc = 0.95" }, /numbers changed/],
    ["a number disguised as a string", { search: 'acc = m("a.csv")', replace: 'acc = m("0.95")' }, /not a path/],
    ["dropping rows", { search: "df = load()", replace: "df = load().dropna()" }, /analysis/],
    ["writing results directly", { search: "x = load()", replace: "x = load(); print(x)" }, /analysis/],
    ["deleting analysis lines", { search: "df = df[df.age > 18]\n", replace: "" }, /delete/],
    ["editing a data file", { file: "data/trials.csv", search: "1,0", replace: "1,1" }, /data files/],
    ["editing private data", { file: "private/x.csv", search: "a", replace: "b" }, /data files/],
    ["editing the output file", { file: "results.json", search: "0.5", replace: "0.9" }, /output file/],
    ["escaping the repo", { file: "../../etc/passwd", search: "a", replace: "b" }, /path not allowed/],
    ["absolute paths", { file: "/etc/passwd", search: "a", replace: "b" }, /path not allowed/],
    ["git internals", { file: ".git/hooks/pre-commit", search: "a", replace: "b" }, /path not allowed/],
    ["DEPENDENCY on code", { kind: "DEPENDENCY" }, /only config files/],
    ["a package from an arbitrary URL", { file: "requirements.txt", kind: "DEPENDENCY", search: "a", replace: "evil @ https://x.test/evil.whl" }, /default package registry/],
    ["a custom package index", { file: "requirements.txt", kind: "DEPENDENCY", search: "a", replace: "--index-url https://x.test\na" }, /default package registry/],
    ["a large rewrite", { search: "a\nb\nc\nd\ne\nf", replace: "a\nb\nc\nd\ne\ng" }, /too large/],
    ["redirecting output", { search: 'p = "out/a.json"', replace: 'p = "results.json"' }, /redirects the output/],
    ["a no-op", { search: "x", replace: "x" }, /changes nothing/],
  ])("%s", (_, e, why) => {
    expect(checkEdit(edit(e), ctx)).toMatch(why);
  });

  it("refuses to create a new analysis file", () => {
    expect(checkEdit(edit({ file: "labtools_internal.py", kind: "ENV", search: "", replace: "def f(): pass" }), { ...ctx, fileExists: false })).toMatch(/cannot create/);
  });
});

describe("parseJsonReply", () => {
  it("tolerates fences and prose", () => {
    expect(parseJsonReply('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonReply("no json here")).toThrow();
  });
});

describe("parseJsonReply on real model replies", () => {
  it("takes the first complete object and ignores what follows", () => {
    expect(parseJsonReply('Here:\n{"a":{"b":"}"}}\n\n{"second":true} and more')).toEqual({ a: { b: "}" } });
  });

  it("handles escaped quotes inside strings", () => {
    expect(parseJsonReply('{"a":"say \\"hi}\\" now"} trailing')).toEqual({ a: 'say "hi}" now' });
  });

  it("rejects a reply cut off part way through", () => {
    expect(() => parseJsonReply('{"a":1')).toThrow(/no complete JSON/);
  });
});

describe("the code shown to the repair AI", () => {
  const entrypoint = "cd code && python -c \"import runpy; runpy.run_path('main.py')\"";
  const store = (files: Record<string, string>) => ({
    readFile: async (f: string) => (f in files ? Buffer.from(files[f]!) : null),
  });

  it("finds a traceback's file relative to the folder the entrypoint moved into", () => {
    expect(resolveRepoFile("main.py", ["code/main.py", "README.md"], entrypoint)).toBe("code/main.py");
    expect(resolveRepoFile("./main.py", ["main.py"], "python main.py")).toBe("main.py");
    expect(resolveRepoFile("util.py", ["a/util.py", "b/util.py"], "python x.py")).toBeNull();
  });

  it("shows a small file whole, as it stands now", async () => {
    const out = await sourceForRepair({ errorLog: 'File "main.py", line 2, in <module>', sandbox: store({ "code/main.py": "import numpy\nx = np.float(1)\n" }), files: ["code/main.py"], entrypoint });
    expect(out).toContain("The whole of code/main.py");
    expect(out).toContain("x = np.float(1)");
  });

  it("shows a large file only around the error", async () => {
    const big = Array.from({ length: 4000 }, (_, i) => `value_${i} = ${i}`).join("\n");
    const out = await sourceForRepair({ errorLog: 'File "/work/repo/big.py", line 2000, in f', sandbox: store({ "big.py": big }), files: ["big.py"], entrypoint: "python big.py" });
    expect(out).toContain("around line 2000");
    expect(out).toContain("value_1999");
    expect(out).not.toContain("value_100 ");
  });

  it("shows a file an earlier edit missed, even when this error doesn't name it", async () => {
    const out = await sourceForRepair({ errorLog: "ImportError: nope", sandbox: store({ "code/analysis.py": "a = 1\n" }), files: ["code/analysis.py"], entrypoint, missed: ["code/analysis.py"] });
    expect(out).toContain("The whole of code/analysis.py");
  });
});

describe("repairing with the exact code in view", () => {
  const run = async (file: string, body: string, edits: Partial<RepairEdit>[]) => {
    const files = new Map([[file, body]]);
    let prompt = "";
    const sandbox = {
      readFile: async (f: string) => (files.has(f) ? Buffer.from(files.get(f)!) : null),
      writeFile: async (f: string, b: Buffer) => void files.set(f, b.toString("utf8")),
      listFiles: async () => [...files.keys()],
    };
    const model = {
      ask: async (_: string, messages: { content: string }[]) => {
        prompt = messages.at(-1)!.content;
        return JSON.stringify({ give_up: false, reason: "test", edits: edits.map((e) => ({ file, kind: "ENV", justification: "environment only", ...e })) });
      },
    };
    const result = await proposeAndApplyRepair({
      model: model as never,
      sandbox: sandbox as never,
      phase: "run",
      errorLog: `File "${file}", line 1, in <module>`,
      entrypoint: `python ${file}`,
      setup: [],
      guard: { dataPaths: [], outputPath: "results.json", privatePath: null } as never,
      previous: [],
    });
    return { result, prompt, text: files.get(file)! };
  };

  it("still blocks an edit that changes a number, though the AI can see the whole file", async () => {
    const body = "import numpy as np\nthreshold = 0.5\n";
    const { result, prompt, text } = await run("glue.py", body, [{ search: "threshold = 0.5", replace: "threshold = 0.9" }]);
    expect(prompt).toContain("threshold = 0.5");
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(text).toBe(body);
  });

  it("still blocks a hardcoded result", async () => {
    const body = "import numpy as np\nprint(compute())\n";
    const { result, text } = await run("glue.py", body, [{ search: "print(compute())", replace: "print(42)" }]);
    expect(result.applied).toHaveLength(0);
    expect(text).toBe(body);
  });

  it("matches an edit spanning two lines in a file with Windows line breaks, and keeps them", async () => {
    const { result, text } = await run("glue.py", "from foo import a\r\nfrom bar import b\r\nrun()\r\n", [{ search: "from foo import a\nfrom bar import b", replace: "from foo2 import a\nfrom bar import b" }]);
    expect(result.rejected).toEqual([]);
    expect(text).toBe("from foo2 import a\r\nfrom bar import b\r\nrun()\r\n");
  });
});

describe("the report reply", () => {
  it("takes the report from a structured reply, and drops one it can't read", () => {
    expect(reportFromReply('{"report": "It ran."}')).toBe("It ran.");
    expect(reportFromReply('{"report": 3}')).toBe("");
    expect(reportFromReply('{"report": "cut off')).toBe("");
    expect(reportFromReply(JSON.stringify({ report: "notes ".repeat(400) }))).toBe("");
    expect(reportFromReply(JSON.stringify({ report: "R2 of 0.19 \u5f15 =0" }))).toBe("");
    expect(reportFromReply("MOCK report")).toBe("MOCK report");
  });
});
