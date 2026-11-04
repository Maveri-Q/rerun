import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

/**
 * Private-data encryption: a researcher seals a file to the attested Lab's X25519 key.
 * Format: "RRN1" | ephemeral public key (32) | nonce (12) | GCM tag (16) | ciphertext.
 * Key = HKDF-SHA256(ECDH shared secret, salt = ephemeral pub || lab pub).
 */

const MAGIC = Buffer.from("RRN1");
const INFO = Buffer.from("rerun-private-data-v1");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export interface X25519KeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateLabKeyPair(): X25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).subarray(SPKI_PREFIX.length).toString("hex"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).subarray(PKCS8_PREFIX.length).toString("hex"),
  };
}

const pub = (hex: string) =>
  createPublicKey({ key: Buffer.concat([SPKI_PREFIX, rawKey(hex)]), format: "der", type: "spki" });
const priv = (hex: string) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, rawKey(hex)]), format: "der", type: "pkcs8" });

function rawKey(hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("X25519 key must be 32 bytes of hex");
  return key;
}

function deriveKey(shared: Buffer, ephemeralPub: Buffer, labPub: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeralPub, labPub]), INFO, 32));
}

export function sealToLab(plain: Uint8Array, labPublicKeyHex: string): Buffer {
  const eph = generateLabKeyPair();
  const ephPub = rawKey(eph.publicKey);
  const labPub = rawKey(labPublicKeyHex);
  const key = deriveKey(diffieHellman({ privateKey: priv(eph.privateKey), publicKey: pub(labPublicKeyHex) }), ephPub, labPub);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, ephPub, nonce, cipher.getAuthTag(), ciphertext]);
}

/** Throws if the data was not sealed to this key or was altered. */
export function openSealed(sealed: Uint8Array, labPrivateKeyHex: string, labPublicKeyHex: string): Buffer {
  const buf = Buffer.from(sealed);
  if (buf.length < 64 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("not a sealed RERUN file");
  const ephPub = buf.subarray(4, 36);
  const nonce = buf.subarray(36, 48);
  const tag = buf.subarray(48, 64);
  const key = deriveKey(
    diffieHellman({ privateKey: priv(labPrivateKeyHex), publicKey: pub(ephPub.toString("hex")) }),
    ephPub,
    rawKey(labPublicKeyHex),
  );
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(64)), decipher.final()]);
}
