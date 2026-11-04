import { x25519 } from "@noble/curves/ed25519.js";

/**
 * Seals a file to the Lab's key in the browser, so the plaintext never leaves this device
 * unencrypted. Same format as packages/shared/src/crypto.ts; a test decrypts this output there.
 */

const MAGIC = new TextEncoder().encode("RRN1");
const INFO = new TextEncoder().encode("rerun-private-data-v1");

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function sealForLab(plain: Uint8Array<ArrayBuffer>, labPublicKeyHex: string): Promise<Uint8Array<ArrayBuffer>> {
  const labPub = fromHex(labPublicKeyHex);
  const ephPriv = crypto.getRandomValues(new Uint8Array(32));
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, labPub);

  const salt = new Uint8Array(64);
  salt.set(ephPub, 0);
  salt.set(labPub, 32);
  const ikm = await crypto.subtle.importKey("raw", new Uint8Array(shared), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: INFO }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  // WebCrypto appends the 16-byte tag; the file format stores it before the ciphertext.
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);

  const out = new Uint8Array(4 + 32 + 12 + 16 + ciphertext.length);
  out.set(MAGIC, 0);
  out.set(ephPub, 4);
  out.set(nonce, 36);
  out.set(tag, 48);
  out.set(ciphertext, 64);
  return out;
}
