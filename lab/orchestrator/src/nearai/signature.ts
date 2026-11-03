import { verifyMessage } from "ethers";
import type { ChatResult } from "./client.ts";
import type { ReportVerification } from "./attestation.ts";

/**
 * Per-response signatures (https://docs.near.ai/cloud/verification/cloud-api/response-signatures).
 * The TEE signs "<model>:<request_hash>:<response_hash>" (provider_tee) or
 * "<request_hash>:<response_hash>" (gateway) with EIP-191 personal_sign.
 */

export interface SignatureRecord {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: "provider_tee" | "gateway";
}

export interface SignatureVerification {
  chatId: string;
  kind: "provider_tee" | "gateway";
  signingAddress: string;
  textMatches: boolean;
  signatureValid: boolean;
  signerAttested: boolean;
  ok: boolean;
}

export async function fetchSignature(opts: {
  baseUrl: string;
  apiKey: string;
  chatId: string;
  model: string;
  retries?: number;
}): Promise<SignatureRecord> {
  const url = new URL(`/v1/signature/${encodeURIComponent(opts.chatId)}`, opts.baseUrl);
  url.searchParams.set("model", opts.model);
  url.searchParams.set("signing_algo", "ecdsa");
  const retries = opts.retries ?? 5;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${opts.apiKey}`, accept: "application/json" } });
    if (res.status === 404 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const body = (await res.json()) as SignatureRecord & { error_code?: string; message?: string };
    if (!res.ok || body.error_code) {
      throw new Error(`signature ${res.status}: ${body.error_code ?? ""} ${body.message ?? ""}`.trim());
    }
    return body;
  }
}

export function verifyChatSignature(
  chat: Pick<ChatResult, "chatId" | "model" | "requestHash" | "responseHash">,
  sig: SignatureRecord,
  attestation: ReportVerification,
): SignatureVerification {
  if (sig.signing_algo !== "ecdsa") throw new Error(`unsupported signing_algo ${sig.signing_algo}`);
  const kind = sig.signature_kind ?? "provider_tee";
  const expectedText =
    kind === "provider_tee"
      ? `${chat.model}:${chat.requestHash}:${chat.responseHash}`
      : `${chat.requestHash}:${chat.responseHash}`;
  const textMatches = sig.text === expectedText;

  let signatureValid = false;
  try {
    signatureValid = verifyMessage(sig.text, sig.signature).toLowerCase() === sig.signing_address.toLowerCase();
  } catch {
    signatureValid = false;
  }

  // The signer must be a key we just saw bound to a verified TEE quote of the matching role.
  const attested =
    kind === "provider_tee"
      ? attestation.models.filter((m) => m.ok).map((m) => m.signingAddress)
      : attestation.gateway.ok
        ? [attestation.gateway.signingAddress]
        : [];
  const signerAttested = attested.some((a) => a.toLowerCase() === sig.signing_address.toLowerCase());

  return {
    chatId: chat.chatId,
    kind,
    signingAddress: sig.signing_address,
    textMatches,
    signatureValid,
    signerAttested,
    ok: textMatches && signatureValid && signerAttested,
  };
}
