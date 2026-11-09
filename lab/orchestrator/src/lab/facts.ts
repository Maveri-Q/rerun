import type { PrivateModel } from "../pipeline/model.ts";
import { parseJsonReply } from "../pipeline/guards.ts";

/**
 * Writes the plain-English entry for a checked claim on the Verified Facts page. The AI only writes
 * words about a result that is already final. The verdict and the numbers on the page come from the
 * chain, and any number in the text must already be in the facts it was given.
 */

export interface FactInput {
  question: string;
  statement: string;
  paperSays: string;
  measured: string;
  reported: string;
  verdict: string;
  verdictReason: string;
  whoseCode: string;
  notChecked: string[];
}

export interface FactEntry {
  summary: string;
  background: string;
  result: string;
  model: string;
  writtenAt: string;
}

const SYSTEM_PROMPT = `You write short encyclopedia entries about research results for a general reader. Use only the facts you are given. Don't add outside knowledge, names, dates or numbers. Don't change or soften the verdict, and don't say the study is true, proven or correct. A result that checks out only means the same code and data gave the same number.

Write plainly, like a good science journalist. Use everyday words and explain any technical term in the same sentence. Don't use hype.

Reply with one JSON object:
"summary": one sentence stating the question and the result.
"background": two or three sentences on what the study looked at and why it matters.
"result": two or three sentences on what was rerun and what came out, including what this doesn't show.`;

const FACT_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "fact_entry",
    strict: true,
    schema: {
      type: "object",
      properties: { summary: { type: "string" }, background: { type: "string" }, result: { type: "string" } },
      required: ["summary", "background", "result"],
      additionalProperties: false,
    },
  },
};

export const BANNED_WORDS = ["revolutionize", "revolutionise", "unlock", "seamless", "empower", "next-generation", "the future of", "harness the power", "cutting-edge", "game-changer", "leverage", "delve"];

/** Numbers of two digits or more, or with a decimal point. Small counts like "two" or "3" are harmless. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*|\.\d+/g) ?? []).filter((n) => n.length >= 2).map((n) => n.replace(/,/g, ""));
}

/** Why this text can't be published, or null if it can. */
export function factProblem(text: string, input: FactInput): string | null {
  const lower = text.toLowerCase();
  const banned = BANNED_WORDS.find((w) => lower.includes(w));
  if (banned) return `uses the banned word "${banned}"`;
  const known = numbersIn(JSON.stringify(input));
  const invented = numbersIn(text).find((n) => !known.includes(n));
  if (invented) return `states ${invented}, which isn't in the facts`;
  return null;
}

const MAX_TRIES = 3;

export async function writeFact(model: PrivateModel, input: FactInput): Promise<FactEntry> {
  let lastProblem = "";
  for (let i = 0; i < MAX_TRIES; i++) {
    const reply = await model.ask(
      "fact",
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) + (lastProblem ? `\n\nYour last answer ${lastProblem}. Write it again without that.` : "") },
      ],
      2000,
      FACT_FORMAT,
    );
    let d: Record<string, unknown>;
    try {
      d = parseJsonReply(reply) as Record<string, unknown>;
    } catch {
      lastProblem = "wasn't valid JSON";
      continue;
    }
    const [summary, background, result] = [d.summary, d.background, d.result].map((v) => (typeof v === "string" ? v.trim() : ""));
    if (!summary || !background || !result) {
      lastProblem = "left a field empty";
      continue;
    }
    const problem = factProblem([summary, background, result].join(" "), input);
    if (!problem) return { summary, background, result, model: model.modelId, writtenAt: new Date().toISOString() };
    lastProblem = problem;
  }
  throw new Error(`The AI's entry couldn't be used: it ${lastProblem}`);
}
