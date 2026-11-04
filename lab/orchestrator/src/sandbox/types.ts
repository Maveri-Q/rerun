/** Where untrusted research code runs. Implemented by Docker, and by a fake in tests. */

export const REPO_DIR = "/work/repo";

export interface ExecOptions {
  /** Network is on only to fetch code and install dependencies; never while the research code runs. */
  network: boolean;
  timeoutMs: number;
  /** Working directory inside the sandbox. Defaults to the repo. */
  cwd?: string;
  onOutput?: (chunk: string) => void;
}

export interface ExecResult {
  exitCode: number;
  timedOut: boolean;
  /** Last part of stdout + stderr. */
  tail: string;
  /** sha256 of the complete stdout + stderr stream. */
  logHash: string;
  /** Complete output up to the sandbox's size cap. */
  log: string;
  durationMs: number;
}

export interface Sandbox {
  /** Prepares an empty, isolated workspace. */
  create(): Promise<void>;
  /** Runs a shell script in a fresh container that shares only the workspace. */
  exec(script: string, opts: ExecOptions): Promise<ExecResult>;
  /** Writes a file under the workspace; `path` is relative to the repo. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Reads a file relative to the repo; null if missing. At most `maxBytes` are returned. */
  readFile(path: string, maxBytes: number): Promise<Buffer | null>;
  /** Regular files under the repo, relative, without `.git` and installed dependencies. */
  listFiles(maxEntries: number): Promise<string[]>;
  /** Deletes the workspace, including any decrypted private data. */
  destroy(): Promise<void>;
}
