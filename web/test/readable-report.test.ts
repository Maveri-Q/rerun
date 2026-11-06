import { describe, expect, it } from "vitest";
import { readableReport } from "../lib/market";

const label = "AI-written report (model). The outcome was decided by deterministic code, not by this text.";

describe("readableReport", () => {
  it("leaves a clean write-up alone", () => {
    const stored = `${label}\n\nWe ran it. It matched.\n\nEvidence file sha256: abc\n`;
    expect(readableReport(stored)).toEqual({ text: stored, trimmed: false });
  });

  it("drops working notes, including a marker inside the last paragraph", () => {
    const stored = `${label}\n\nThe user wants a short report.\n\nFacts: it ran.\n\nWrite plainly.</think>We ran it. It matched.\n\nEvidence file sha256: abc\n`;
    expect(readableReport(stored)).toEqual({ text: `${label}\n\nWe ran it. It matched.`, trimmed: true });
  });

  it("drops the quotes around a final draft", () => {
    const stored = `${label}\n\nThe user wants a short report.\n\n"We ran it."\n\nEvidence file sha256: abc\n`;
    expect(readableReport(stored).text).toBe(`${label}\n\nWe ran it.`);
  });
});
