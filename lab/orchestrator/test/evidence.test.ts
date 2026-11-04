import { describe, expect, it } from "vitest";
import type { ClaimSpec } from "@rerun/shared";
import { redactReported, resampleCsv, runReimplementation, runRobustness, scriptContainsReported } from "../src/pipeline/evidence.ts";
import type { PrivateModel } from "../src/pipeline/model.ts";
import type { ExecOptions, ExecResult, Sandbox } from "../src/sandbox/types.ts";

const spec = {
  artifact: { runtime: "python3.11", entrypoint: "python run.py", output: { path: "out.json", extractor: { type: "jsonpath", expr: "$.acc" } }, data: [] },
  metric: { name: "acc", reported_value: "0.93", tolerance: { type: "abs", value: "0.02" } },
  resources: { max_minutes: 5 },
  private_data: null,
} as unknown as ClaimSpec;

class Box implements Sandbox {
  files = new Map<string, Buffer>();
  scripts: { script: string; network: boolean }[] = [];
  created = 0;
  destroyed = 0;
  constructor(private readonly onExec: (script: string, box: Box) => { exitCode?: number; tail?: string; timedOut?: boolean } = () => ({})) {}
  async create() {
    this.created++;
  }
  async exec(script: string, opts: ExecOptions): Promise<ExecResult> {
    this.scripts.push({ script, network: opts.network });
    const r = this.onExec(script, this);
    return { exitCode: r.exitCode ?? 0, timedOut: r.timedOut ?? false, tail: r.tail ?? "", log: r.tail ?? "", logHash: "", durationMs: 1 };
  }
  async writeFile(p: string, d: Uint8Array) {
    this.files.set(p, Buffer.from(d));
  }
  async readFile(p: string) {
    return this.files.get(p) ?? null;
  }
  async listFiles() {
    return [...this.files.keys()];
  }
  async destroy() {
    this.destroyed++;
  }
}

function model(replies: string[]): PrivateModel & { seen: string[] } {
  const seen: string[] = [];
  return {
    modelId: "fake/model",
    seen,
    attest: async () => {},
    ask: async (_p, messages) => {
      seen.push(messages.map((m) => m.content).join("\n"));
      return replies.length > 1 ? replies.shift()! : replies[0]!;
    },
    attestationDigest: () => "d".repeat(64),
    signatureRefs: () => [],
  };
}

const py = (body: string) => "```python\n" + body + "\n```";

describe("robustness", () => {
  const CSV = "a,b\n1,2\n3,4\n5,6\n7,8\n";
  const data = new Map([["data/d.csv", Buffer.from(CSV)]]);
  const robust = (box: Box, measured = "0.93", d: Map<string, Uint8Array> = data) =>
    runRobustness({ spec, sandbox: box, measured, baseRunMs: 1, data: d, emit: () => {} });

  it("is stable when extra runs stay within the margin, with the network off", async () => {
    const values = ["0.92", "0.94", "0.93", "0.925", "0.935"];
    const box = new Box((_s, b) => (b.files.set("out.json", Buffer.from(`{"acc":${values.shift()}}`)), {}));
    const r = await robust(box);
    expect(r.status).toBe("stable");
    expect(r.seed_had_effect).toBe(true);
    expect(r.runs.map((x) => x.kind)).toEqual(["seed", "seed", "seed", "resample", "resample"]);
    expect(box.scripts.every((s) => !s.network)).toBe(true);
    expect(box.files.get("../.rerun/sitecustomize.py")).toBeDefined();
    expect(box.scripts[0]!.script).toBe("export PYTHONPATH=/work/.rerun; export RERUN_SEED_OFFSET=1; python run.py");
  });

  it("is sensitive when a run moves past the claim's margin", async () => {
    const box = new Box((_s, b) => (b.files.set("out.json", Buffer.from('{"acc":0.80}')), {}));
    expect((await robust(box)).status).toBe("sensitive");
  });

  it("reports when the seed makes no difference", async () => {
    const box = new Box((_s, b) => (b.files.set("out.json", Buffer.from('{"acc":0.93}')), {}));
    const r = await robust(box);
    expect(r.status).toBe("stable");
    expect(r.seed_had_effect).toBe(false);
  });

  it("puts the original data back afterwards", async () => {
    const box = new Box((_s, b) => (b.files.set("out.json", Buffer.from('{"acc":0.93}')), {}));
    await robust(box);
    expect(box.files.get("data/d.csv")!.toString()).toBe(CSV);
  });

  it("marks itself incomplete if no run gives a number", async () => {
    const r = await robust(new Box(() => ({ exitCode: 1 })));
    expect(r.status).toBe("could_not_complete");
  });

  it("resamples rows reproducibly and keeps the header", () => {
    const a = resampleCsv(Buffer.from(CSV), 7)!.toString();
    expect(a).toBe(resampleCsv(Buffer.from(CSV), 7)!.toString());
    expect(a).not.toBe(resampleCsv(Buffer.from(CSV), 8)!.toString());
    expect(a.split("\n")[0]).toBe("a,b");
    expect(a.trim().split("\n")).toHaveLength(5);
  });

  it("won't resample files it can't split safely", () => {
    expect(resampleCsv(Buffer.from('a\n"x\ny"\n1\n'), 1)).toBeNull();
    expect(resampleCsv(Buffer.from("a\n1\n"), 1)).toBeNull();
  });
});

describe("re-implementation", () => {
  const data = new Map([["data/d.csv", Buffer.from("age,dose,secret_value\n1,2,4242\n")]]);
  const METHODS = "We used logistic regression and reached 93% accuracy (0.93).";
  const run = (m: PrivateModel, box: Box, overrides: Partial<Parameters<typeof runReimplementation>[0]> = {}) =>
    runReimplementation({ spec, methods: METHODS, data, newSandbox: () => box, model: m, emit: () => {}, ...overrides });
  const writes = (value: string) => (_s: string, b: Box) => (b.files.set("reimplementation_result.json", Buffer.from(`{"value":${value}}`)), {});

  it("agrees when its own analysis lands inside the claimed range", async () => {
    const box = new Box(writes("0.925"));
    const r = await run(model([py("print('analysis')")]), box);
    expect(r.status).toBe("agrees");
    expect(r.value).toBe("0.925");
    expect(r.script_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(box.scripts).toEqual([{ script: "python reimplementation.py", network: false }]);
    expect(box.destroyed).toBe(1);
  });

  it("differs when it lands elsewhere, and code reads the number", async () => {
    const r = await run(model([py("x=1")]), new Box(writes("0.5")));
    expect(r.status).toBe("differs");
    expect(r.value).toBe("0.5");
  });

  it("works in a fresh workspace holding only the data, not the authors' code", async () => {
    const box = new Box(writes("0.93"));
    await run(model([py("x=1")]), box);
    expect(box.created).toBe(1);
    expect([...box.files.keys()].sort()).toEqual(["data/d.csv", "reimplementation.py", "reimplementation_result.json"]);
  });

  it("hides the published number and the data values from the AI", async () => {
    const m = model([py("x=1")]);
    await run(m, new Box(writes("0.93")));
    const prompt = m.seen[0]!;
    expect(prompt).not.toMatch(/93%|0\.93/);
    expect(prompt).toContain("[result hidden]");
    expect(prompt).toContain("age,dose,secret_value");
    expect(prompt).not.toContain("4242");
  });

  it("rejects a script that hardcodes the published number, without running it", async () => {
    const box = new Box(writes("0.93"));
    const r = await run(model([py('json.dump({"value": 0.93}, open("reimplementation_result.json", "w"))')]), box);
    expect(r.status).toBe("could_not_complete");
    expect(r.reason).toMatch(/hardcoded/);
    expect(box.scripts).toEqual([]);
  });

  it("fixes crashes up to three times using only the error", async () => {
    let n = 0;
    const box = new Box((_s, b) => {
      if (++n < 3) return { exitCode: 1, tail: "NameError: x" };
      b.files.set("reimplementation_result.json", Buffer.from('{"value":0.93}'));
      return {};
    });
    const m = model([py("a=1"), py("a=2"), py("a=3")]);
    const r = await run(m, box);
    expect(r.status).toBe("agrees");
    expect(r.attempts).toBe(3);
    expect(m.seen[1]).toContain("NameError: x");
  });

  it("gives up after the attempts run out", async () => {
    const m = model([py("a=1")]);
    const r = await run(m, new Box(() => ({ exitCode: 1, tail: "boom" })));
    expect(r.status).toBe("could_not_complete");
    expect(m.seen).toHaveLength(4);
  });

  it("does not attempt ineligible claims", async () => {
    const asks = model([py("x=1")]);
    const box = new Box();
    const skip = async (o: Parameters<typeof run>[2]) => (await run(asks, box, o)).status;
    expect(await skip({ methods: "  " })).toBe("not_attempted");
    expect(await skip({ data: new Map() })).toBe("not_attempted");
    expect(await skip({ newSandbox: undefined })).toBe("not_attempted");
    expect(await skip({ spec: { ...spec, private_data: { path: "p" } } as unknown as ClaimSpec })).toBe("not_attempted");
    expect(await skip({ spec: { ...spec, artifact: { ...spec.artifact, runtime: "r4.4" } } })).toBe("not_attempted");
    expect(asks.seen).toHaveLength(0);
    expect(box.created).toBe(0);
  });
});

describe("hiding the number", () => {
  it("redacts common ways of writing it, but not other numbers", () => {
    expect(redactReported("got 0.93 or .93 or 93% or 93 percent, with 0.931 and 193%", "0.93")).toBe("got [result hidden] or [result hidden] or [result hidden] or [result hidden], with 0.931 and 193%");
  });

  it("spots hardcoded values, including percentages", () => {
    expect(scriptContainsReported("value = 0.93", "0.93")).toBe(true);
    expect(scriptContainsReported("value = 93.0", "0.93")).toBe(true);
    expect(scriptContainsReported("value = model.score(X, y)", "0.93")).toBe(false);
    expect(scriptContainsReported("# about 0.93 in the paper\nvalue = f()", "0.93")).toBe(false);
  });

  it("doesn't ban numbers too common to mean anything", () => {
    expect(scriptContainsReported("test_size = 0.5", "0.5")).toBe(false);
    expect(scriptContainsReported("x = 1", "1")).toBe(false);
  });
});
