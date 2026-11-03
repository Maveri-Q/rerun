import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import type { ReportVerification } from "../src/nearai/attestation.ts";
import { verifyChatSignature } from "../src/nearai/signature.ts";

const modelKey = Wallet.createRandom();
const chat = { chatId: "chatcmpl-1", model: "z-ai/glm-5.3-flash", requestHash: "aa".repeat(32), responseHash: "bb".repeat(32) };
const text = `${chat.model}:${chat.requestHash}:${chat.responseHash}`;

function attestation(modelAddr: string, modelOk = true): ReportVerification {
  return {
    nonce: "00",
    model: chat.model,
    gateway: { role: "gateway", signingAddress: "0x1", signingAlgo: "ecdsa", checks: [], ok: true },
    models: [{ role: "model", signingAddress: modelAddr, signingAlgo: "ecdsa", checks: [], ok: modelOk }],
    ok: modelOk,
    digest: "",
  };
}

describe("verifyChatSignature", () => {
  it("accepts a provider_tee signature from an attested model key", async () => {
    const signature = await modelKey.signMessage(text);
    const sig = { text, signature, signing_address: modelKey.address, signing_algo: "ecdsa", signature_kind: "provider_tee" as const };
    expect(verifyChatSignature(chat, sig, attestation(modelKey.address)).ok).toBe(true);
  });

  it("rejects a signature over a different response", async () => {
    const other = `${chat.model}:${chat.requestHash}:${"cc".repeat(32)}`;
    const signature = await modelKey.signMessage(other);
    const sig = { text: other, signature, signing_address: modelKey.address, signing_algo: "ecdsa" };
    const v = verifyChatSignature(chat, sig, attestation(modelKey.address));
    expect(v.textMatches).toBe(false);
    expect(v.ok).toBe(false);
  });

  it("rejects a valid signature from a key that is not attested", async () => {
    const rogue = Wallet.createRandom();
    const signature = await rogue.signMessage(text);
    const sig = { text, signature, signing_address: rogue.address, signing_algo: "ecdsa" };
    const v = verifyChatSignature(chat, sig, attestation(modelKey.address));
    expect(v.signatureValid).toBe(true);
    expect(v.signerAttested).toBe(false);
  });

  it("rejects a signature whose claimed signer did not sign", async () => {
    const signature = await Wallet.createRandom().signMessage(text);
    const sig = { text, signature, signing_address: modelKey.address, signing_algo: "ecdsa" };
    expect(verifyChatSignature(chat, sig, attestation(modelKey.address)).signatureValid).toBe(false);
  });

  it("does not trust a key whose quote failed verification", async () => {
    const signature = await modelKey.signMessage(text);
    const sig = { text, signature, signing_address: modelKey.address, signing_algo: "ecdsa" };
    expect(verifyChatSignature(chat, sig, attestation(modelKey.address, false)).ok).toBe(false);
  });
});
