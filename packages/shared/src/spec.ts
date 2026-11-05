import { z } from "zod";
import { canonicalJson } from "./canonical.ts";
import { parseDecimal } from "./decimal.ts";

/** ClaimSpec and Receipt. Rules mirror contracts/rerun/src/spec.rs and types.rs. */

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex chars");
const httpsUrl = z.string().min(9).max(500).regex(/^https:\/\/\S+$/, "must be an https:// URL");
const relPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((seg) => seg === ".." || seg === ""), {
    message: "must be a relative path without '..'",
  });
const tryDecimal = (s: string): bigint | null => {
  try {
    return parseDecimal(s);
  } catch {
    return null;
  }
};
const decimal = z.string().refine((s) => tryDecimal(s) !== null, { message: "must be a decimal string" });

export const ClaimSpec = z.strictObject({
  version: z.literal(1),
  title: z.string().min(1).max(120),
  statement: z.string().min(1).max(600),
  source: z.strictObject({
    type: z.enum(["paper", "report", "dataset", "onchain"]),
    url: httpsUrl,
    doi: z.string().min(1).max(200).optional(),
    license: z.string().min(1).max(200),
    authors: z.string().min(1).max(500),
  }),
  artifact: z.strictObject({
    repo_url: httpsUrl,
    commit: z.string().regex(/^[0-9a-f]{40}$/, "must be a full 40-char lowercase SHA"),
    data: z.array(z.strictObject({ url: httpsUrl, sha256: hex64, path: relPath })).max(16),
    runtime: z.enum(["python3.11", "r4.4"]),
    setup: z.array(z.string().min(1).max(300)).max(16),
    entrypoint: z.string().min(1).max(300),
    output: z.strictObject({
      path: relPath,
      extractor: z.strictObject({ type: z.enum(["jsonpath", "regex", "csv_cell"]), expr: z.string().min(1).max(300) }),
    }),
  }),
  metric: z.strictObject({
    name: z.string().min(1).max(80),
    reported_value: decimal,
    tolerance: z.strictObject({
      type: z.enum(["abs", "rel"]),
      value: decimal.refine((v) => (tryDecimal(v) ?? 1n) > 0n, { message: "must be > 0" }),
    }),
    comparison: z.literal("within_tolerance"),
  }),
  resources: z.strictObject({
    cpu: z.number().int().min(1).max(8),
    mem_gb: z.number().int().min(1).max(32),
    max_minutes: z.number().int().min(1).max(120),
  }),
  private_data: z
    .strictObject({ ciphertext_ref: z.string().min(1).max(300), sha256_plain: hex64, owner: z.string().min(2).max(64), path: relPath })
    .nullable(),
});
export type ClaimSpec = z.infer<typeof ClaimSpec>;

export const specJson = (spec: ClaimSpec): string => canonicalJson(spec);

export const Outcome = z.enum(["REPRODUCED", "NOT_REPRODUCED", "BROKEN", "INVALID"]);
export type Outcome = z.infer<typeof Outcome>;

export const InvalidReason = z.enum(["SPEC_AMBIGUOUS", "DATA_UNAVAILABLE", "HASH_MISMATCH", "EXTRACTION_FAILED", "ENV_SETUP_FAILED"]);
export type InvalidReason = z.infer<typeof InvalidReason>;

export const PatchKind = z.enum(["ENV", "PATH", "DEPENDENCY"]);
export type PatchKind = z.infer<typeof PatchKind>;

/** Field names and shapes match the contract's `Receipt`. */
export interface Receipt {
  market_id: number;
  spec_hash: string;
  outcome: Outcome;
  invalid_reason: InvalidReason | null;
  measured_value: string | null;
  reported_value: string;
  tolerance: string;
  commit: string;
  data_hashes: string[];
  env_lock_hash: string;
  patches: { file: string; kind: PatchKind; diff_hash: string }[];
  patches_diff_excerpt: string;
  log_hash: string;
  log_tail: string;
  full_log_uri: string;
  report_hash: string;
  report_uri: string;
  runtime_secs: number;
  exit_code: number;
  lab_codehash: string;
  lab_account: string;
  nearai: { model_id: string; attestation_digest: string; response_signature_refs: string[] };
  run_index: number;
  started_at: number;
  finished_at: number;
}
