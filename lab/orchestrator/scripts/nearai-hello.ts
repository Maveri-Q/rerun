/**
 * NEAR AI Cloud hello-world with verification (build step 1).
 *
 *   pnpm nearai:hello
 *
 * 1. Confirms the configured model is a NEAR-hosted private TEE model.
 * 2. Sends one tiny chat completion through the capped LLM wrapper (skipped without an API key).
 * 3. Fetches the response signature, then the attestation report of the node that signed it,
 *    with a fresh nonce.
 * 4. Verifies the Intel TDX quotes, NVIDIA GPU evidence, nonce/key binding, and the signature.
 */
import { loadEnv } from "../src/env.ts";
import {
  fetchAttestationReport,
  freshNonce,
  verifyAttestationReport,
  type QuoteVerification,
} from "../src/nearai/attestation.ts";
import { LlmClient, llmConfigFromEnv, type ChatResult } from "../src/nearai/client.ts";
import { fetchSignature, verifyChatSignature } from "../src/nearai/signature.ts";

loadEnv();
const config = llmConfigFromEnv();
const model = process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash";

const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");

function printQuote(label: string, q: QuoteVerification) {
  console.log(`\n${label}  signer ${q.signingAddress}  tcb ${q.tcbStatus ?? "?"}  ${mark(q.ok)}`);
  for (const c of q.checks) console.log(`  [${mark(c.ok)}] ${c.name}${c.detail && !c.ok ? `  (${c.detail})` : ""}`);
}

async function main() {
  console.log(`NEAR AI Cloud: ${config.baseUrl}  model: ${model}`);

  const res = await fetch(new URL("/v1/models", config.baseUrl));
  const { data } = (await res.json()) as { data: { id: string; owned_by: string }[] };
  const entry = data.find((m) => m.id === model);
  const isPrivate = entry?.owned_by === "nearai";
  console.log(`[${mark(isPrivate)}] model is NEAR-hosted private TEE model (owned_by=${entry?.owned_by ?? "not listed"})`);
  if (!isPrivate) process.exitCode = 1;

  let chat: ChatResult | undefined;
  let signer: string | undefined;
  let sig: Awaited<ReturnType<typeof fetchSignature>> | undefined;
  if (config.apiKey && !config.mock) {
    const llm = new LlmClient(config);
    chat = await llm.chat({
      model,
      purpose: "hello",
      maxTokens: 200,
      messages: [{ role: "user", content: "In one sentence: why does reproducing published research matter?" }],
    });
    console.log(`\nchat ${chat.chatId}  ${chat.usage.promptTokens}+${chat.usage.completionTokens} tokens  $${chat.costUsd.toFixed(6)}`);
    console.log(`> ${chat.text.trim()}`);
    sig = await fetchSignature({ baseUrl: config.baseUrl, apiKey: config.apiKey, chatId: chat.chatId, model });
    signer = sig.signing_address;
    console.log(`signature kind ${sig.signature_kind ?? "(unspecified)"}  signer ${signer}`);
  } else {
    console.log("\nNo NEARAI_CLOUD_API_KEY in .env: skipping the chat + signature part, verifying attestation only.");
  }

  const nonce = freshNonce();
  const report = await fetchAttestationReport({
    baseUrl: config.baseUrl,
    model,
    nonce,
    signingAddress: sig?.signature_kind === "gateway" ? undefined : signer,
  });
  const verification = await verifyAttestationReport(report, nonce, model);
  printQuote("Gateway TEE", verification.gateway);
  verification.models.forEach((m, i) => printQuote(`Model TEE #${i + 1}`, m));

  if (chat && sig) {
    const s = verifyChatSignature(chat, sig, verification);
    console.log(`\nResponse signature (${s.kind})  ${mark(s.ok)}`);
    console.log(`  [${mark(s.textMatches)}] signed text = ${s.kind === "provider_tee" ? "model:" : ""}sha256(request):sha256(response)`);
    console.log(`  [${mark(s.signatureValid)}] ECDSA signature recovers to ${s.signingAddress}`);
    console.log(`  [${mark(s.signerAttested)}] signer is bound to a verified TEE quote`);
    if (!s.ok) process.exitCode = 1;
  }

  console.log(`\nattestation digest ${verification.digest}`);
  console.log(`OVERALL ${mark(verification.ok && process.exitCode !== 1)}`);
  if (!verification.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
