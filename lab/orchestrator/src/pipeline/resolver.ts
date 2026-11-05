import type { ClaimSpec } from "@rerun/shared";
import { withNetworkRetry } from "../nearai/attestation.ts";
import type { Sandbox } from "../sandbox/types.ts";
import type { ArtifactResolver } from "./pipeline.ts";

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const CLONE_ATTEMPTS = 3;

/** Real claims: the repo is cloned inside the sandbox; data is downloaded by trusted code and hash-checked. */
export class NetworkResolver implements ArtifactResolver {
  async fetchRepo(spec: ClaimSpec, sandbox: Sandbox): Promise<boolean> {
    const { repo_url, commit } = spec.artifact;
    const script = `GIT_TERMINAL_PROMPT=0 git clone -q ${shellQuote(repo_url)} repo && git -C repo checkout -q ${commit}`;
    // A missing repository settles the claim as INVALID, so a dropped connection gets more than one chance.
    for (let attempt = 0; attempt < CLONE_ATTEMPTS; attempt++) {
      const result = await sandbox.exec(`rm -rf repo; ${script}`, { network: true, timeoutMs: CLONE_TIMEOUT_MS, cwd: "/work" });
      if (result.exitCode === 0) return true;
    }
    return false;
  }

  fetchData(url: string): Promise<Uint8Array> {
    return download(url);
  }

  fetchCiphertext(ref: string): Promise<Uint8Array> {
    return download(ref);
  }
}

async function download(url: string): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("only https URLs are supported");
  const res = await withNetworkRetry(() => fetch(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error("file too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("file too large");
  return bytes;
}

export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
