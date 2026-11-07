import { parseDecimal, withinTolerance, type ToleranceKind } from "@rerun/shared/browser";
import { chain } from "./chain";
import { evidenceHashIn, lab, type AttestationRecord } from "./lab";
import { patchAuthors, type Market, type Receipt } from "./market";
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
    "The Lab is approved",
    approved ? "pass" : "fail",
    approved ? "The contract still lists this Lab's code as approved to post results." : "The contract no longer approves this Lab's code.",
  );

  if (!registered) add("The Lab runs on secure hardware", "fail", `${r.lab_account} is not registered with the contract.`);
  else if (registered.local) add("The Lab runs on secure hardware", "warn", "Not yet. This practice Lab runs on an ordinary computer. It moves to secure hardware before launch.");
  else add("The Lab runs on secure hardware", "pass", "The contract checked the hardware's proof when this Lab registered.");

  if (!attestation) {
    add("The AI ran on secure hardware", "warn", "The Lab's record couldn't be loaded, so this can't be shown right now.");
  } else if (attestation.mock) {
    add("The AI ran on secure hardware", "warn", "This run used a scripted test AI, so there is nothing to prove.");
  } else {
    const ok = attestation.reports.length > 0 && attestation.reports.every((x) => x.ok);
    add(
      "The AI ran on secure hardware",
      ok ? "pass" : "fail",
      ok ? `Intel and NVIDIA proofs for ${attestation.model} were checked. Replies signed by it: ${r.nearai.response_signature_refs.length}.` : `A hardware proof for ${attestation.model} failed.`,
    );
  }

  const specHash = specJson ? await sha256Hex(specJson) : null;
  add(
    "The receipt is about this exact claim",
    specHash === r.spec_hash ? "pass" : "fail",
    specHash === r.spec_hash ? "Your browser fingerprinted the claim stored on-chain, and it matches the receipt." : "The claim stored on-chain has a different fingerprint from the receipt.",
  );

  const sameData = JSON.stringify(r.data_hashes) === JSON.stringify(market.spec.data_hashes);
  if (r.outcome === "INVALID" && r.invalid_reason === "HASH_MISMATCH") {
    add("The data is what the claim promised", "warn", "The data the Lab received did not match the claim, which is why this market is invalid.");
  } else if (r.outcome === "INVALID" && !sameData) {
    add("The data is what the claim promised", "warn", "The Lab could not get all the data, which is why this market is invalid.");
  } else {
    add("The data is what the claim promised", sameData ? "pass" : "fail", r.data_hashes.length === 0 && sameData ? "This claim has no public data files." : sameData ? "Every data file's fingerprint matches the claim." : "The data files' fingerprints differ from the claim.");
  }

  const allowed = r.patches.every((p) => ["ENV", "PATH", "DEPENDENCY"].includes(p.kind));
  // The chain records who made each change in the receipt's excerpt. One with no author there is the AI's.
  const authors = patchAuthors(r.patches_diff_excerpt ?? "");
  const changedBy = (by: string) => authors.filter((a) => a.by === by).map((a) => a.file);
  const madeBy = [["a person", changedBy("human")], ["the Lab's setup step", changedBy("system")], ["the AI", changedBy("ai")]] as const;
  const changes = madeBy.filter(([, files]) => files.length > 0).map(([who, files]) => `By ${who}: ${files.join(", ")}.`).join(" ");
  add(
    "Only setup was changed, never the science",
    allowed ? "pass" : "fail",
    r.patches.length === 0 ? "No fixes were needed." : `${changes || `Changed: ${r.patches.map((p) => p.file).join(", ")}.`} The exact change is on the receipt.`,
  );

  if (r.measured_value !== null) {
    const [kind = "abs", value = "0"] = r.tolerance.split(":");
    const within = withinTolerance(parseDecimal(r.measured_value), parseDecimal(r.reported_value), kind as ToleranceKind, parseDecimal(value));
    const consistent = within === (r.outcome === "REPRODUCED");
    add(
      "The verdict follows from the numbers",
      consistent ? "pass" : "fail",
      `The Lab got ${r.measured_value}, which is ${within ? "inside" : "outside"} the allowed range. Your browser redid this sum.`,
    );
  }

  const report = await lab.report(r.report_hash);
  if (report === null) {
    add("The write-up hasn't changed", "warn", "The Lab's write-up couldn't be loaded, so this can't be shown right now.");
  } else {
    const same = (await sha256Hex(report)) === r.report_hash;
    const evidenceHash = evidenceHashIn(report);
    const evidence = same && evidenceHash ? await lab.evidenceText(evidenceHash) : null;
    if (same && evidenceHash && evidence === null) {
      add("The write-up hasn't changed", "warn", "The write-up matches its fingerprint on-chain, but its evidence file couldn't be loaded, so that part can't be shown right now.");
    } else {
      const evidenceOk = evidence === null || (await sha256Hex(evidence)) === evidenceHash;
      add(
        "The write-up hasn't changed",
        same && evidenceOk ? "pass" : "fail",
        same && evidenceOk ? "The write-up and its evidence match the fingerprint recorded on-chain." : "The write-up or its evidence doesn't match the fingerprint recorded on-chain.",
      );
    }
  }

  return { checks, attestation };
}
