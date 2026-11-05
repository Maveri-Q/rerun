import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { draftClaim, parseGithubUrl, type ClaimDraft } from "../lab/draft.ts";
import { withNetworkRetry } from "../nearai/attestation.ts";
import type { PrivateModel } from "../pipeline/model.ts";
import { checkRepo, hasDataInRepo, isClearNumber, type RepoFacts } from "./filters.ts";

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
  /** A journal of replications comes with its data. A preprint might not, so check. */
  needsDataCheck?: boolean;
  doi?: string;
  /** A source's own measure of interest, such as Hugging Face upvotes. */
  upvotes?: number;
  abstract?: string;
}

/** How much attention a paper has had, where a free source can say. */
export interface Attention {
  source: string;
  /** Plain words for the review page, such as "302 citations". */
  label: string;
  /** Comparable across papers, 0 and up. */
  value: number;
}

/** Below this, the scout doesn't suggest a paper at all. */
export const MIN_RELATABILITY = 4;
const PREFERRED_TOPICS = new Set(["health", "food", "economics", "ai", "climate", "everyday life"]);

/** The order of the review queue: mostly how much people would care, then topic, then attention. */
export function interestScore(relatability: number, topic: string, attention?: Attention): number {
  const fromAttention = attention ? Math.min(Math.log10(1 + attention.value) * 5, 20) : 0;
  return Math.round(relatability * 10 + (PREFERRED_TOPICS.has(topic) ? 5 : 0) + fromAttention);
}

const TOPIC_WORDS = /\b(health|disease|cancer|diabet|parkinson|alzheimer|heart|covid|vaccin|drug|patient|sleep|diet|food|nutrition|obes|wage|price|inflation|income|employ|econom|market|tax|poverty|climate|wildfire|weather|emission|pollution|chatbot|language model|gpt|llm|school|student|phone|social media|gender|housing|traffic)/i;

/** A cheap first look at the title, so the small AI budget goes to the likeliest papers first. */
export function titleInterest(lead: Pick<Lead, "title" | "upvotes">): number {
  return (TOPIC_WORDS.test(lead.title) ? 100 : 0) + Math.min(lead.upvotes ?? 0, 50);
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
  attention?: Attention;
  /** Sorts the review queue, highest first. */
  interest?: number;
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
  /** Optional, and never required: a paper with no attention data can still rank highly. */
  attention?: (lead: Lead) => Promise<Attention | undefined>;
  log?: (message: string) => void;
  now?: () => Date;
}

/** One scan. Returns the updated state; the caller saves it. */
export async function runScout(state: ScoutState, deps: ScoutDeps): Promise<ScoutState> {
  const now = deps.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const log = deps.log ?? (() => {});
  const next: ScoutState = { ...state, lastScanAt: now.toISOString(), candidates: { ...state.candidates }, draftsByDay: { [today]: state.draftsByDay[today] ?? 0 } };

  const found = await deps.leads();
  const suggested = Object.values(next.candidates).filter((c) => c.id.startsWith("suggested:") && c.status === "retry");
  const leads = [...suggested, ...found];
  // ReScience publishes one project as many articles, so a repository only counts once.
  const reposSeen = new Set(Object.values(next.candidates).filter((c) => c.status !== "retry").map((c) => c.repoUrl));
  const fresh = leads.filter((l) => {
    const seen = next.candidates[l.id];
    if (seen && seen.status !== "retry") return false;
    if (l.repoUrl && reposSeen.has(l.repoUrl)) return false;
    if (l.repoUrl) reposSeen.add(l.repoUrl);
    return true;
  });
  // Papers already through the checks go first, so they aren't checked again and again.
  const waiting = (l: Lead) => (l.id.startsWith("suggested:") ? 2000 : next.candidates[l.id]?.reasons.some((r) => r.startsWith("Passed the checks")) ? 1000 : 0);
  fresh.sort((a, b) => waiting(b) + titleInterest(b) - waiting(a) - titleInterest(a));
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
    if (checked.accepted && lead.needsDataCheck && !hasDataInRepo(facts.files)) {
      record("rejected", ["No small public dataset in the repository, so the Lab would have nothing to run on."], { license: facts.license, runtime: checked.runtime });
      continue;
    }
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
    if (draft.relatability < MIN_RELATABILITY) {
      record("rejected", [`Relatability ${draft.relatability} of 10, below our limit of ${MIN_RELATABILITY}: ${draft.relatability_why}`], { license: facts.license, runtime: checked.runtime });
      continue;
    }
    const attention = await deps.attention?.(lead).catch(() => undefined);
    record("pending", checked.reasons, { license: facts.license, runtime: checked.runtime, draft: withScoutNote(draft), attention, interest: interestScore(draft.relatability, draft.topic, attention) });
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

/** A read-only GitHub token lifts the limit of 60 requests an hour. It stays on the server. */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return { accept: "application/vnd.github+json", "user-agent": "rerun-scout", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function github<T>(apiPath: string): Promise<T> {
  const res = await withNetworkRetry(() => fetch(`https://api.github.com${apiPath}`, { headers: githubHeaders() }));
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
    if (title) leads.push({ id: `rescience:${name}`, source: "ReScience C", title, paperUrl: `https://doi.org/${name.replace("_", "/")}`, doi: name.replace("_", "/"), repoUrl });
  }
  return leads;
}

/**
 * Hugging Face Papers: daily arXiv papers, some with a linked GitHub repository. Only those with a
 * link become leads, and they must also show a small dataset, since a preprint may not ship one.
 */
export async function huggingFaceLeads(limit: number): Promise<Lead[]> {
  const res = await withNetworkRetry(() => fetch(`https://huggingface.co/api/daily_papers?limit=${limit}`, { headers: { "user-agent": "rerun-scout" } }));
  if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
  const items = (await res.json()) as { title?: string; paper?: { id?: string; title?: string; githubRepo?: string | null; upvotes?: number; summary?: string }; summary?: string }[];
  return items.flatMap((item) => {
    const repoUrl = item.paper?.githubRepo ? repoRoot(item.paper.githubRepo) : null;
    if (!repoUrl || !item.paper?.id) return [];
    return [{ id: `arxiv:${item.paper.id}`, source: "Hugging Face Papers", title: item.paper.title ?? item.title ?? item.paper.id, paperUrl: `https://arxiv.org/abs/${item.paper.id}`, doi: `10.48550/arXiv.${item.paper.id}`, upvotes: item.paper.upvotes, abstract: item.paper.summary ?? item.summary, repoUrl, needsDataCheck: true }];
  });
}

interface OpenAlexWork {
  cited_by_count?: number;
  counts_by_year?: { year: number; cited_by_count: number }[];
}

/** Citations from this year and last count three times, so a paper people still cite ranks above an old one they've moved on from. */
export function citationAttention(work: OpenAlexWork, year: number): Attention | undefined {
  const total = work.cited_by_count ?? 0;
  if (!total) return undefined;
  const recent = (work.counts_by_year ?? []).filter((y) => y.year >= year - 1).reduce((sum, y) => sum + y.cited_by_count, 0);
  return { source: "OpenAlex", label: recent ? `${total} citations, ${recent} since ${year - 1}` : `${total} citations`, value: total + recent * 2 };
}

/**
 * Attention, best source first. Altmetric counts news and social mentions, but has needed a key since
 * November 2025, so it's only used if ALTMETRIC_KEY is set. OpenAlex is free, but counts citations,
 * which show interest among researchers rather than the public.
 */
export async function paperAttention(lead: Lead): Promise<Attention | undefined> {
  const key = process.env.ALTMETRIC_KEY;
  if (key && lead.doi) {
    const res = await fetch(`https://api.altmetric.com/v1/doi/${lead.doi}?key=${encodeURIComponent(key)}`).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { score?: number; cited_by_msm_count?: number };
      return { source: "Altmetric", label: `${d.cited_by_msm_count ?? 0} news stories, attention score ${Math.round(d.score ?? 0)}`, value: d.score ?? 0 };
    }
  }
  if (lead.doi) {
    const res = await fetch(`https://api.openalex.org/works/https://doi.org/${lead.doi}`, { headers: { "user-agent": "rerun-scout" } }).catch(() => null);
    if (res?.ok) {
      const found = citationAttention((await res.json()) as OpenAlexWork, new Date().getUTCFullYear());
      if (found) return found;
    }
  }
  if (lead.upvotes) return { source: "Hugging Face", label: `${lead.upvotes} upvotes`, value: lead.upvotes };
  return undefined;
}

/** Someone suggested a paper on the site. It waits in the queue like any other lead, and a person still reviews it. */
export function addSuggestion(state: ScoutState, repoUrl: string, paperUrl: string): { ok: boolean; message: string } {
  const repo = repoRoot(repoUrl);
  if (!repo) return { ok: false, message: "Enter the code's GitHub address, like https://github.com/owner/name" };
  if (!/^https:\/\/\S+$/.test(paperUrl)) return { ok: false, message: "Enter the paper's address, starting with https://" };
  const id = `suggested:${repo}`;
  if (!state.candidates[id]) {
    state.candidates[id] = { id, source: "Suggested by a visitor", title: repo.replace("https://github.com/", ""), paperUrl, repoUrl: repo, needsDataCheck: true, status: "retry", reasons: ["Waiting for the next scan."], checkedAt: new Date().toISOString() };
  }
  return { ok: true, message: "Thanks! New papers are reviewed within 24 hours." };
}

export const allLeads = async (): Promise<Lead[]> => {
  const [rescience, huggingFace] = await Promise.allSettled([reScienceLeads(70), huggingFaceLeads(100)]);
  if (rescience.status === "rejected" && huggingFace.status === "rejected") throw new Error(`no source answered: ${String(rescience.reason)}`);
  return [...(rescience.status === "fulfilled" ? rescience.value : []), ...(huggingFace.status === "fulfilled" ? huggingFace.value : [])];
};

export async function githubRepoFacts(repoUrl: string): Promise<RepoFacts> {
  const { owner, repo } = parseGithubUrl(repoUrl)!;
  const meta = await github<{ default_branch: string; size: number; archived: boolean; license: { spdx_id?: string } | null }>(`/repos/${owner}/${repo}`);
  const languages = await github<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
  const tree = await github<{ tree: { path: string; type: string }[] }>(`/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
  const dependencyFiles = files.filter((f) => /(^|\/)(requirements[^/]*\.txt|environment[^/]*\.ya?ml|Pipfile|pyproject\.toml|DESCRIPTION)$/i.test(f)).slice(0, 4);
  const texts = await Promise.all(dependencyFiles.map((f) => raw(`https://raw.githubusercontent.com/${owner}/${repo}/${meta.default_branch}/${f}`)));
  const licenseFile = files.find((f) => /^(licen[cs]e|copying)(\.\w+)?$/i.test(f));
  const licenseText = licenseFile ? await raw(`https://raw.githubusercontent.com/${owner}/${repo}/${meta.default_branch}/${licenseFile}`) : undefined;
  return { license: meta.license?.spdx_id ?? null, licenseText, languages, sizeKb: meta.size, archived: meta.archived, files, dependencyText: texts.join("\n") };
}

export function draftWithModel(model: PrivateModel) {
  return (lead: Lead) => draftClaim(lead.repoUrl!, lead.paperUrl, model, lead.abstract);
}

/* Saved state */

const statePath = (dataDir: string) => process.env.SCOUT_STATE_FILE || path.join(dataDir, "scout", "state.json");

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
