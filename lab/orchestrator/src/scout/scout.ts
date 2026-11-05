import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { draftClaim, parseGithubUrl, type ClaimDraft } from "../lab/draft.ts";
import { withNetworkRetry } from "../nearai/attestation.ts";
import type { PrivateModel } from "../pipeline/model.ts";
import { checkRepo, isClearNumber, type RepoFacts } from "./filters.ts";

/**
 * The scout agent (build plan §5.4). It looks for published research that ships code, checks it in
 * plain code, drafts a claim with the private AI, and queues it for a person. Nothing it finds ever
 * goes live by itself. It only reads metadata: it never downloads or runs anyone's code.
 */

export const SUGGESTED_BY = "Suggested by the scout agent.";

/** Limits on each scan and on AI spending. Each draft costs a fraction of a US cent. */
export const LIMITS = { checksPerScan: 8, draftsPerScan: 2, draftsPerDay: 6 };

export interface Lead {
  /** Stable across scans. */
  id: string;
  source: string;
  title: string;
  paperUrl: string;
  repoUrl: string | null;
}

export type CandidateStatus = "pending" | "rejected" | "retry" | "approved";

export interface Candidate extends Lead {
  status: CandidateStatus;
  reasons: string[];
  checkedAt: string;
  license?: string | null;
  runtime?: string | null;
  draft?: ClaimDraft;
  marketId?: number;
}

export interface ScoutState {
  lastScanAt: string | null;
  draftsByDay: Record<string, number>;
  candidates: Record<string, Candidate>;
}

export const emptyState = (): ScoutState => ({ lastScanAt: null, draftsByDay: {}, candidates: {} });

export interface ScoutDeps {
  leads: () => Promise<Lead[]>;
  repoFacts: (repoUrl: string) => Promise<RepoFacts>;
  draft: (lead: Lead) => Promise<ClaimDraft>;
  log?: (message: string) => void;
  now?: () => Date;
}

/** One scan. Returns the updated state; the caller saves it. */
export async function runScout(state: ScoutState, deps: ScoutDeps): Promise<ScoutState> {
  const now = deps.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const log = deps.log ?? (() => {});
  const next: ScoutState = { ...state, lastScanAt: now.toISOString(), candidates: { ...state.candidates }, draftsByDay: { [today]: state.draftsByDay[today] ?? 0 } };

  const leads = await deps.leads();
  const fresh = leads.filter((l) => {
    const seen = next.candidates[l.id];
    return !seen || seen.status === "retry";
  });
  log(`scout: ${leads.length} leads, ${fresh.length} not checked yet`);

  let draftsThisScan = 0;
  for (const lead of fresh.slice(0, LIMITS.checksPerScan)) {
    const record = (status: CandidateStatus, reasons: string[], extra: Partial<Candidate> = {}) => {
      next.candidates[lead.id] = { ...lead, status, reasons, checkedAt: now.toISOString(), ...extra };
      log(`scout: ${status} "${lead.title.slice(0, 70)}": ${reasons.join(" ")}`);
    };

    if (!lead.repoUrl || !parseGithubUrl(lead.repoUrl)) {
      record("rejected", ["It doesn't link to a GitHub repository, which the Lab needs."]);
      continue;
    }
    let facts: RepoFacts;
    try {
      facts = await deps.repoFacts(lead.repoUrl);
    } catch (e) {
      // GitHub limits how often it can be asked, or the network dropped. Neither says anything about the paper.
      record("retry", [`Couldn't read the repository yet: ${(e as Error).message.slice(0, 120)}`]);
      continue;
    }
    const checked = checkRepo(facts);
    if (!checked.accepted) {
      record("rejected", checked.reasons, { license: facts.license, runtime: checked.runtime });
      continue;
    }
    if (draftsThisScan >= LIMITS.draftsPerScan || (next.draftsByDay[today] ?? 0) >= LIMITS.draftsPerDay) {
      record("retry", ["Passed the checks, and waiting for the AI budget."], { license: facts.license, runtime: checked.runtime });
      continue;
    }
    draftsThisScan++;
    next.draftsByDay[today] = (next.draftsByDay[today] ?? 0) + 1;
    let draft: ClaimDraft;
    try {
      draft = await deps.draft(lead);
    } catch (e) {
      record("retry", [`The AI draft failed: ${(e as Error).message.slice(0, 120)}`], { license: facts.license, runtime: checked.runtime });
      continue;
    }
    if (!isClearNumber(draft.reported_value) || !draft.entrypoint.trim() || !draft.output_path.trim()) {
      record("rejected", [...checked.reasons, "The AI couldn't find one clear number to check, and how to produce it."], { license: facts.license, runtime: checked.runtime });
      continue;
    }
    record("pending", checked.reasons, { license: facts.license, runtime: checked.runtime, draft: withScoutNote(draft) });
  }
  return next;
}

function withScoutNote(draft: ClaimDraft): ClaimDraft {
  const room = 600 - SUGGESTED_BY.length - 1;
  return { ...draft, statement: `${draft.statement.slice(0, room).trim()} ${SUGGESTED_BY}` };
}

/** Pulls what the scout needs from one ReScience article.yaml. Only simple top-level fields, so no YAML library. */
export function parseArticleYaml(text: string): { title: string; repoUrl: string | null } {
  const title = /^title:\s*"?(.*?)"?\s*$/m.exec(text)?.[1] ?? "";
  const url = /^code:\s*\n(?:\s*#.*\n)*\s*-\s*url:\s*(\S+)/m.exec(text)?.[1] ?? null;
  return { title: title.replace(/\s+/g, " ").trim(), repoUrl: url ? repoRoot(url) : null };
}

/** `https://github.com/a/b/tree/main/code` and `.../releases/tag/v1` both mean the repository a/b. */
export function repoRoot(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/.exec(url.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

async function github<T>(apiPath: string): Promise<T> {
  const res = await withNetworkRetry(() => fetch(`https://api.github.com${apiPath}`, { headers: { accept: "application/vnd.github+json", "user-agent": "rerun-scout" } }));
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()) as T;
}

async function raw(url: string): Promise<string> {
  const res = await withNetworkRetry(() => fetch(url));
  return res.ok ? (await res.text()).slice(0, 20_000) : "";
}

/**
 * ReScience C: a peer-reviewed journal of replications, with a public list of every article. Newest
 * first, by Zenodo record number. The plan's other sources aren't connected yet.
 */
export async function reScienceLeads(limit: number): Promise<Lead[]> {
  const listing = await github<{ name: string }[]>("/repos/ReScience/articles/contents");
  const newest = listing
    .map((x) => x.name)
    .filter((n) => /^10\.5281_zenodo\.\d+$/.test(n))
    .sort((a, b) => Number(b.split(".").at(-1)) - Number(a.split(".").at(-1)))
    .slice(0, limit);
  const leads: Lead[] = [];
  for (const name of newest) {
    const yaml = await raw(`https://raw.githubusercontent.com/ReScience/articles/master/${name}/article.yaml`);
    const { title, repoUrl } = parseArticleYaml(yaml);
    if (title) leads.push({ id: `rescience:${name}`, source: "ReScience C", title, paperUrl: `https://doi.org/${name.replace("_", "/")}`, repoUrl });
  }
  return leads;
}

export async function githubRepoFacts(repoUrl: string): Promise<RepoFacts> {
  const { owner, repo } = parseGithubUrl(repoUrl)!;
  const meta = await github<{ default_branch: string; size: number; archived: boolean; license: { spdx_id?: string } | null }>(`/repos/${owner}/${repo}`);
  const languages = await github<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
  const tree = await github<{ tree: { path: string; type: string }[] }>(`/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
  const dependencyFiles = files.filter((f) => /(^|\/)(requirements[^/]*\.txt|environment[^/]*\.ya?ml|Pipfile|pyproject\.toml|DESCRIPTION)$/i.test(f)).slice(0, 4);
  const texts = await Promise.all(dependencyFiles.map((f) => raw(`https://raw.githubusercontent.com/${owner}/${repo}/${meta.default_branch}/${f}`)));
  return { license: meta.license?.spdx_id ?? null, languages, sizeKb: meta.size, archived: meta.archived, files, dependencyText: texts.join("\n") };
}

export function draftWithModel(model: PrivateModel) {
  return (lead: Lead) => draftClaim(lead.repoUrl!, lead.paperUrl, model);
}

/* Saved state */

const statePath = (dataDir: string) => path.join(dataDir, "scout", "state.json");

export function loadScoutState(dataDir: string): ScoutState {
  try {
    return { ...emptyState(), ...(JSON.parse(readFileSync(statePath(dataDir), "utf8")) as Partial<ScoutState>) };
  } catch {
    return emptyState();
  }
}

export function saveScoutState(dataDir: string, state: ScoutState): void {
  const file = statePath(dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${file}.tmp`, file);
}
