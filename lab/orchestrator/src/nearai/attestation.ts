import { createHash, randomBytes } from "node:crypto";
import { getCollateralAndVerify, PHALA_PCCS_URL, Quote, type TcbStatus } from "@phala/dcap-qvl";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Verification of NEAR AI Cloud attestation reports, following
 * https://docs.near.ai/cloud/verification (model attestations, quote/nonce/signer binding).
 *
 * For each quote (gateway and every model attestation) we check:
 *  1. Intel TDX quote signature + TCB status via DCAP (@phala/dcap-qvl), debug TDs rejected
 *  2. report_data == signing identity (zero-padded to 32 bytes) || our 32-byte nonce
 *  3. request_nonce echoes our nonce
 *  4. MRCONFIGID == 0x01 || sha256(app_compose) || 0x00 * 15
 *  5. RTMR3 replayed from the event log equals the quote's RTMR3
 *  6. NVIDIA GPU evidence (model only) attested by NRAS with a JWT verified against NVIDIA's JWKS
 */

export const NRAS_GPU_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
export const NRAS_JWKS_URL = "https://nras.attestation.nvidia.com/.well-known/jwks.json";

/** TCB statuses we accept. Anything else (OutOfDate, Revoked, ...) fails verification. */
export const ACCEPTED_TCB_STATUSES: readonly TcbStatus[] = ["UpToDate", "SWHardeningNeeded"];

export interface EventLogEntry {
  imr: number;
  event_type: number;
  digest: string;
  event: string;
  event_payload: string;
}

export interface DstackQuote {
  signing_address: string;
  signing_algo: string;
  intel_quote: string;
  event_log: string | EventLogEntry[];
  request_nonce: string;
  info: unknown;
  report_data?: string;
  model_name?: string;
  nvidia_payload?: string;
}

export interface AttestationReport {
  gateway_attestation: DstackQuote;
  model_attestations?: DstackQuote[];
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface QuoteVerification {
  role: "gateway" | "model";
  signingAddress: string;
  signingAlgo: string;
  tcbStatus?: string;
  composeHash?: string;
  checks: Check[];
  ok: boolean;
}

export interface ReportVerification {
  nonce: string;
  model: string;
  gateway: QuoteVerification;
  models: QuoteVerification[];
  ok: boolean;
  /** sha256 over the canonical summary; goes into receipts as nearai.attestation_digest */
  digest: string;
}

export function freshNonce(): string {
  return randomBytes(32).toString("hex");
}

export async function fetchAttestationReport(opts: {
  baseUrl: string;
  model: string;
  nonce: string;
  signingAlgo?: "ecdsa" | "ed25519";
  /** Ask for the report of the specific TEE node that signed a response. */
  signingAddress?: string;
  apiKey?: string;
}): Promise<AttestationReport> {
  const url = new URL("/v1/attestation/report", opts.baseUrl);
  url.searchParams.set("model", opts.model);
  url.searchParams.set("signing_algo", opts.signingAlgo ?? "ecdsa");
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("provider", "near");
  if (opts.signingAddress) url.searchParams.set("signing_address", opts.signingAddress);
  const headers: Record<string, string> = { accept: "application/json", "x-no-aliasing": "true" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`attestation report ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as AttestationReport;
}

export interface VerifyDeps {
  /** DCAP verification; injectable so tests can run offline. */
  verifyQuote?: (quote: Buffer) => Promise<{ status: string }>;
  /** NVIDIA GPU attestation; returns the overall result and nonce from the verified JWT. */
  verifyGpu?: (payload: unknown) => Promise<{ overall: boolean; nonce?: string }>;
}

export async function verifyAttestationReport(
  report: AttestationReport,
  nonce: string,
  model: string,
  deps: VerifyDeps = {},
): Promise<ReportVerification> {
  const gateway = await verifyQuote(report.gateway_attestation, nonce, "gateway", deps);
  const modelQuotes = report.model_attestations ?? [];
  // Sequential on purpose: parallel collateral/NRAS fetches proved flaky.
  const models: QuoteVerification[] = [];
  for (const q of modelQuotes) models.push(await verifyQuote(q, nonce, "model", deps));
  if (models.length === 0) {
    models.push({
      role: "model",
      signingAddress: "",
      signingAlgo: "",
      checks: [{ name: "model attestation present", ok: false, detail: `no model_attestations for ${model}` }],
      ok: false,
    });
  }
  for (const [i, q] of modelQuotes.entries()) {
    const nameOk = q.model_name === undefined || q.model_name === model;
    models[i]!.checks.push({ name: "model name matches", ok: nameOk, detail: q.model_name });
    models[i]!.ok &&= nameOk;
  }
  const ok = gateway.ok && models.every((m) => m.ok);
  const summary = {
    nonce,
    model,
    gateway: { addr: gateway.signingAddress, compose: gateway.composeHash, tcb: gateway.tcbStatus },
    models: models.map((m) => ({ addr: m.signingAddress, compose: m.composeHash, tcb: m.tcbStatus })),
    ok,
  };
  const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  return { nonce, model, gateway, models, ok, digest };
}

async function verifyQuote(
  q: DstackQuote,
  nonce: string,
  role: "gateway" | "model",
  deps: VerifyDeps,
): Promise<QuoteVerification> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const out: QuoteVerification = {
    role,
    signingAddress: q.signing_address,
    signingAlgo: q.signing_algo,
    checks,
    ok: false,
  };

  const quoteBytes = Buffer.from(strip0x(q.intel_quote), "hex");
  let td: ReturnType<typeof parseTd>;
  try {
    td = parseTd(quoteBytes);
  } catch (e) {
    add("quote parses as TDX", false, String(e));
    return out;
  }

  try {
    const verified = await (deps.verifyQuote ?? dcapVerify)(quoteBytes);
    out.tcbStatus = verified.status;
    add("Intel TDX quote verified (DCAP)", ACCEPTED_TCB_STATUSES.includes(verified.status as TcbStatus), verified.status);
  } catch (e) {
    add("Intel TDX quote verified (DCAP)", false, errMsg(e));
  }
  add("TD is not in debug mode", (td.tdAttributes[0]! & 1) === 0);

  const expectedReportData = Buffer.concat([padRight32(signingIdentity(q)), Buffer.from(nonce, "hex")]);
  add("report_data binds signing key + nonce", Buffer.from(td.reportData).equals(expectedReportData));
  if (q.report_data !== undefined) {
    add("report_data field matches quote", strip0x(q.report_data).toLowerCase() === Buffer.from(td.reportData).toString("hex"));
  }
  add("request_nonce echoes our nonce", q.request_nonce.toLowerCase() === nonce.toLowerCase());

  const appCompose = extractAppCompose(q.info);
  if (appCompose === undefined) {
    add("MRCONFIGID binds app_compose", false, "app_compose missing from info.tcb_info");
  } else {
    const composeHash = createHash("sha256").update(appCompose, "utf8").digest();
    out.composeHash = composeHash.toString("hex");
    const expected = Buffer.concat([Buffer.from([1]), composeHash, Buffer.alloc(15)]);
    add("MRCONFIGID binds app_compose", Buffer.from(td.mrConfigId).equals(expected), out.composeHash);
  }

  const events = typeof q.event_log === "string" ? (JSON.parse(q.event_log) as EventLogEntry[]) : q.event_log;
  const replay = replayRtmr3(events);
  add("RTMR3 replays from event log", replay.ok && replay.rtmr3.equals(Buffer.from(td.rtMr3)), replay.error);

  if (role === "model") {
    if (!q.nvidia_payload) {
      add("NVIDIA GPU attestation (NRAS)", false, "nvidia_payload missing");
    } else {
      const payload = JSON.parse(q.nvidia_payload) as { nonce?: string };
      add("GPU evidence nonce matches", String(payload.nonce).toLowerCase() === nonce.toLowerCase());
      try {
        const gpu = await (deps.verifyGpu ?? nrasVerify)(payload);
        add("NVIDIA GPU attestation (NRAS)", gpu.overall);
        if (gpu.nonce !== undefined) add("NRAS token nonce matches", gpu.nonce.toLowerCase() === nonce.toLowerCase());
      } catch (e) {
        add("NVIDIA GPU attestation (NRAS)", false, errMsg(e));
      }
    }
  }

  out.ok = checks.every((c) => c.ok);
  return out;
}

function parseTd(quoteBytes: Buffer) {
  const quote = Quote.parse(quoteBytes);
  const td = quote.report.asTd10() ?? quote.report.asTd15()?.base ?? quote.report.asTd15Ex()?.base.base;
  if (!td) throw new Error(`not a TDX quote (report type ${quote.report.type})`);
  return td;
}

async function dcapVerify(quote: Buffer): Promise<{ status: string }> {
  const verified = await getCollateralAndVerify(quote, process.env.PCCS_URL || PHALA_PCCS_URL);
  return { status: verified.status };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function nrasVerify(payload: unknown): Promise<{ overall: boolean; nonce?: string }> {
  const res = await fetch(NRAS_GPU_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`NRAS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as unknown[];
  const first = body[0];
  if (!Array.isArray(first) || first[0] !== "JWT" || typeof first[1] !== "string") {
    throw new Error("unexpected NRAS response shape");
  }
  jwks ??= createRemoteJWKSet(new URL(NRAS_JWKS_URL));
  const { payload: claims } = await jwtVerify(first[1], jwks);
  return {
    overall: claims["x-nvidia-overall-att-result"] === true,
    nonce: typeof claims.eat_nonce === "string" ? claims.eat_nonce : undefined,
  };
}

/** ECDSA identities are 20-byte addresses, Ed25519 identities 32-byte public keys. */
function signingIdentity(q: DstackQuote): Buffer {
  return Buffer.from(strip0x(q.signing_address), "hex");
}

function padRight32(b: Buffer): Buffer {
  if (b.length > 32) throw new Error("signing identity longer than 32 bytes");
  return Buffer.concat([b, Buffer.alloc(32 - b.length)]);
}

/** Returns the exact app_compose text; it is hashed as-is, never re-serialised. */
export function extractAppCompose(info: unknown): string | undefined {
  const infoObj = typeof info === "string" ? (JSON.parse(info) as Record<string, unknown>) : (info as Record<string, unknown>);
  const tcb = infoObj?.tcb_info;
  const tcbObj = typeof tcb === "string" ? (JSON.parse(tcb) as Record<string, unknown>) : (tcb as Record<string, unknown>);
  const compose = tcbObj?.app_compose;
  return typeof compose === "string" ? compose : undefined;
}

export function replayRtmr3(events: EventLogEntry[]): { ok: boolean; rtmr3: Buffer; error?: string } {
  let rtmr3 = Buffer.alloc(48);
  for (const ev of events) {
    if (ev.imr !== 3) continue;
    const type = Buffer.alloc(4);
    type.writeUInt32LE(ev.event_type >>> 0);
    const digest = createHash("sha384")
      .update(type)
      .update(":")
      .update(ev.event, "utf8")
      .update(":")
      .update(Buffer.from(ev.event_payload, "hex"))
      .digest();
    if (ev.digest && ev.digest.toLowerCase() !== digest.toString("hex")) {
      return { ok: false, rtmr3, error: `digest mismatch for event "${ev.event}"` };
    }
    rtmr3 = createHash("sha384").update(rtmr3).update(digest).digest();
  }
  return { ok: true, rtmr3 };
}

function strip0x(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

function errMsg(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause instanceof Error ? `: ${e.cause.message}` : e.cause ? `: ${String(e.cause)}` : "";
  return `${e.message}${cause}`;
}
