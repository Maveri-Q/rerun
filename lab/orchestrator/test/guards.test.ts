import { describe, expect, it } from "vitest";
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
