import { describe, expect, it } from "vitest";
import type { PrivateModel } from "../pipeline/model.ts";
import { factProblem, writeFact, type FactInput } from "./facts.ts";

const input: FactInput = {
  question: "Does the brain's wiring predict where Parkinson's spreads?",
  statement: "A model of brain wiring predicts protein spread in mice.",
  paperSays: "r 0.696",
  measured: "0.69605221",
  reported: "0.696",
  verdict: "Numbers check out",
  verdictReason: "Paper said 0.696. We got 0.69605221.",
  whoseCode: "Authors' own code",
  notChecked: ["Whether results in mice carry over to people."],
};

function modelReplying(...replies: object[]): PrivateModel & { calls: number } {
  return {
    modelId: "test-model",
    calls: 0,
    attest: async () => {},
    attestationDigest: () => "",
    signatureRefs: () => [],
    async ask() {
      return JSON.stringify(replies[Math.min(this.calls++, replies.length - 1)]);
    },
  };
}

const good = { summary: "The re-run got 0.69605221, close to the paper's 0.696.", background: "The study looked at mice.", result: "The same code gave the same number." };

describe("factProblem", () => {
  it("accepts numbers from the facts", () => expect(factProblem(good.summary, input)).toBeNull());
  it("rejects a number the facts don't contain", () => expect(factProblem("It was run on 1,200 mice.", input)).toMatch(/1200/));
  it("rejects banned words", () => expect(factProblem("This could unlock new therapies.", input)).toMatch(/unlock/));
});

describe("writeFact", () => {
  it("returns the entry and names the model", async () => {
    const entry = await writeFact(modelReplying(good), input);
    expect(entry.summary).toBe(good.summary);
    expect(entry.model).toBe("test-model");
  });

  it("asks again when the AI invents a number", async () => {
    const model = modelReplying({ ...good, background: "It used 1,200 mice." }, good);
    await writeFact(model, input);
    expect(model.calls).toBe(2);
  });

  it("gives up rather than publish an invented number", async () => {
    await expect(writeFact(modelReplying({ ...good, background: "It used 1,200 mice." }), input)).rejects.toThrow(/1200/);
  });
});
