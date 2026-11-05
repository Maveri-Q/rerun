import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { generateLabKeyPair, sealToLab, type ClaimSpec } from "@rerun/shared";
import { ModelVerificationError, type PrivateModel } from "../src/pipeline/model.ts";
import { reproduce, type ArtifactResolver, type RunDeps, type StageEvent } from "../src/pipeline/pipeline.ts";
import type { ExecOptions, ExecResult, Sandbox } from "../src/sandbox/types.ts";

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const COMMIT = "a".repeat(40);
const DATA = "x,y\n1,2\n";

function spec(overrides: Partial<ClaimSpec> = {}): ClaimSpec {
  return {
    version: 1,
    title: "t",
    statement: "s",
    source: { type: "report", url: "https://x.test/p", license: "MIT", authors: "a" },
    artifact: {
      repo_url: "https://x.test/r.git",
      commit: COMMIT,
      data: [{ url: "https://x.test/d.csv", sha256: sha(DATA), path: "data/d.csv" }],
      runtime: "python3.11",
      setup: ["pip install -r requirements.txt"],
      entrypoint: "python run.py",
      output: { path: "out.json", extractor: { type: "jsonpath", expr: "$.acc" } },
    },
    metric: { name: "acc", reported_value: "0.9", tolerance: { type: "abs", value: "0.01" }, comparison: "within_tolerance" },
    resources: { cpu: 1, mem_gb: 1, max_minutes: 1 },
    private_data: null,
    ...overrides,
  };
}

type Script = { exitCode?: number; log?: string; timedOut?: boolean; effect?: (s: FakeSandbox) => void };

class FakeSandbox implements Sandbox {
  files = new Map<string, Buffer>([["run.py", Buffer.from('open("/home/a/d.csv")\n')]]);
  execs: { script: string; opts: ExecOptions }[] = [];
  destroyed = false;
  head = COMMIT;
  /** Results for the entrypoint, in order; the last one repeats. */
  runs: Script[] = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.9}')), log: "ok" }];
  setups: Script[] = [{}];

  async create() {}
  async exec(script: string, opts: ExecOptions): Promise<ExecResult> {
    this.execs.push({ script, opts });
    let r: Script = {};
    if (script.includes("rev-parse")) r = { log: `${this.head}\n` };
    else if (script.startsWith("pip install")) r = this.setups.length > 1 ? this.setups.shift()! : this.setups[0]!;
    else if (script === "python run.py") r = this.runs.length > 1 ? this.runs.shift()! : this.runs[0]!;
    r.effect?.(this);
    const log = r.log ?? "";
    return { exitCode: r.exitCode ?? 0, timedOut: r.timedOut ?? false, tail: log, log, logHash: sha(log), durationMs: 1000 };
  }
  async writeFile(path: string, data: Uint8Array) {
    this.files.set(path, Buffer.from(data));
  }
  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }
  async listFiles() {
    return [...this.files.keys()];
  }
  async destroy() {
    this.destroyed = true;
  }
}

class FakeModel implements PrivateModel {
  readonly modelId = "fake/model";
  calls: { purpose: string; text: string }[] = [];
  attested = false;
  replies: Record<string, string[]> = {};
  async attest() {
    this.attested = true;
  }
  async ask(purpose: string, messages: { content: string }[]) {
    this.calls.push({ purpose, text: messages.map((m) => m.content).join("\n") });
    const queue = this.replies[purpose];
    return queue && queue.length > 1 ? queue.shift()! : (queue?.[0] ?? "a short report");
  }
  attestationDigest() {
    return "d".repeat(64);
  }
  signatureRefs() {
    return ["chat-1"];
  }
}

const resolver = (overrides: Partial<ArtifactResolver> = {}): ArtifactResolver => ({
  fetchRepo: async () => true,
  fetchData: async () => Buffer.from(DATA),
  fetchCiphertext: async () => {
    throw new Error("none");
  },
  ...overrides,
});

let sandbox: FakeSandbox;
let model: FakeModel;
let events: StageEvent[];

beforeEach(() => {
  sandbox = new FakeSandbox();
  model = new FakeModel();
  events = [];
});

const run = (s: ClaimSpec = spec(), deps: Partial<RunDeps> = {}, labKeys?: { privateKey: string; publicKey: string }) =>
  reproduce(
    { spec: s, marketId: 3, runIndex: 0, labAccount: "lab.testnet", labCodehash: "c".repeat(64), labKeys },
    { sandbox, model, resolver: resolver(), emit: (e) => events.push(e), ...deps },
  );

const pathFix = JSON.stringify({
  give_up: false,
  reason: "laptop path",
  edits: [{ file: "run.py", kind: "PATH", justification: "point at the repo data file", search: '"/home/a/d.csv"', replace: '"data/d.csv"' }],
});

describe("reproduce: outcomes", () => {
  it("REPRODUCED within tolerance, with a complete receipt", async () => {
    const { receipt, report } = await run();
    expect(receipt.outcome).toBe("REPRODUCED");
    expect(receipt.measured_value).toBe("0.9");
    expect(receipt.data_hashes).toEqual([sha(DATA)]);
    expect(receipt.tolerance).toBe("abs:0.01");
    expect(receipt.env_lock_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.nearai.response_signature_refs).toEqual(["chat-1"]);
    expect(report).toContain("AI-written");
    expect(report).toMatch(/Evidence file sha256: [0-9a-f]{64}/);
    expect(model.attested).toBe(true);
    expect(sandbox.destroyed).toBe(true);
  });

  it("NOT_REPRODUCED outside tolerance", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.5}')) }];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("NOT_REPRODUCED");
    expect(receipt.measured_value).toBe("0.5");
  });

  it("runs research code with the network off and only setup with it on", async () => {
    await run();
    const setup = sandbox.execs.find((e) => e.script.startsWith("pip install"))!;
    const research = sandbox.execs.find((e) => e.script === "python run.py")!;
    expect(setup.opts.network).toBe(true);
    expect(research.opts.network).toBe(false);
    expect(research.opts.timeoutMs).toBe(60_000);
  });

  it("BROKEN when the model gives up, and the failing log is in the receipt", async () => {
    sandbox.runs = [{ exitCode: 1, log: "ModuleNotFoundError: labtools" }];
    model.replies.repair = ['{"give_up":true,"reason":"unpublished package","edits":[]}'];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("BROKEN");
    expect(receipt.exit_code).toBe(1);
    expect(receipt.log_tail).toContain("ModuleNotFoundError");
    expect(receipt.measured_value).toBeNull();
  });

  it("BROKEN when the run hits its time limit, with no repair attempt", async () => {
    sandbox.runs = [{ exitCode: 137, timedOut: true }];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("BROKEN");
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(0);
  });

  it("BROKEN when setup cannot be repaired", async () => {
    sandbox.setups = [{ exitCode: 1, log: "no matching distribution" }];
    model.replies.repair = ['{"give_up":true,"reason":"gone","edits":[]}'];
    expect((await run()).receipt.outcome).toBe("BROKEN");
  });
});

describe("reproduce: repair loop", () => {
  it("applies an ENV-only patch, re-runs, and records it in the receipt", async () => {
    sandbox.runs = [{ exitCode: 1, log: "FileNotFoundError" }, { effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.905}')) }];
    model.replies.repair = [pathFix];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("REPRODUCED");
    expect(sandbox.files.get("run.py")!.toString()).toContain('"data/d.csv"');
    expect(receipt.patches).toHaveLength(1);
    expect(receipt.patches[0]).toMatchObject({ file: "run.py", kind: "PATH" });
    expect(receipt.patches_diff_excerpt).toContain('+ "data/d.csv"');
    expect(events.some((e) => e.stage === "repairing" && e.diff)).toBe(true);
  });

  it("attack: an attempt to edit analysis code is rejected, logged, and never applied", async () => {
    const before = 'acc = accuracy_score(y, p)\n';
    sandbox.files.set("run.py", Buffer.from(before));
    sandbox.runs = [{ exitCode: 1, log: "boom" }];
    model.replies.repair = [
      JSON.stringify({
        give_up: false,
        reason: "make the number look better",
        edits: [{ file: "run.py", kind: "ENV", justification: "just an environment tweak", search: "accuracy_score(y, p)", replace: "0.95" }],
      }),
    ];
    const { receipt, rejectedEdits } = await run();
    expect(sandbox.files.get("run.py")!.toString()).toBe(before);
    expect(rejectedEdits.length).toBeGreaterThan(0);
    expect(rejectedEdits[0]!.reason).toMatch(/numbers changed|analysis/);
    expect(receipt.patches).toHaveLength(0);
    expect(receipt.outcome).toBe("BROKEN");
  });

  it("installs packages again after the AI fixes the package list during the run", async () => {
    sandbox.runs = [
      { exitCode: 1, log: "ModuleNotFoundError: No module named 'tqdm'" },
      { effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.9}')), log: "ok" },
    ];
    model.replies.repair = ['{"give_up":false,"reason":"missing package","edits":[{"file":"requirements.txt","kind":"DEPENDENCY","justification":"add a missing package","search":"","replace":"tqdm\\n"}]}'];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("REPRODUCED");
    const installs = sandbox.execs.filter((e) => e.script.startsWith("pip install"));
    expect(installs).toHaveLength(2);
    expect(installs[1]!.opts.network).toBe(true);
    const order = sandbox.execs.map((e) => e.script);
    expect(order.lastIndexOf("pip install -r requirements.txt")).toBeLessThan(order.lastIndexOf("python run.py"));
  });

  it("shows the AI the code around the error, so it can write an exact edit", async () => {
    sandbox.files.set("run.py", Buffer.from(Array.from({ length: 30 }, (_, i) => `line_${i + 1}`).join("\n")));
    sandbox.runs = [{ exitCode: 1, log: 'Traceback:\n  File "/work/repo/run.py", line 15, in <module>\nAttributeError: gone' }];
    model.replies.repair = ['{"give_up":true,"reason":"no","edits":[]}'];
    await run();
    const prompt = model.calls.find((c) => c.purpose === "repair")!.text;
    expect(prompt).toContain("15: line_15");
    expect(prompt).toContain("7: line_7");
    expect(prompt).not.toContain("line_30");
  });

  it("posts no verdict when the internet keeps failing during setup", async () => {
    sandbox.setups = [{ exitCode: 1, log: "ReadTimeoutError: Read timed out." }];
    await expect(run()).rejects.toThrow(/no verdict is posted/);
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(0);
  });

  it("carries on when the internet comes back during setup", async () => {
    sandbox.setups = [{ exitCode: 1, log: "Could not resolve host: pypi.org" }, {}];
    expect((await run()).receipt.outcome).toBe("REPRODUCED");
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(0);
  });

  it("posts no verdict when the AI never gives a usable answer, because no repair was really tried", async () => {
    sandbox.runs = [{ exitCode: 1, log: "still failing" }];
    model.replies.repair = ["this is not JSON"];
    await expect(run()).rejects.toThrow(/no verdict is posted/);
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(3);
  });

  it("stops after three attempts and says BROKEN once the AI really tried", async () => {
    sandbox.runs = [{ exitCode: 1, log: "still failing" }];
    model.replies.repair = ["this is not JSON", "this is not JSON", '{"give_up":true,"reason":"nothing to fix","edits":[]}'];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("BROKEN");
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(3);
  });

  it("rejects a patch whose search text is ambiguous", async () => {
    sandbox.files.set("run.py", Buffer.from('"/home/a/d.csv"\n"/home/a/d.csv"\n'));
    sandbox.runs = [{ exitCode: 1, log: "x" }];
    model.replies.repair = [pathFix];
    const { rejectedEdits } = await run();
    expect(rejectedEdits[0]!.reason).toMatch(/exactly once/);
  });
});

describe("reproduce: INVALID", () => {
  it("attack: a data file swapped after creation is a hash mismatch", async () => {
    const { receipt } = await run(spec(), { resolver: resolver({ fetchData: async () => Buffer.from("tampered") }) });
    expect(receipt.outcome).toBe("INVALID");
    expect(receipt.invalid_reason).toBe("HASH_MISMATCH");
    expect(receipt.data_hashes).toEqual([sha("tampered")]);
    expect(sandbox.execs.some((e) => e.script === "python run.py")).toBe(false);
  });

  it("repository at the wrong commit is a hash mismatch", async () => {
    sandbox.head = "b".repeat(40);
    expect((await run()).receipt.invalid_reason).toBe("HASH_MISMATCH");
  });

  it("unavailable code or data is DATA_UNAVAILABLE", async () => {
    expect((await run(spec(), { resolver: resolver({ fetchRepo: async () => false }) })).receipt.invalid_reason).toBe("DATA_UNAVAILABLE");
    sandbox = new FakeSandbox();
    const gone = resolver({ fetchData: async () => Promise.reject(new Error("404")) });
    expect((await run(spec(), { resolver: gone })).receipt.invalid_reason).toBe("DATA_UNAVAILABLE");
  });

  it("EXTRACTION_FAILED when neither the spec nor the model finds the metric", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"other":1}')) }];
    model.replies.extract = ['{"path":"out.json","type":"jsonpath","expr":"$.nope"}'];
    const { receipt } = await run();
    expect(receipt.outcome).toBe("INVALID");
    expect(receipt.invalid_reason).toBe("EXTRACTION_FAILED");
  });
});

describe("reproduce: the LLM never supplies the number", () => {
  it("its location hint is used, but code reads the value from the file", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"nested":{"acc":0.9}}')) }];
    model.replies.extract = ['{"path":"out.json","type":"jsonpath","expr":"$.nested.acc","value":"0.5"}'];
    const { receipt } = await run();
    expect(receipt.measured_value).toBe("0.9");
    expect(receipt.outcome).toBe("REPRODUCED");
  });

  it("a hint pointing outside the repo is ignored", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from("{}")) }];
    sandbox.files.set("../secret", Buffer.from('{"acc":0.9}'));
    model.replies.extract = ['{"path":"../secret","type":"jsonpath","expr":"$.acc"}'];
    expect((await run()).receipt.invalid_reason).toBe("EXTRACTION_FAILED");
  });
});

describe("reproduce: model trust", () => {
  it("does not start without an attested model", async () => {
    model.attest = async () => {
      throw new ModelVerificationError("bad quote");
    };
    await expect(run()).rejects.toThrow("bad quote");
    expect(sandbox.execs).toHaveLength(0);
  });

  it("an unverifiable report aborts the run, but still deletes the workspace", async () => {
    model.ask = async () => {
      throw new ModelVerificationError("bad signature");
    };
    await expect(run()).rejects.toThrow("bad signature");
    expect(sandbox.destroyed).toBe(true);
  });
});

describe("reproduce: private data", () => {
  const lab = generateLabKeyPair();
  const PLAIN = "patient,secret_value\nP1,SENSITIVE_ROW\n";
  const privateSpec = (sha256_plain = sha(PLAIN)) =>
    spec({
      private_data: { ciphertext_ref: "https://x.test/sealed.bin", sha256_plain, owner: "h.testnet", path: "private/d.csv" },
    });
  const sealed = resolver({ fetchCiphertext: async () => sealToLab(Buffer.from(PLAIN), lab.publicKey) });

  it("runs on decrypted data and leaks nothing into the receipt, report, or stream", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.9}')), log: "SENSITIVE_ROW in a debug print" }];
    const stored: string[] = [];
    const { receipt, report } = await run(
      privateSpec(),
      { resolver: sealed, store: async (kind, _h, content) => (stored.push(`${kind}:${content}`), `uri-${kind}`) },
      lab,
    );
    expect(receipt.outcome).toBe("REPRODUCED");
    expect(sandbox.files.get("private/d.csv")!.toString()).toBe(PLAIN);
    expect(receipt.log_tail).toBe("");
    expect(receipt.full_log_uri).toBe("");
    const everything = JSON.stringify([receipt, report, events, stored, model.calls]);
    expect(everything).not.toContain("SENSITIVE_ROW");
    expect(sandbox.destroyed).toBe(true);
  });

  it("the plaintext only enters the sandbox after setup has finished", async () => {
    let presentDuringSetup = true;
    sandbox.setups = [{ effect: (s) => (presentDuringSetup = s.files.has("private/d.csv")) }];
    await run(privateSpec(), { resolver: sealed }, lab);
    expect(presentDuringSetup).toBe(false);
  });

  it("a failed run shares no logs with the model", async () => {
    sandbox.runs = [{ exitCode: 1, log: "SENSITIVE_ROW traceback" }];
    const { receipt } = await run(privateSpec(), { resolver: sealed }, lab);
    expect(receipt.outcome).toBe("BROKEN");
    expect(model.calls.filter((c) => c.purpose === "repair")).toHaveLength(0);
    expect(JSON.stringify(model.calls)).not.toContain("SENSITIVE_ROW");
  });

  it("extraction failure does not ask the model", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"note":"SENSITIVE_ROW"}')) }];
    const { receipt } = await run(privateSpec(), { resolver: sealed }, lab);
    expect(receipt.invalid_reason).toBe("EXTRACTION_FAILED");
    expect(model.calls.filter((c) => c.purpose === "extract")).toHaveLength(0);
  });

  it("wrong key or tampered data is INVALID", async () => {
    const other = generateLabKeyPair();
    expect((await run(privateSpec(), { resolver: sealed }, other)).receipt.invalid_reason).toBe("DATA_UNAVAILABLE");
    sandbox = new FakeSandbox();
    expect((await run(privateSpec("f".repeat(64)), { resolver: sealed }, lab)).receipt.invalid_reason).toBe("HASH_MISMATCH");
  });
});

describe("reproduce: contract limits", () => {
  it("cuts the log tail and diff excerpt to 4 KB on bytes, including multi-byte output", async () => {
    sandbox.runs = [{ effect: (s) => s.files.set("out.json", Buffer.from('{"acc":0.9}')), log: "日本語".repeat(5000) }];
    const { receipt } = await run();
    expect(Buffer.byteLength(receipt.log_tail)).toBeLessThanOrEqual(4096);
    expect(receipt.log_tail).not.toContain("�");
  });
});
