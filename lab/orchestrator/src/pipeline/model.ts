import { createHash } from "node:crypto";
import { fetchAttestationReport, freshNonce, verifyAttestationReport, type ReportVerification } from "../nearai/attestation.ts";
import type { ChatMessage, LlmClient } from "../nearai/client.ts";
import { fetchSignature, verifyChatSignature } from "../nearai/signature.ts";

/**
 * The Lab's private model: every reply must carry a valid signature from a key bound to a
 * verified TEE quote before the pipeline may use it. The digest and signature references
 * end up in the receipt.
 */

export interface PrivateModel {
  readonly modelId: string;
  /** Throws if the model's TEE cannot be verified. */
  attest(): Promise<void>;
  ask(purpose: string, messages: ChatMessage[], maxTokens?: number): Promise<string>;
  /** Digest of the attestation report(s) verified during this run. */
  attestationDigest(): string;
  signatureRefs(): string[];
  /** What this run has spent so far, where the model can say. */
  spentThisRun?(): number;
}

export class ModelVerificationError extends Error {}

/**
 * The AI never gave a usable answer, so no repair was really tried. That says nothing about the
 * research, so it must not become a BROKEN verdict: the run stops and posts nothing.
 */
export class ModelUnavailableError extends Error {}

/** The internet failed while installing packages. Like above, this says nothing about the research. */
export class NetworkUnavailableError extends Error {}

const MAX_SIGNATURE_REFS = 16;

export class NearAiModel implements PrivateModel {
  private readonly refs: string[] = [];
  private readonly digests: string[] = [];
  private readonly verified = new Map<string, ReportVerification>();

  constructor(
    private readonly llm: LlmClient,
    readonly modelId: string,
  ) {}

  /** Fails fast if the model's TEE cannot be attested. Call before the run does any work. */
  async attest(): Promise<void> {
    if (this.llm.config.mock) return;
    await this.report(undefined);
  }

  private async report(signer: string | undefined): Promise<ReportVerification> {
    const key = signer?.toLowerCase() ?? "";
    const cached = this.verified.get(key);
    if (cached) return cached;
    const nonce = freshNonce();
    const report = await fetchAttestationReport({ baseUrl: this.llm.config.baseUrl, model: this.modelId, nonce, signingAddress: signer });
    const verification = await verifyAttestationReport(report, nonce, this.modelId);
    if (!verification.ok) {
      const failed = [verification.gateway, ...verification.models].flatMap((q) => q.checks.filter((c) => !c.ok).map((c) => (c.detail ? `${c.name} (${c.detail})` : c.name)));
      throw new ModelVerificationError(`attestation failed for ${this.modelId}: ${failed.join("; ")}`);
    }
    this.verified.set(key, verification);
    this.digests.push(verification.digest);
    return verification;
  }

  spentThisRun(): number {
    return this.llm.spentThisRun;
  }

  async ask(purpose: string, messages: ChatMessage[], maxTokens?: number): Promise<string> {
    const chat = await this.llm.chat({ model: this.modelId, purpose, messages, maxTokens, long: true });
    if (chat.mock) {
      this.addRef(chat.chatId);
      return chat.text;
    }
    const apiKey = this.llm.config.apiKey!;
    const sig = await fetchSignature({ baseUrl: this.llm.config.baseUrl, apiKey, chatId: chat.chatId, model: this.modelId });
    const attestation = await this.report(sig.signature_kind === "gateway" ? undefined : sig.signing_address);
    const check = verifyChatSignature(chat, sig, attestation);
    if (!check.ok) throw new ModelVerificationError(`response ${chat.chatId} failed signature verification`);
    this.addRef(chat.chatId);
    return chat.text;
  }

  private addRef(id: string): void {
    if (this.refs.length < MAX_SIGNATURE_REFS) this.refs.push(id);
  }

  /** Everything verified during this run, for the Lab's public attestation record. */
  attestationRecord(): { mock: boolean; model: string; reports: ReportVerification[] } {
    return { mock: this.llm.config.mock, model: this.modelId, reports: [...this.verified.values()] };
  }

  attestationDigest(): string {
    const input = this.llm.config.mock ? `MOCK_LLM:${this.modelId}` : this.digests.join(":");
    return createHash("sha256").update(input).digest("hex");
  }

  signatureRefs(): string[] {
    return [...this.refs];
  }
}
