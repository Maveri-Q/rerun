import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "@rerun/shared";
import type { StageEvent } from "../pipeline/pipeline.ts";
import { NetworkResolver } from "../pipeline/resolver.ts";

/** The Lab's public, content-addressed files and its run history, kept on disk under `.data/`. */

export const DATA_DIR = path.resolve(import.meta.dirname, "../../.data");

const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_RUN_KEY = /^[A-Za-z0-9-]{1,64}$/;

export function readHashed(kind: "logs" | "reports" | "evidences" | "attestations" | "sealed", hash: string): Buffer | null {
  if (!HEX64.test(hash)) return null;
  const file = path.join(DATA_DIR, kind, hash + (kind === "attestations" ? ".json" : ""));
  return existsSync(file) ? readFileSync(file) : null;
}

export function saveAttestation(digest: string, record: unknown): void {
  const dir = path.join(DATA_DIR, "attestations");
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ digest, recorded_at: Math.floor(Date.now() / 1000), ...(record as object) });
  writeFileSync(path.join(dir, `${digest}.json`), body);
  writeFileSync(path.join(dir, "latest.json"), body);
}

export function latestAttestation(): Buffer | null {
  const file = path.join(DATA_DIR, "attestations", "latest.json");
  return existsSync(file) ? readFileSync(file) : null;
}

export function saveSealed(bytes: Buffer): string {
  const dir = path.join(DATA_DIR, "sealed");
  mkdirSync(dir, { recursive: true });
  const hash = sha256Hex(bytes);
  writeFileSync(path.join(dir, hash), bytes);
  return hash;
}

const safeSpecHash = (hash: string) => (HEX64.test(hash) ? path.join(DATA_DIR, "methods", `${hash}.md`) : null);

/** A paper's methods section, kept beside the claim. The first submission for a claim stands. */
export function saveMethods(specHash: string, methods: string): boolean {
  const file = safeSpecHash(specHash);
  if (!file || existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, methods);
  return true;
}

export function readMethods(specHash: string): string | undefined {
  const file = safeSpecHash(specHash);
  return file && existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** Real claims, plus sealed files uploaded to this Lab (stored locally, so no self-fetch). */
export class LabResolver extends NetworkResolver {
  override async fetchCiphertext(ref: string): Promise<Uint8Array> {
    const m = /\/sealed\/([0-9a-f]{64})$/.exec(ref);
    const local = m ? readHashed("sealed", m[1]!) : null;
    return local ?? super.fetchCiphertext(ref);
  }
}

export interface TimedEvent extends StageEvent {
  at: number;
}

type Listener = (e: TimedEvent) => void;

/** Stage events per run: replayed from disk for late viewers, pushed live over SSE. */
export class EventHub {
  private readonly dir = path.join(DATA_DIR, "events");
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    mkdirSync(this.dir, { recursive: true });
  }

  publish(runKey: string, event: StageEvent): void {
    if (!SAFE_RUN_KEY.test(runKey)) return;
    const timed: TimedEvent = { ...event, at: Date.now() };
    appendFileSync(path.join(this.dir, `${runKey}.jsonl`), `${JSON.stringify(timed)}\n`);
    for (const l of this.listeners.get(runKey) ?? []) l(timed);
  }

  history(runKey: string): TimedEvent[] {
    if (!SAFE_RUN_KEY.test(runKey)) return [];
    const file = path.join(this.dir, `${runKey}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TimedEvent);
  }

  subscribe(runKey: string, l: Listener): () => void {
    const set = this.listeners.get(runKey) ?? new Set<Listener>();
    set.add(l);
    this.listeners.set(runKey, set);
    return () => set.delete(l);
  }

  /** The latest event of the most recently active runs, for the home page feed. */
  recent(limit: number): { run: string; event: TimedEvent }[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".jsonl") && !f.startsWith("dry-"))
      .map((f) => ({ f, mtime: statSync(path.join(this.dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .flatMap(({ f }) => {
        const run = f.replace(/\.jsonl$/, "");
        const event = this.history(run).at(-1);
        return event ? [{ run, event }] : [];
      });
  }
}

/** One sandbox job at a time (build plan §5.4). */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}
