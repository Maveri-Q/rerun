import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { withNetworkRetry } from "./attestation.ts";

/**
 * The single wrapper every LLM call in the Lab goes through (build plan §0.7, §5.4):
 * per-call token cap, per-run call cap, daily USD cap, an append-only spend log,
 * and MOCK_LLM=1 for tests. It keeps the exact request and response bytes so the
 * NEAR AI response signature can be verified afterwards.
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  maxTokensPerCall: number;
  /** Cap for calls marked `long`, such as writing a whole analysis script. */
  maxTokensLongCall?: number;
  maxCallsPerRun: number;
  dailyUsdCap: number;
  mock: boolean;
  spendDir: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    baseUrl: env.NEARAI_CLOUD_BASE_URL || "https://cloud-api.near.ai",
    apiKey: env.NEARAI_CLOUD_API_KEY || undefined,
    maxTokensPerCall: Number(env.LLM_MAX_TOKENS_PER_CALL || 2000),
    maxTokensLongCall: Number(env.LLM_MAX_TOKENS_LONG_CALL || 8000),
    maxCallsPerRun: Number(env.LLM_MAX_CALLS_PER_RUN || 12),
    dailyUsdCap: Number(env.LLM_DAILY_USD_CAP || 1),
    mock: env.MOCK_LLM === "1",
    spendDir: env.LLM_SPEND_DIR || path.resolve(import.meta.dirname, "../../.spend"),
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  long?: boolean;
  /** Free-form tag for the spend log, e.g. "repair" or "report". */
  purpose: string;
}

export interface ChatResult {
  chatId: string;
  model: string;
  text: string;
  /** "stop", or "length" when max_tokens cut the answer (reasoning tokens count against it). */
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  costUsd: number;
  /** Exact bytes sent and received, needed for signature verification. */
  requestBody: string;
  responseBody: string;
  requestHash: string;
  responseHash: string;
  mock: boolean;
}

export class BudgetError extends Error {}

interface Pricing {
  prompt: number;
  completion: number;
}

export class LlmClient {
  private callsThisRun = 0;
  spentThisRun = 0;
  private pricing = new Map<string, Pricing>();

  /** `mockResponder` scripts MOCK_LLM replies, e.g. a demo claim's expected repair. */
  constructor(
    readonly config: LlmConfig,
    private readonly mockResponder?: (req: ChatRequest) => string | undefined,
  ) {}

  /** Start a new reproduction run; resets the per-run call counter. */
  newRun(): void {
    this.callsThisRun = 0;
    this.spentThisRun = 0;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (this.callsThisRun >= this.config.maxCallsPerRun) {
      throw new BudgetError(`max ${this.config.maxCallsPerRun} LLM calls per run reached`);
    }
    const cap = req.long ? (this.config.maxTokensLongCall ?? this.config.maxTokensPerCall * 2) : this.config.maxTokensPerCall;
    const maxTokens = Math.min(req.maxTokens ?? cap, cap);
    const spentToday = await this.spentToday();
    if (spentToday >= this.config.dailyUsdCap) {
      throw new BudgetError(`daily LLM cap $${this.config.dailyUsdCap} reached (spent $${spentToday.toFixed(4)})`);
    }
    this.callsThisRun++;

    const requestBody = JSON.stringify({
      model: req.model,
      messages: req.messages,
      max_tokens: maxTokens,
      stream: false,
      // Hidden thinking counts against max_tokens, and on real repositories it used the whole budget
      // and returned nothing. Only writing a whole program from a paper's methods needs it.
      chat_template_kwargs: { enable_thinking: req.purpose === "reimplement" },
    });

    const result = this.config.mock
      ? mockResponse(req, requestBody, this.mockResponder?.(req))
      : await this.send(req.model, requestBody);

    await this.logSpend(req, result);
    return result;
  }

  private async send(model: string, requestBody: string): Promise<ChatResult> {
    if (!this.config.apiKey) throw new Error("NEARAI_CLOUD_API_KEY is not set (or use MOCK_LLM=1)");
    const res = await withNetworkRetry(() =>
      fetch(new URL("/v1/chat/completions", this.config.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
          "accept-encoding": "identity",
        },
        body: requestBody,
      }),
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    const responseBody = bytes.toString("utf8");
    if (!res.ok) throw new Error(`chat completion ${res.status}: ${responseBody.slice(0, 300)}`);
    const json = JSON.parse(responseBody) as {
      id: string;
      choices: { message: { content: string | null }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number } | null;
      };
    };
    const usage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    const price = await this.priceOf(model);
    return {
      chatId: json.id,
      model,
      text: json.choices[0]?.message.content ?? "",
      finishReason: json.choices[0]?.finish_reason ?? "unknown",
      usage,
      costUsd: usage.promptTokens * price.prompt + usage.completionTokens * price.completion,
      requestBody,
      responseBody,
      requestHash: sha256Hex(requestBody),
      responseHash: sha256Hex(bytes),
      mock: false,
    };
  }

  /** USD per token, from the public /v1/models catalogue. */
  private async priceOf(model: string): Promise<Pricing> {
    if (this.pricing.size === 0) {
      const res = await withNetworkRetry(() => fetch(new URL("/v1/models", this.config.baseUrl)));
      if (res.ok) {
        const { data } = (await res.json()) as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
        for (const m of data) {
          this.pricing.set(m.id, { prompt: Number(m.pricing?.prompt ?? 0), completion: Number(m.pricing?.completion ?? 0) });
        }
      }
    }
    const price = this.pricing.get(model);
    // Unknown price: assume an expensive model so the daily cap still bites.
    return price ?? { prompt: 5e-6, completion: 2.5e-5 };
  }

  private spendFile(): string {
    return path.join(this.config.spendDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  }

  async spentToday(): Promise<number> {
    let text: string;
    try {
      text = await readFile(this.spendFile(), "utf8");
    } catch {
      return 0;
    }
    return text
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => sum + (JSON.parse(line) as { costUsd: number }).costUsd, 0);
  }

  private async logSpend(req: ChatRequest, r: ChatResult): Promise<void> {
    this.spentThisRun += r.costUsd;
    await mkdir(this.config.spendDir, { recursive: true });
    const entry = {
      at: new Date().toISOString(),
      purpose: req.purpose,
      model: r.model,
      chatId: r.chatId,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      costUsd: r.costUsd,
      mock: r.mock,
    };
    await appendFile(this.spendFile(), `${JSON.stringify(entry)}\n`);
  }
}

function mockResponse(req: ChatRequest, requestBody: string, scripted?: string): ChatResult {
  const last = req.messages.at(-1)?.content ?? "";
  const text = scripted ?? `MOCK(${req.purpose}): ${last.slice(0, 80)}`;
  const responseBody = JSON.stringify({ id: `mock-${sha256Hex(requestBody).slice(0, 16)}`, choices: [{ message: { content: text } }] });
  return {
    chatId: `mock-${sha256Hex(requestBody).slice(0, 16)}`,
    model: req.model,
    text,
    finishReason: "stop",
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
    costUsd: 0,
    requestBody,
    responseBody,
    requestHash: sha256Hex(requestBody),
    responseHash: sha256Hex(responseBody),
    mock: true,
  };
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
