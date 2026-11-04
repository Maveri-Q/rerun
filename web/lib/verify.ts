import { parseDecimal, withinTolerance, type ToleranceKind } from "@rerun/shared/browser";
import { chain } from "./chain";
import { lab, type AttestationRecord } from "./lab";
import type { Market, Receipt } from "./market";
import { sha256Hex } from "./seal";

/**
 * The Verified panel. Every line is recomputed in this browser from chain data, or read from
 * NVIDIA- and Intel-backed records, so a viewer does not have to take the Lab's word.
 */

export type CheckState = "pass" | "fail" | "warn";

export interface VerifyCheck {
  label: string;
  state: CheckState;
  detail: string;
}

export interface Verification {
  checks: VerifyCheck[];
  attestation: AttestationRecord | null;
}

export async function verifyReceipt(market: Market, r: Receipt): Promise<Verification> {
  const checks: VerifyCheck[] = [];
  const add = (label: string, state: CheckState, detail: string) => checks.push({ label, state, detail });

  const [approved, registered, specJson, attestation] = await Promise.all([
    chain.codehashApproved(r.lab_codehash),
    chain.lab(r.lab_account),
    chain.spec(market.id),
    lab.attestation(r.nearai.attestation_digest),
  ]);

  add(
    "Lab code is approved",
    approved ? "pass" : "fail",
    approved ? `The contract lists code ${r.lab_codehash.slice(0, 12)}… as approved.` : "This code hash is no longer approved by the contract.",
  );

  if (!registered) add("Lab runs in a verified TEE", "fail", `${r.lab_account} is not registered with the contract.`);
  else if (registered.local) add("Lab runs in a verified TEE", "warn", "Not yet. This testnet Lab is registered locally, without TEE attestation.");
  else add("Lab runs in a verified TEE", "pass", "The contract checked this Lab's attestation at registration.");

  if (!attestation) {
    add("AI model attestation", "warn", "The Lab's record could not be fetched, so this browser cannot show it.");
  } else if (attestation.mock) {
    add("AI model attestation", "warn", "This run used a scripted test model, so there is nothing to attest.");
  } else {
    const ok = attestation.reports.length > 0 && attestation.reports.every((x) => x.ok);
    add(
      "AI model attestation",
      ok ? "pass" : "fail",
      ok ? `${attestation.model}: Intel TDX and NVIDIA GPU quotes verified. Signed replies: ${r.nearai.response_signature_refs.length}.` : `The record for ${attestation.model} contains a failed check.`,
    );
  }

  const specHash = specJson ? await sha256Hex(specJson) : null;
  add(
    "Claim matches the receipt",
    specHash === r.spec_hash ? "pass" : "fail",
    specHash === r.spec_hash ? `This browser hashed the on-chain claim and got ${r.spec_hash.slice(0, 12)}….` : "The on-chain claim hashes to something else.",
  );

  const sameData = JSON.stringify(r.data_hashes) === JSON.stringify(market.spec.data_hashes);
  if (r.outcome === "INVALID" && r.invalid_reason === "HASH_MISMATCH") {
    add("Data matches the claim", "warn", "The data the Lab received did not match the claim, which is why this market is invalid.");
  } else if (r.outcome === "INVALID" && !sameData) {
    add("Data matches the claim", "warn", "The Lab could not get all the data, which is why this market is invalid.");
  } else {
    add("Data matches the claim", sameData ? "pass" : "fail", r.data_hashes.length === 0 && sameData ? "This claim has no public data files." : sameData ? `All ${r.data_hashes.length} file hashes equal the claim's.` : "The data hashes differ from the claim's.");
  }

  const allowed = r.patches.every((p) => ["ENV", "PATH", "DEPENDENCY"].includes(p.kind));
  add(
    "Only the environment was patched",
    allowed ? "pass" : "fail",
    r.patches.length === 0 ? "No patches were needed." : `Patches: ${r.patches.map((p) => `${p.file} (${p.kind})`).join(", ")}. The diff is on this page.`,
  );

  if (r.measured_value !== null) {
    const [kind = "abs", value = "0"] = r.tolerance.split(":");
    const within = withinTolerance(parseDecimal(r.measured_value), parseDecimal(r.reported_value), kind as ToleranceKind, parseDecimal(value));
    const consistent = within === (r.outcome === "REPRODUCED");
    add(
      "Verdict follows from the numbers",
      consistent ? "pass" : "fail",
      `Measured ${r.measured_value} is ${within ? "inside" : "outside"} ${r.reported_value} ± ${kind === "rel" ? `${value} (relative)` : value}. Recomputed here.`,
    );
  }

  return { checks, attestation };
}
