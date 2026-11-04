import { describe, expect, it } from "vitest";
import { lockCommand } from "../src/pipeline/pipeline.ts";
import { DockerSandbox, sandboxImage } from "../src/sandbox/docker.ts";

// Needs Docker and the sandbox images (`pnpm sandbox:build`): DOCKER_TESTS=1 pnpm --filter @rerun/orchestrator test
const enabled = process.env.DOCKER_TESTS === "1";

describe.skipIf(!enabled)("DockerSandbox isolation (real containers)", () => {
  const withSandbox = async (fn: (s: DockerSandbox) => Promise<void>) => {
    const s = new DockerSandbox({ image: sandboxImage("python3.11"), cpus: 1, memGb: 1 });
    await s.create();
    try {
      await fn(s);
    } finally {
      await s.destroy();
    }
  };
  const py = (code: string) => `python -c "${code}"`;

  it("research code has no network", async () => {
    await withSandbox(async (s) => {
      const r = await s.exec(py("import socket; socket.create_connection(('1.1.1.1', 53), 3)"), { network: false, timeoutMs: 30_000 });
      expect(r.exitCode).not.toBe(0);
      expect(r.log).toMatch(/unreachable|OSError|timed out/i);
    });
  }, 60_000);

  it("host secrets do not reach the container", async () => {
    process.env.NEARAI_CLOUD_API_KEY_PROBE = "sk-should-never-appear";
    await withSandbox(async (s) => {
      const r = await s.exec("env", { network: false, timeoutMs: 30_000 });
      expect(r.log).not.toContain("sk-should-never-appear");
      expect(r.log).not.toMatch(/NEARAI|PRIVATE_KEY/);
    });
    delete process.env.NEARAI_CLOUD_API_KEY_PROBE;
  }, 60_000);

  it("runs as non-root with a read-only system and writable workspace", async () => {
    await withSandbox(async (s) => {
      const r = await s.exec("id -u; touch /usr/x 2>&1; echo sys=$?; touch /work/repo/ok; echo work=$?", { network: false, timeoutMs: 30_000 });
      expect(r.log).toMatch(/^1000$/m);
      expect(r.log).toContain("Read-only file system");
      expect(r.log).toContain("work=0");
    });
  }, 60_000);

  it("kills a run that exceeds its time limit", async () => {
    await withSandbox(async (s) => {
      const started = Date.now();
      const r = await s.exec("sleep 300", { network: false, timeoutMs: 3_000 });
      expect(r.timedOut).toBe(true);
      expect(r.exitCode).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(30_000);
    });
  }, 60_000);

  it("enforces the memory limit", async () => {
    await withSandbox(async (s) => {
      const r = await s.exec(py("x = bytearray(3 * 1024 ** 3); print(len(x))"), { network: false, timeoutMs: 60_000 });
      expect(r.exitCode).not.toBe(0);
    });
  }, 90_000);

  it("stops fork bombs at the PID limit", async () => {
    await withSandbox(async (s) => {
      const code = "import subprocess; ps = [subprocess.Popen(['sleep', '20']) for _ in range(600)]; print('spawned', len(ps))";
      const r = await s.exec(py(code), { network: false, timeoutMs: 45_000 });
      expect(r.log).not.toContain("spawned 600");
    });
  }, 90_000);

  it("round-trips binary files, including outside-safe paths", async () => {
    await withSandbox(async (s) => {
      const bytes = Buffer.from([0, 255, 10, 13, 10, 1, 2, 3]);
      await s.writeFile("nested/dir/data.bin", bytes);
      expect((await s.readFile("nested/dir/data.bin", 1024))?.equals(bytes)).toBe(true);
      expect(await s.readFile("missing.bin", 1024)).toBeNull();
      expect(await s.listFiles(10)).toContain("nested/dir/data.bin");
    });
  }, 60_000);

  it("the R runtime runs research code, writes output and produces an environment lock", async () => {
    const s = new DockerSandbox({ image: sandboxImage("r4.4"), cpus: 1, memGb: 2 });
    await s.create();
    try {
      const script = ["m <- lm(dist ~ speed, data = cars)", 'jsonlite::write_json(list(r2 = summary(m)$r.squared), "out.json", auto_unbox = TRUE)', ""];
      await s.writeFile("run.R", Buffer.from(script.join("\n")));
      const run = await s.exec("Rscript run.R", { network: false, timeoutMs: 120_000 });
      expect(run.log).toBe("");
      expect(run.exitCode).toBe(0);
      const out = JSON.parse((await s.readFile("out.json", 1024))!.toString()) as { r2: number };
      expect(out.r2).toBeCloseTo(0.651, 2);
      const lock = await s.exec(lockCommand("r4.4"), { network: false, timeoutMs: 120_000 });
      expect(lock.exitCode).toBe(0);
      expect(lock.log).toContain("R version 4.4");
      expect(lock.log).toMatch(/^jsonlite \S+$/m);
    } finally {
      await s.destroy();
    }
  }, 180_000);

  it("deletes the workspace when destroyed", async () => {
    const s = new DockerSandbox({ image: sandboxImage("python3.11"), cpus: 1, memGb: 1 });
    await s.create();
    await s.writeFile("private/plain.csv", Buffer.from("secret"));
    await s.destroy();
    await s.create();
    expect(await s.readFile("private/plain.csv", 100)).toBeNull();
    await s.destroy();
  }, 60_000);
});
