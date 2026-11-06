import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClaimSpec, sealToLab, specHash, type Outcome } from "@rerun/shared";
import type { ChatRequest } from "../nearai/client.ts";
import type { ArtifactResolver, LabKeys } from "../pipeline/pipeline.ts";
import type { Sandbox } from "../sandbox/types.ts";

/**
 * Demo claims on made-up practice data, labelled as such. Each repo is committed with a fixed
 * author and date, so its commit SHA is stable. Demo URLs use the reserved `.invalid` domain and
 * resolve to local files; they are not real artifacts.
 *
 * `_old` holds the previous demos unchanged, because claims already on testnet pin their hashes
 * and the Lab must still recognise them when they lock.
 */

const DEMO_ROOT = path.resolve(import.meta.dirname, "../../../../claims/demo");
const OLD_ROOT = path.join(DEMO_ROOT, "_old");
export const DEMO_NAMES = ["reproduces", "misreported", "repairable", "broken", "private", "swapped-data"] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

interface ClaimFile {
  expected: Outcome;
  expected_patches?: number;
  /** Serve different bytes than the spec pins: the attack the hash check exists for. */
  swap_data?: boolean;
  methods?: string;
  /** The scripted re-implementation used with MOCK_LLM=1. */
  mock_reimplementation?: string;
  title: string;
  statement: string;
  metric: ClaimSpec["metric"];
  entrypoint: string;
  setup: string[];
  output: ClaimSpec["artifact"]["output"];
  data: { file: string; path: string }[];
  private?: { path: string };
  mock_llm?: { repair?: string };
}

export interface DemoClaim {
  name: DemoName;
  spec: ClaimSpec;
  expected: Outcome;
  expectedPatches: number;
  resolver: ArtifactResolver;
  mockResponder: (req: ChatRequest) => string | undefined;
  /** The fixture's methods section, for the re-implementation check. */
  methods?: string;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const lf = (b: Buffer) => Buffer.from(b.toString("utf8").replaceAll("\r\n", "\n"));

function buildRepo(dir: string): { commit: string; bundle: Buffer } {
  const tmp = mkdtempSync(path.join(tmpdir(), "rerun-demo-"));
  try {
    const work = path.join(tmp, "repo");
    mkdirSync(work);
    for (const f of readdirSync(dir)) {
      if (statSync(path.join(dir, f)).isFile()) writeFileSync(path.join(work, f), lf(readFileSync(path.join(dir, f))));
    }
    const date = "2026-11-01T00:00:00Z";
    const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "user.name=RERUN demo", "-c", "user.email=demo@rerun.invalid", ...args],
        { cwd: work, env, stdio: ["ignore", "pipe", "ignore"] },
      );
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "demo fixture");
    const commit = git("rev-parse", "HEAD").toString().trim();
    const bundlePath = path.join(tmp, "repo.bundle");
    git("bundle", "create", "-q", bundlePath, "main");
    return { commit, bundle: readFileSync(bundlePath) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function seeded(start: number) {
  let seed = start;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up gym's member records. Only generated in memory; never written to the repo. */
export function syntheticGym(): Buffer {
  const r = seeded(7_301_991);
  const rows = ["member_id,weekly_visitor,months_stayed"];
  for (let i = 0; i < 1000; i++) {
    const weekly = r() < 0.5;
    rows.push(`M${100000 + i},${weekly ? "yes" : "no"},${Math.round((weekly ? 14 : 10) + (r() - 0.5) * 8)}`);
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

/** The previous demo's records, kept so its pinned hash still matches. */
function syntheticReadmissions(): Buffer {
  const r = seeded(7_301_991);
  const rows = ["patient_id,age,prior_admissions,length_of_stay,comorbidities,readmitted_30d"];
  for (let i = 0; i < 1000; i++) {
    const age = 40 + Math.floor(r() * 50);
    const prior = Math.floor(r() * 6);
    const stay = 1 + Math.floor(r() * 14);
    const comorbid = Math.floor(r() * 5);
    const logit = -3.6 + 0.02 * (age - 60) + 0.7 * prior + 0.1 * stay + 0.45 * comorbid + (r() - 0.5) * 2.5;
    rows.push(`P${100000 + i},${age},${prior},${stay},${comorbid},${logit > 0 ? 1 : 0}`);
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

export function loadDemo(name: DemoName, labKeys: LabKeys, root = DEMO_ROOT): DemoClaim {
  const dir = path.join(root, name);
  const claim = JSON.parse(readFileSync(path.join(dir, "claim.json"), "utf8")) as ClaimFile;
  const { commit, bundle } = buildRepo(path.join(dir, "repo"));

  const files = new Map<string, Uint8Array>();
  const data = claim.data.map((d) => {
    const bytes = lf(readFileSync(path.join(root, "_data", d.file)));
    const url = `https://rerun.invalid/demo/data/${d.file}`;
    files.set(url, claim.swap_data ? Buffer.concat([bytes, Buffer.from("99,99,9.999,1")]) : bytes);
    return { url, sha256: sha256(bytes), path: d.path };
  });

  let privateData: ClaimSpec["private_data"] = null;
  if (claim.private) {
    const old = root === OLD_ROOT;
    const plain = old ? syntheticReadmissions() : syntheticGym();
    const ref = `https://rerun.invalid/demo/sealed/${name}.bin`;
    files.set(ref, sealToLab(plain, labKeys.publicKey));
    privateData = { ciphertext_ref: ref, sha256_plain: sha256(plain), owner: old ? "demo-hospital.testnet" : "demo-gym.testnet", path: claim.private.path };
  }

  const spec = ClaimSpec.parse({
    version: 1,
    title: claim.title,
    statement: claim.statement,
    source: { type: "report", url: `https://rerun.invalid/demo/${name}`, license: "MIT", authors: root === OLD_ROOT ? "RERUN demo fixture" : "RERUN practice data" },
    artifact: {
      repo_url: `https://rerun.invalid/demo/${name}.git`,
      commit,
      data,
      runtime: "python3.11",
      setup: claim.setup,
      entrypoint: claim.entrypoint,
      output: claim.output,
    },
    metric: claim.metric,
    resources: { cpu: 2, mem_gb: 2, max_minutes: 3 },
    private_data: privateData,
  });

  const lookup = async (url: string) => {
    const bytes = files.get(url);
    if (!bytes) throw new Error(`no demo file for ${url}`);
    return bytes;
  };
  const resolver: ArtifactResolver = {
    async fetchRepo(s: ClaimSpec, sandbox: Sandbox) {
      await sandbox.writeFile("../repo.bundle", bundle);
      const r = await sandbox.exec(`git clone -q repo.bundle repo && git -C repo checkout -q ${s.artifact.commit} && rm repo.bundle`, {
        network: false,
        timeoutMs: 60_000,
        cwd: "/work",
      });
      return r.exitCode === 0;
    },
    fetchData: lookup,
    fetchCiphertext: lookup,
  };

  return {
    name,
    spec,
    expected: claim.expected,
    expectedPatches: claim.expected_patches ?? 0,
    resolver,
    methods: claim.methods ? readFileSync(path.join(root, "_data", claim.methods), "utf8") : undefined,
    mockResponder: (req) => {
      if (req.purpose === "repair") return claim.mock_llm?.repair;
      if (req.purpose === "reimplement") return readFileSync(path.join(root, "_data", claim.mock_reimplementation ?? "mock-reimplementation.md"), "utf8");
      if (req.purpose === "report") return `MOCK report: the claim "${claim.title}" was re-run. See the receipt for the outcome.`;
      return undefined;
    },
  };
}

/** The demo fixture behind an on-chain spec, if it is one. Real claims return undefined. */
export function demoForSpec(spec: ClaimSpec, labKeys: LabKeys): DemoClaim | undefined {
  if (!spec.artifact.repo_url.startsWith("https://rerun.invalid/demo/")) return undefined;
  for (const root of [DEMO_ROOT, OLD_ROOT]) {
    for (const name of DEMO_NAMES) {
      const demo = loadDemo(name, labKeys, root);
      if (specHash(demo.spec) === specHash(spec)) return demo;
    }
  }
  return undefined;
}
