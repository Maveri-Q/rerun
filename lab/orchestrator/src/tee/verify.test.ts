import { describe, expect, it } from "vitest";
import type { LabAttestation } from "./dstack.ts";
import { attestationFingerprint, composeImages, verifyLabAttestation } from "./verify.ts";

const att: LabAttestation = {
  lab_account: "lab.testnet",
  near_public_key: "ed25519:abc",
  enc_public_key: "0".repeat(64),
  report_data: "1".repeat(64),
  compose_hash: "c".repeat(64),
  app_id: "aa",
  quote: "0102",
  event_log: "[]",
};

describe("checking a Lab's attestation", () => {
  it("fingerprints the same attestation the same way, whatever the key order", () => {
    const reordered = Object.fromEntries(Object.entries(att).reverse()) as unknown as LabAttestation;
    expect(attestationFingerprint(reordered)).toBe(attestationFingerprint(att));
    expect(attestationFingerprint({ ...att, quote: "0103" })).not.toBe(attestationFingerprint(att));
  });

  it("reads the images out of a dstack app compose", () => {
    const compose = JSON.stringify({
      docker_compose_file: "services:\n  lab:\n    image: ghcr.io/x/lab@sha256:" + "a".repeat(64) + "\n  other:\n    image: \"busybox:latest\"\n",
    });
    expect(composeImages(compose)).toEqual(["ghcr.io/x/lab@sha256:" + "a".repeat(64), "busybox:latest"]);
  });

  it("fails anything that isn't a real TDX quote", async () => {
    const v = await verifyLabAttestation(att, { labAccount: "lab.testnet" }, { verifyQuote: async () => ({ status: "UpToDate" }) });
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "quote parses as Intel TDX")?.ok).toBe(false);
  });

  it("fails the wrong Lab account before looking at the quote", async () => {
    const v = await verifyLabAttestation(att, { labAccount: "someone-else.testnet" });
    expect(v.checks[0]).toMatchObject({ name: "for the expected Lab account", ok: false });
  });
});
