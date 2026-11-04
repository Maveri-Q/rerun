import { withNetworkRetry } from "../nearai/attestation.ts";
import { parseJsonReply } from "../pipeline/guards.ts";
import type { PrivateModel } from "../pipeline/model.ts";

/**
 * Drafts a ClaimSpec from a GitHub repo for the create wizard. The commit comes from GitHub's API,
 * never the model, and the person creating the market confirms every field before anything is signed.
 */

const SYSTEM_PROMPT = `You help turn a research code repository into a reproducibility claim. Use only what the repository shows; leave a field empty rather than guess.

Reply with one JSON object and nothing else:
{"title": "under 120 characters", "statement": "plain-English claim under 600 characters", "authors": "", "license": "", "runtime": "python3.11" or "r4.4", "setup": ["shell commands"], "entrypoint": "shell command that produces the result", "output_path": "relative file the result is written to", "extractor_type": "jsonpath|regex|csv_cell", "extractor_expr": "", "metric_name": "", "reported_value": "decimal string such as 0.912, or empty if the repository does not state one", "notes": "what the person must check"}`;

export interface ClaimDraft {
  repo_url: string;
  commit: string;
  title: string;
  statement: string;
  authors: string;
  license: string;
  runtime: string;
  setup: string[];
  entrypoint: string;
  output_path: string;
  extractor_type: string;
  extractor_expr: string;
  metric_name: string;
  reported_value: string;
  notes: string;
}

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

async function github<T>(path: string): Promise<T> {
  const res = await withNetworkRetry(() => fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "rerun-lab" } }));
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function draftClaim(repoUrl: string, paperUrl: string | undefined, model: PrivateModel): Promise<ClaimDraft> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) throw new Error("Enter a repository URL like https://github.com/owner/name");
  const { owner, repo } = parsed;
  const meta = await github<{ default_branch: string; license: { spdx_id?: string } | null }>(`/repos/${owner}/${repo}`);
  const head = await github<{ sha: string }>(`/repos/${owner}/${repo}/commits/${meta.default_branch}`);
  const tree = await github<{ tree: { path: string; type: string }[] }>(`/repos/${owner}/${repo}/git/trees/${head.sha}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
  const readmePath = files.find((f) => /^readme(\.\w+)?$/i.test(f));
  const raw = async (p: string) => {
    const res = await withNetworkRetry(() => fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/${p}`));
    return res.ok ? (await res.text()).slice(0, 8000) : "";
  };
  const readme = readmePath ? await raw(readmePath) : "";
  const requirements = files.includes("requirements.txt") ? await raw("requirements.txt") : "";

  const reply = await model.ask(
    "draft",
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Repository: ${repoUrl}`,
          paperUrl ? `Paper: ${paperUrl}` : "",
          `License: ${meta.license?.spdx_id ?? "unknown"}`,
          `Files:\n${files.slice(0, 200).join("\n")}`,
          requirements ? `requirements.txt:\n${requirements}` : "",
          `README:\n${readme || "(none)"}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    2000,
  );
  const d = parseJsonReply(reply) as Record<string, unknown>;
  const str = (k: string, fallback = "") => (typeof d[k] === "string" ? (d[k] as string) : fallback);
  return {
    repo_url: `https://github.com/${owner}/${repo}`,
    commit: head.sha,
    title: str("title").slice(0, 120),
    statement: str("statement").slice(0, 600),
    authors: str("authors"),
    license: str("license", meta.license?.spdx_id ?? ""),
    runtime: str("runtime") === "r4.4" ? "r4.4" : "python3.11",
    setup: Array.isArray(d.setup) ? d.setup.filter((s): s is string => typeof s === "string").slice(0, 16) : [],
    entrypoint: str("entrypoint"),
    output_path: str("output_path"),
    extractor_type: ["jsonpath", "regex", "csv_cell"].includes(str("extractor_type")) ? str("extractor_type") : "jsonpath",
    extractor_expr: str("extractor_expr"),
    metric_name: str("metric_name"),
    reported_value: str("reported_value"),
    notes: str("notes"),
  };
}
