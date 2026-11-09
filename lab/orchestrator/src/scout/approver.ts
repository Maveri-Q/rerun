import { ClaimSpec } from "@rerun/shared";
import { parseJsonReply } from "../pipeline/guards.ts";
import type { PrivateModel } from "../pipeline/model.ts";
import { sameNumber } from "./paper.ts";
import type { Candidate, ScoutState } from "./scout.ts";

/**
 * The safe approver. It may open a claim by itself only when every check passes, under its own limited
 * account and never the owner's. A claim it approves stays a draft for 6 hours, so a person can cancel
 * it before anyone can forecast. Anything unclear stays in the person's review queue. The AI's number
 * and margin only choose what gets tested: verdicts still come from the deterministic comparator.
 */

export const AUTO_LIMITS = { perDay: 3, waitSecs: 6 * 3600, forecastDays: 7, challengeSecs: 24 * 3600, liquidity: 40_000_000n };

/** Places that publish replications, or papers peer review and citations have already looked at. */
const TRUSTED_SOURCES = new Set(["ReScience C", "Replication code on GitHub"]);
const MIN_TRUSTED_CITATIONS = 20;

export type DecisionResult = "approved" | "sent_to_you" | "rejected";

export interface Decision {
  at: string;
  id: string;
  title: string;
  result: DecisionResult;
  why: string;
}

export interface Check {
  name: string;
  passed: boolean;
  why: string;
}

/** Each condition for approving without a person. Margin agreement is checked separately, since it costs an AI call. */
export function checksFor(c: Candidate): Check[] {
  const citations = c.attention?.source === "OpenAlex" ? c.attention.value : 0;
  const trusted = TRUSTED_SOURCES.has(c.source) && (c.source === "ReScience C" || citations >= MIN_TRUSTED_CITATIONS);
  const paperCheck = c.reasons.find((r) => r.includes("appears near this wording in the paper"));
  return [
    { name: "Trusted source", passed: trusted, why: trusted ? `From ${c.source}.` : `${c.source} isn't on the trusted list, or the paper has too few citations.` },
    { name: "Reuse licence", passed: c.reasons.some((r) => r.startsWith("Open licence:")), why: c.license ? `Licence: ${c.license}.` : "No licence that clearly allows reuse." },
    {
      name: "Number near the wording, and a second AI agrees",
      passed: Boolean(paperCheck?.includes("a second AI on a different model picked it too")),
      why: paperCheck ? "The number is in the paper near the claim's wording, and a second AI picked it too." : "The number wasn't confirmed in the paper.",
    },
    { name: "Small CPU-only Python or R code", passed: c.status === "pending" && (c.runtime?.startsWith("python") === true || c.runtime === "r"), why: `Runs on ${c.runtime ?? "an unknown language"}.` },
    { name: "Has a draft", passed: Boolean(c.draft), why: c.draft ? "The claim is drafted." : "There's no draft." },
  ];
}

const MARGIN_FORMAT = {
  type: "json_schema",
  json_schema: { name: "margin_pick", strict: true, schema: { type: "object", properties: { margin: { type: "string" } }, required: ["margin"], additionalProperties: false } },
};

/** Asks one AI how close a rerun must get. Each model answers alone, and never sees the other's answer. */
export function marginWithModel(model: PrivateModel) {
  return async (draft: NonNullable<Candidate["draft"]>): Promise<string> => {
    const reply = await model.ask(
      "second_pick",
      [
        {
          role: "system",
          content:
            'A paper reports one number. Say how close a rerun must get for it to count as the same result, allowing only for the rounding in how the number is printed. Reply with one JSON object and nothing else: {"margin": "..."}, as a plain decimal such as "0.05".',
        },
        { role: "user", content: `The quantity: ${draft.metric_name}\nThe printed number: ${draft.reported_value}` },
      ],
      3000,
      MARGIN_FORMAT,
    );
    const margin = (parseJsonReply(reply) as { margin?: unknown }).margin;
    return typeof margin === "string" ? margin.trim() : "";
  };
}

export function specFromDraft(c: Candidate, margin: string) {
  const d = c.draft!;
  return ClaimSpec.parse({
    version: 1,
    title: (d.question || d.title).slice(0, 120),
    statement: d.statement,
    source: { type: "paper", url: c.paperUrl, license: c.license ?? d.license, authors: d.authors || "See the paper" },
    artifact: {
      repo_url: d.repo_url,
      commit: d.commit,
      data: [],
      runtime: d.runtime,
      setup: d.setup,
      entrypoint: d.entrypoint,
      output: { path: d.output_path, extractor: { type: d.extractor_type, expr: d.extractor_expr } },
    },
    metric: { name: d.metric_name || "reported result", reported_value: d.reported_value, tolerance: { type: "abs", value: margin }, comparison: "within_tolerance" },
    resources: { cpu: 2, mem_gb: 4, max_minutes: 15 },
    private_data: null,
  });
}

export interface ApproverDeps {
  /** Two different models, each proposing a margin alone. */
  firstMargin: (draft: NonNullable<Candidate["draft"]>) => Promise<string>;
  secondMargin: (draft: NonNullable<Candidate["draft"]>) => Promise<string>;
  /** Saves the claim as a draft from the approver's own account. Nobody can forecast on a draft. */
  createDraft: (c: Candidate, margin: string, lockTime: number) => Promise<number>;
  /** Opens a draft for forecasts, once its wait is over. */
  open: (marketId: number) => Promise<void>;
  /** False once a person has cancelled the draft on the blockchain. */
  stillDraft: (marketId: number) => Promise<boolean>;
  now?: () => Date;
  log?: (message: string) => void;
}

/** One pass: opens any draft whose wait is over, then looks at the review queue. The caller saves the result. */
export async function runApprover(state: ScoutState, deps: ApproverDeps): Promise<ScoutState> {
  const now = deps.now?.() ?? new Date();
  const nowSecs = Math.floor(now.getTime() / 1000);
  const today = now.toISOString().slice(0, 10);
  const next: ScoutState = { ...state, candidates: { ...state.candidates }, decisions: [...(state.decisions ?? [])], autoByDay: { [today]: state.autoByDay?.[today] ?? 0 } };
  const decide = (c: Candidate, result: DecisionResult, why: string) => {
    next.decisions!.push({ at: now.toISOString(), id: c.id, title: c.draft?.question || c.title, result, why });
    deps.log?.(`approver: ${result} "${c.title.slice(0, 60)}": ${why}`);
  };

  for (const c of Object.values(next.candidates)) {
    if (c.status !== "waiting" || c.opensAt === undefined || c.marketId === undefined || c.opensAt > nowSecs) continue;
    if (await deps.stillDraft(c.marketId)) {
      await deps.open(c.marketId);
      next.candidates[c.id] = { ...c, status: "approved" };
      decide(c, "approved", `The 6-hour wait ended with no cancellation, so claim ${c.marketId} is open for forecasts.`);
    } else {
      next.candidates[c.id] = { ...c, status: "pending", opensAt: undefined, marketId: undefined, autoReviewed: true };
      decide(c, "sent_to_you", `Claim ${c.marketId} was cancelled during its wait, so it's back in your review queue.`);
    }
  }

  const queue = Object.values(next.candidates)
    .filter((c) => c.status === "pending" && !c.autoReviewed)
    .sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0));
  for (const c of queue) {
    const send = (why: string) => {
      next.candidates[c.id] = { ...next.candidates[c.id]!, autoReviewed: true };
      decide(c, "sent_to_you", why);
    };
    const failed = checksFor(c).filter((check) => !check.passed);
    if (failed.length > 0) {
      send(failed.map((f) => `${f.name}: ${f.why}`).join(" "));
      continue;
    }
    // Over the daily limit it just waits its turn, unmarked, so it's looked at again tomorrow.
    if ((next.autoByDay![today] ?? 0) >= AUTO_LIMITS.perDay) continue;
    let first: string;
    let second: string;
    try {
      first = await deps.firstMargin(c.draft!);
      second = await deps.secondMargin(c.draft!);
    } catch (e) {
      send(`An AI couldn't suggest a margin: ${(e as Error).message.slice(0, 100)}`);
      continue;
    }
    if (!first || !second || !sameNumber(first, second)) {
      send(`The two AIs disagreed on the margin: ${first || "none"} and ${second || "none"}.`);
      continue;
    }
    let spec: ReturnType<typeof specFromDraft>;
    try {
      spec = specFromDraft(c, first);
    } catch (e) {
      send(`The draft isn't a valid claim: ${(e as Error).message.slice(0, 100)}`);
      continue;
    }
    const opensAt = nowSecs + AUTO_LIMITS.waitSecs;
    const marketId = await deps.createDraft(c, first, opensAt + AUTO_LIMITS.forecastDays * 86_400);
    next.autoByDay![today] = (next.autoByDay![today] ?? 0) + 1;
    next.candidates[c.id] = { ...c, status: "waiting", marketId, opensAt, autoReviewed: true, autoMargin: first };
    decide(c, "approved", `Every check passed, with a margin of ${first}. Claim ${marketId} ("${spec.title}") opens in 6 hours unless you cancel it.`);
  }
  next.decisions = next.decisions!.slice(-200);
  return next;
}
