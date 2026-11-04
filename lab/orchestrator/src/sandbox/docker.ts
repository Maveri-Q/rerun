import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { REPO_DIR, type ExecOptions, type ExecResult, type Sandbox } from "./types.ts";

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const TAIL_BYTES = 16 * 1024;
const HELPER_TIMEOUT_MS = 120_000;

export interface DockerLimits {
  image: string;
  cpus: number;
  memGb: number;
}

export function sandboxImage(runtime: "python3.11" | "r4.4"): string {
  return `rerun-sandbox:${runtime}`;
}

const docker = () => process.env.DOCKER_BIN || "docker";

/**
 * One named volume per run; every phase is a fresh, throwaway container that mounts only that
 * volume. No environment variables or host paths are passed in, so research code has no way to
 * see the orchestrator's keys. The research code itself runs with `--network none`.
 */
export class DockerSandbox implements Sandbox {
  private readonly volume = `rerun-${randomBytes(8).toString("hex")}`;

  constructor(private readonly limits: DockerLimits) {}

  private baseArgs(network: boolean, cwd: string): string[] {
    return [
      "run",
      "--rm",
      "--volume",
      `${this.volume}:/work`,
      "--network",
      network ? "bridge" : "none",
      "--cpus",
      String(this.limits.cpus),
      "--memory",
      `${this.limits.memGb}g`,
      "--pids-limit",
      "512",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,size=1g",
      "--workdir",
      cwd,
    ];
  }

  async create(): Promise<void> {
    await run(["volume", "create", this.volume]);
    await run([...this.baseArgs(false, "/work"), this.limits.image, "sh", "-c", `mkdir -p /work/.home ${REPO_DIR}`]);
  }

  async exec(script: string, opts: ExecOptions): Promise<ExecResult> {
    const name = `${this.volume}-${randomBytes(4).toString("hex")}`;
    const args = [...this.baseArgs(opts.network, opts.cwd ?? REPO_DIR), "--name", name, this.limits.image, "sh", "-c", script];
    const started = Date.now();
    const child = spawn(docker(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const hash = createHash("sha256");
    const kept: Buffer[] = [];
    let keptBytes = 0;
    const onData = (chunk: Buffer) => {
      hash.update(chunk);
      if (keptBytes < MAX_LOG_BYTES) {
        kept.push(chunk);
        keptBytes += chunk.length;
      }
      opts.onOutput?.(chunk.toString("utf8"));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Killing the docker CLI would leave the container running, so kill the container.
      spawn(docker(), ["kill", name], { stdio: "ignore" });
    }, opts.timeoutMs);

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    }).finally(() => clearTimeout(timer));

    const log = Buffer.concat(kept).toString("utf8");
    return {
      exitCode,
      timedOut,
      log,
      tail: log.slice(-TAIL_BYTES),
      logHash: hash.digest("hex"),
      durationMs: Date.now() - started,
    };
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await run(
      [...this.baseArgs(false, REPO_DIR), "--interactive", this.limits.image, "sh", "-c", 'mkdir -p "$(dirname -- "$1")" && cat > "$1"', "sh", path],
      data,
    );
  }

  async readFile(path: string, maxBytes: number): Promise<Buffer | null> {
    const script = 'test -f "$1" || exit 44; head -c "$2" -- "$1"';
    const args = [...this.baseArgs(false, REPO_DIR), this.limits.image, "sh", "-c", script, "sh", path, String(maxBytes)];
    const { code, stdout } = await capture(args);
    if (code === 44) return null;
    if (code !== 0) throw new Error(`sandbox read failed (exit ${code})`);
    return stdout;
  }

  async listFiles(maxEntries: number): Promise<string[]> {
    const script = `find . -type f -not -path './.git/*' -not -path './.pydeps/*' -not -path './.rlib/*' | head -n ${maxEntries}`;
    const { stdout } = await capture([...this.baseArgs(false, REPO_DIR), this.limits.image, "sh", "-c", script]);
    return stdout.toString("utf8").split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
  }

  async destroy(): Promise<void> {
    await run(["volume", "rm", "--force", this.volume]).catch(() => {});
  }
}

function run(args: string[], stdin?: Uint8Array): Promise<void> {
  return capture(args, stdin).then(({ code, stderr }) => {
    if (code !== 0) throw new Error(`docker ${args[0]} failed (exit ${code}): ${stderr.slice(-400)}`);
  });
}

function capture(args: string[], stdin?: Uint8Array): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(docker(), args, { stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill(), HELPER_TIMEOUT_MS);
    child.stdout!.on("data", (d: Buffer) => out.push(d));
    child.stderr!.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err });
    });
    if (stdin) child.stdin!.end(stdin);
  });
}
