/**
 * The Lab inside a Phala Cloud CVM (dstack). The CVM's guest agent answers on a Unix socket: it derives
 * keys that only this app, running this exact code, can get back, and it signs a hardware quote over data
 * we choose. The Lab's NEAR key and its private-data key are both derived here, so they never exist
 * outside the secure hardware, and the quote binds both public keys to the code that holds them.
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import { baseEncode } from "near-api-js";

export const DSTACK_SOCKETS = ["/var/run/dstack.sock", "/run/dstack.sock", "/var/run/tappd.sock"];
/** Changing this changes every derived key, so it is fixed for good. */
const KEY_PATH = "rerun/lab/v1";
export const REPORT_PREFIX = "rerun-lab-v1";

/** An http(s) URL (the dstack simulator) or a Unix socket path. */
export function dstackEndpoint(): string | null {
  if (process.env.DSTACK_SIMULATOR_ENDPOINT) return process.env.DSTACK_SIMULATOR_ENDPOINT;
  return DSTACK_SOCKETS.find((p) => existsSync(p)) ?? null;
}

export function rpc<T>(endpoint: string, path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const payload = JSON.stringify(body);
  const isUrl = /^https?:\/\//.test(endpoint);
  const url = isUrl ? new URL(path, endpoint) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...(url ? { hostname: url.hostname, port: url.port, path: url.pathname } : { socketPath: endpoint, path }),
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 300) return reject(new Error(`dstack ${path}: HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
          try {
            const parsed = JSON.parse(text) as T & { error?: string };
            if (parsed && typeof parsed === "object" && typeof parsed.error === "string") return reject(new Error(`dstack ${path}: ${parsed.error}`));
            resolve(parsed);
          } catch {
            reject(new Error(`dstack ${path}: unreadable answer: ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`dstack ${path}: no answer in ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    req.end(payload);
  });
}

const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");

function rawPublic(prefix: Buffer, seed: Buffer): Buffer {
  const key = createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" });
  return createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
}

export interface LabTeeKeys {
  /** NEAR's "ed25519:..." secret-key form, for the Lab account. */
  nearPrivateKey: string;
  nearPublicKey: string;
  /** X25519, hex, for private data sealed to the Lab. */
  encPublicKey: string;
  encPrivateKey: string;
}

/** Turns the app key from the guest agent into the Lab's keys. Separate labels keep the two keys unrelated. */
export function deriveLabKeys(appKey: Uint8Array): LabTeeKeys {
  const seed = (label: string) => createHash("sha256").update(appKey).update(`${REPORT_PREFIX}/${label}`).digest();
  const nearSeed = seed("near");
  const nearPub = rawPublic(ED25519_PKCS8, nearSeed);
  const encSeed = seed("x25519");
  return {
    nearPrivateKey: `ed25519:${baseEncode(Buffer.concat([nearSeed, nearPub]))}`,
    nearPublicKey: `ed25519:${baseEncode(nearPub)}`,
    encPublicKey: rawPublic(X25519_PKCS8, encSeed).toString("hex"),
    encPrivateKey: encSeed.toString("hex"),
  };
}

/** What the quote's report data commits to: this Lab account, holding these two keys. */
export function reportData(labAccount: string, keys: Pick<LabTeeKeys, "nearPublicKey" | "encPublicKey">): Buffer {
  return createHash("sha256").update(`${REPORT_PREFIX}|${labAccount}|${keys.nearPublicKey}|${keys.encPublicKey}`).digest();
}

export interface TeeInfo {
  app_id: string;
  compose_hash: string;
  instance_id?: string;
  app_compose?: string;
}

export interface LabAttestation {
  lab_account: string;
  near_public_key: string;
  enc_public_key: string;
  /** sha256 hex of the report data the quote carries in its first 32 bytes. */
  report_data: string;
  compose_hash: string;
  app_id: string;
  quote: string;
  event_log: string;
  vm_config?: string;
  app_compose?: string;
}

/** Everything the Lab needs from the secure hardware at start-up. */
export async function teeIdentity(endpoint: string, labAccount: string): Promise<{ keys: LabTeeKeys; attestation: LabAttestation }> {
  const { key } = await rpc<{ key: string }>(endpoint, "/GetKey", { path: KEY_PATH, purpose: "rerun-lab", algorithm: "secp256k1" });
  const keys = deriveLabKeys(Buffer.from(key.replace(/^0x/, ""), "hex"));
  const info = await rpc<TeeInfo>(endpoint, "/Info", {});
  const data = reportData(labAccount, keys);
  const quote = await rpc<{ quote: string; event_log: string; vm_config?: string }>(endpoint, "/GetQuote", { report_data: data.toString("hex") });
  return {
    keys,
    attestation: {
      lab_account: labAccount,
      near_public_key: keys.nearPublicKey,
      enc_public_key: keys.encPublicKey,
      report_data: data.toString("hex"),
      compose_hash: info.compose_hash.replace(/^0x/, ""),
      app_id: info.app_id.replace(/^0x/, ""),
      quote: quote.quote.replace(/^0x/, ""),
      event_log: quote.event_log,
      vm_config: quote.vm_config,
      app_compose: info.app_compose,
    },
  };
}
