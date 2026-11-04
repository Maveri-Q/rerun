import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  replayRtmr3,
  verifyAttestationReport,
  withNetworkRetry,
  type AttestationReport,
  type EventLogEntry,
  type VerifyDeps,
} from "../src/nearai/attestation.ts";

// A real NEAR AI Cloud report recorded with a known nonce. DCAP and NRAS are network
// services, so they are stubbed here; `pnpm nearai:hello` exercises them live.
const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/attestation-report.json"), "utf8")) as {
  nonce: string;
  model: string;
  report: AttestationReport;
};

const offline: VerifyDeps = {
  verifyQuote: async () => ({ status: "UpToDate" }),
  verifyGpu: async () => ({ overall: true, nonce: fixture.nonce }),
};

const clone = (): AttestationReport => structuredClone(fixture.report);
const failed = (checks: { name: string; ok: boolean }[]) => checks.filter((c) => !c.ok).map((c) => c.name);

describe("verifyAttestationReport (recorded report)", () => {
  it("passes every local check for the genuine report", async () => {
    const v = await verifyAttestationReport(clone(), fixture.nonce, fixture.model, offline);
    expect(failed(v.gateway.checks)).toEqual([]);
    expect(v.models.flatMap((m) => failed(m.checks))).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a report replayed for a different nonce", async () => {
    const v = await verifyAttestationReport(clone(), "00".repeat(32), fixture.model, offline);
    expect(v.ok).toBe(false);
    expect(failed(v.gateway.checks)).toContain("report_data binds signing key + nonce");
  });

  it("rejects a swapped signing address", async () => {
    const r = clone();
    r.model_attestations![0]!.signing_address = "0x000000000000000000000000000000000000dead";
    const v = await verifyAttestationReport(r, fixture.nonce, fixture.model, offline);
    expect(failed(v.models[0]!.checks)).toContain("report_data binds signing key + nonce");
  });

  it("rejects a tampered app_compose", async () => {
    const r = clone();
    const info = r.gateway_attestation.info as { tcb_info: string | { app_compose: string } };
    if (typeof info.tcb_info === "string") {
      const t = JSON.parse(info.tcb_info) as { app_compose: string };
      t.app_compose += " ";
      info.tcb_info = JSON.stringify(t);
    } else {
      info.tcb_info.app_compose += " ";
    }
    const v = await verifyAttestationReport(r, fixture.nonce, fixture.model, offline);
    expect(failed(v.gateway.checks)).toContain("MRCONFIGID binds app_compose");
  });

  it("fails when DCAP reports an unacceptable TCB status or NRAS rejects the GPU", async () => {
    const v = await verifyAttestationReport(clone(), fixture.nonce, fixture.model, {
      verifyQuote: async () => ({ status: "OutOfDate" }),
      verifyGpu: async () => ({ overall: false }),
    });
    expect(failed(v.gateway.checks)).toContain("Intel TDX quote verified (DCAP)");
    expect(failed(v.models[0]!.checks)).toContain("NVIDIA GPU attestation (NRAS)");
  });

  it("fails when the report carries no model attestation", async () => {
    const r = clone();
    delete r.model_attestations;
    const v = await verifyAttestationReport(r, fixture.nonce, fixture.model, offline);
    expect(v.ok).toBe(false);
  });
});

describe("withNetworkRetry", () => {
  it("retries transient DNS failures, then succeeds", async () => {
    let calls = 0;
    const result = await withNetworkRetry(async () => {
      if (++calls < 3) throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND pccs.phala.network") });
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retries a slow key download", async () => {
    let calls = 0;
    await withNetworkRetry(async () => {
      if (++calls < 2) throw new Error("Failed to parse the JSON Web Key Set HTTP response as JSON: The operation was aborted due to timeout");
    });
    expect(calls).toBe(2);
  });

  it("never retries a verdict error", async () => {
    let calls = 0;
    await expect(
      withNetworkRetry(async () => {
        calls++;
        throw new Error("signature mismatch");
      }),
    ).rejects.toThrow("signature mismatch");
    expect(calls).toBe(1);
  });
});

describe("RTMR3 replay", () => {
  const events = (): EventLogEntry[] => {
    const raw = fixture.report.model_attestations![0]!.event_log;
    return (typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw)) as EventLogEntry[];
  };

  it("rejects an event payload that no longer matches its recorded digest", () => {
    const log = events();
    const ev = log.find((e) => e.imr === 3)!;
    ev.digest = replayRtmr3([]).rtmr3.toString("hex");
    expect(replayRtmr3(log).ok).toBe(false);
  });

  it("fails the quote check when an event payload is altered (e.g. a different compose hash)", async () => {
    const r = clone();
    const log = events();
    const ev = log.find((e) => e.imr === 3 && e.event === "compose-hash")!;
    ev.event_payload = "00".repeat(32);
    r.model_attestations![0]!.event_log = log;
    const v = await verifyAttestationReport(r, fixture.nonce, fixture.model, offline);
    expect(failed(v.models[0]!.checks)).toContain("RTMR3 replays from event log");
  });

  it("fails the quote check when an imr3 event is dropped from the log", async () => {
    const r = clone();
    const log = events();
    log.splice(log.findIndex((e) => e.imr === 3), 1);
    r.model_attestations![0]!.event_log = log;
    const v = await verifyAttestationReport(r, fixture.nonce, fixture.model, offline);
    expect(failed(v.models[0]!.checks)).toContain("RTMR3 replays from event log");
  });
});
