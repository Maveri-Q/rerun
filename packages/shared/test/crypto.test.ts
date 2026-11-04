import { describe, expect, it } from "vitest";
import { generateLabKeyPair, openSealed, sealToLab } from "../src/index.ts";

describe("private-data sealing", () => {
  const lab = generateLabKeyPair();
  const plain = Buffer.from("patient_id,readmitted\n1,0\n");

  it("round-trips through the Lab key and hides the plaintext", () => {
    const sealed = sealToLab(plain, lab.publicKey);
    expect(sealed.includes(plain)).toBe(false);
    expect(openSealed(sealed, lab.privateKey, lab.publicKey).equals(plain)).toBe(true);
  });

  it("uses a fresh ephemeral key each time", () => {
    expect(sealToLab(plain, lab.publicKey).equals(sealToLab(plain, lab.publicKey))).toBe(false);
  });

  it("cannot be opened with another key", () => {
    const other = generateLabKeyPair();
    expect(() => openSealed(sealToLab(plain, lab.publicKey), other.privateKey, other.publicKey)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealToLab(plain, lab.publicKey);
    sealed[sealed.length - 1]! ^= 1;
    expect(() => openSealed(sealed, lab.privateKey, lab.publicKey)).toThrow();
  });

  it("rejects files that are not sealed", () => {
    expect(() => openSealed(Buffer.alloc(100), lab.privateKey, lab.publicKey)).toThrow(/not a sealed/);
  });
});
