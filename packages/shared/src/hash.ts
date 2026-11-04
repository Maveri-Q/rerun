import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import type { ClaimSpec } from "./spec.ts";

/** Node-only hashing. The web app uses WebCrypto over the same canonical bytes. */

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** spec_hash as stored on-chain: sha256 of the canonical JSON bytes. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export const specHash = (spec: ClaimSpec): string => canonicalHash(spec);
