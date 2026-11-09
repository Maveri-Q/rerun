/**
 * Checks the attestation a Lab in a Phala Cloud CVM publishes at `/tee/attestation`, before the owner
 * registers it on NEAR and whenever anyone wants to check it again. It answers one question: is this
 * NEAR key held by this exact code, inside genuine Intel TDX hardware?
 */
import { createHash } from "node:crypto";
import type { TcbStatus } from "@phala/dcap-qvl";
import { ACCEPTED_TCB_STATUSES, dcapVerify, parseTd, replayRtmr3, type EventLogEntry } from "../nearai/attestation.ts";
import { reportData, type LabAttestation } from "./dstack.ts";

export interface LabCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface LabVerification {
  ok: boolean;
  checks: LabCheck[];
  /** sha256 of the attestation exactly as published, which is what goes on-chain. */
  fingerprint: string;
  composeHash: string;
  /** Every image the CVM runs, as its compose file names them. All must be pinned by digest. */
  images: string[];
}

/** The published attestation's fingerprint: sha256 of its JSON with keys in a fixed order. */
export function attestationFingerprint(att: LabAttestation): string {
  const ordered = Object.fromEntries(Object.keys(att).sort().map((k) => [k, (att as unknown as Record<string, unknown>)[k]]));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

/** The images named in the app compose (dstack wraps the docker compose file as `docker_compose_file`). */
export function composeImages(appCompose: string): string[] {
  let compose = appCompose;
  try {
    const parsed = JSON.parse(appCompose) as { docker_compose_file?: string };
    if (typeof parsed.docker_compose_file === "string") compose = parsed.docker_compose_file;
  } catch {
    // Plain compose YAML.
  }
  return [...compose.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)].map((m) => m[1]!);
}

export async function verifyLabAttestation(
  att: LabAttestation,
  expect: { labAccount?: string; composeHash?: string } = {},
  deps: { verifyQuote?: (quote: Buffer) => Promise<{ status: string }> } = {},
): Promise<LabVerification> {
  const checks: LabCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const out: LabVerification = { ok: false, checks, fingerprint: attestationFingerprint(att), composeHash: att.compose_hash, images: [] };

  if (expect.labAccount) add("for the expected Lab account", att.lab_account === expect.labAccount, att.lab_account);
  if (expect.composeHash) add("runs the expected code", att.compose_hash === expect.composeHash.replace(/^0x/, ""), att.compose_hash);

  const quote = Buffer.from(att.quote, "hex");
  let td: ReturnType<typeof parseTd>;
  try {
    td = parseTd(quote);
  } catch (e) {
    add("quote parses as Intel TDX", false, String(e));
    return out;
  }
  try {
    const verified = await (deps.verifyQuote ?? dcapVerify)(quote);
    add("Intel TDX quote verified (DCAP)", ACCEPTED_TCB_STATUSES.includes(verified.status as TcbStatus), verified.status);
  } catch (e) {
    add("Intel TDX quote verified (DCAP)", false, (e as Error).message);
  }
  add("not in debug mode", (td.tdAttributes[0]! & 1) === 0);

  const expected = reportData(att.lab_account, { nearPublicKey: att.near_public_key, encPublicKey: att.enc_public_key });
  add("quote binds the Lab account and both public keys", Buffer.from(td.reportData).subarray(0, 32).equals(expected));

  let events: EventLogEntry[] = [];
  try {
    events = JSON.parse(att.event_log) as EventLogEntry[];
  } catch {
    add("event log readable", false);
  }
  const replay = replayRtmr3(events);
  add("RTMR3 replays from the event log", replay.ok && replay.rtmr3.equals(Buffer.from(td.rtMr3)), replay.error);
  const composeEvent = events.find((e) => e.imr === 3 && e.event === "compose-hash");
  add("the measured boot names this compose hash", composeEvent?.event_payload?.toLowerCase() === att.compose_hash.toLowerCase(), composeEvent?.event_payload);

  if (!att.app_compose) {
    add("compose file published", false);
  } else {
    const hash = createHash("sha256").update(att.app_compose, "utf8").digest("hex");
    add("compose file matches its hash", hash === att.compose_hash, hash);
    out.images = composeImages(att.app_compose);
    const unpinned = out.images.filter((i) => !/@sha256:[0-9a-f]{64}$/.test(i));
    add("every image pinned by digest", out.images.length > 0 && unpinned.length === 0, unpinned.join(", ") || undefined);
  }

  out.ok = checks.every((c) => c.ok);
  return out;
}
