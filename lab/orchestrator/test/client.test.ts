import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetError, LlmClient, type LlmConfig } from "../src/nearai/client.ts";

function mockConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    baseUrl: "https://cloud-api.near.ai",
    maxTokensPerCall: 500,
    maxCallsPerRun: 2,
    dailyUsdCap: 1,
    mock: true,
    spendDir: mkdtempSync(path.join(tmpdir(), "rerun-spend-")),
    ...overrides,
  };
}

const req = { model: "z-ai/glm-5.3-flash", purpose: "test", messages: [{ role: "user" as const, content: "hi" }] };

describe("LlmClient (MOCK_LLM)", () => {
  it("never exceeds the per-call token cap", async () => {
    const llm = new LlmClient(mockConfig());
    const r = await llm.chat({ ...req, maxTokens: 10_000 });
    expect(JSON.parse(r.requestBody).max_tokens).toBe(500);
    expect(r.mock).toBe(true);
  });

  it("enforces the per-run call cap and resets on a new run", async () => {
    const llm = new LlmClient(mockConfig());
    await llm.chat(req);
    await llm.chat(req);
    await expect(llm.chat(req)).rejects.toBeInstanceOf(BudgetError);
    llm.newRun();
    await expect(llm.chat(req)).resolves.toBeDefined();
  });

  it("writes every call to the spend log", async () => {
    const config = mockConfig();
    const llm = new LlmClient(config);
    await llm.chat(req);
    const [file] = readdirSync(config.spendDir);
    const entry = JSON.parse(readFileSync(path.join(config.spendDir, file!), "utf8").trim());
    expect(entry).toMatchObject({ purpose: "test", model: req.model, costUsd: 0, mock: true });
  });

  it("refuses calls once the daily cap is spent", async () => {
    const llm = new LlmClient(mockConfig({ dailyUsdCap: 0 }));
    await expect(llm.chat(req)).rejects.toThrow(/daily LLM cap/);
  });
});
