import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ClaimSpec, type Outcome } from "@rerun/shared";
import type { ChatRequest } from "../nearai/client.ts";
import { NetworkResolver } from "../pipeline/resolver.ts";
import type { ArtifactResolver } from "../pipeline/pipeline.ts";

/**
 * Real published research, unlike the demo fixtures: the code is cloned from GitHub at a pinned
 * commit, and the reported number is copied from the paper. `expected` is only what we predicted
 * from reading the paper; the comparator still decides. Sources are listed in docs/SOURCES.md.
 */

const REAL_ROOT = path.resolve(import.meta.dirname, "../../../../claims/real");

export const REAL_NAMES = readdirSync(REAL_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

export interface RealClaim {
  name: string;
  spec: ClaimSpec;
  expected: Outcome;
  expectedPatches: number | null;
  resolver: ArtifactResolver;
  mockResponder: (req: ChatRequest) => string | undefined;
  methods?: string;
}

export function loadReal(name: string): RealClaim {
  const file = JSON.parse(readFileSync(path.join(REAL_ROOT, name, "claim.json"), "utf8")) as { expected: Outcome; methods?: string; spec: unknown };
  const spec = ClaimSpec.parse(file.spec);
  return {
    name,
    spec,
    expected: file.expected,
    // A real repository may or may not need repairs. The receipt records whatever happened.
    expectedPatches: null,
    resolver: new NetworkResolver(),
    methods: file.methods,
    mockResponder: (req) => (req.purpose === "report" ? `MOCK report: "${spec.title}" was re-run. See the receipt for the numbers.` : undefined),
  };
}
