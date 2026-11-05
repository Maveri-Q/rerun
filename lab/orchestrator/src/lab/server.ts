import { addSuggestion, loadScoutState, saveScoutState, type Candidate } from "../scout/scout.ts";

const SUGGESTIONS_PER_HOUR = 30;
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ClaimSpec, specHash } from "@rerun/shared";
import { LlmClient, llmConfigFromEnv } from "../nearai/client.ts";
import { NearAiModel } from "../pipeline/model.ts";
import { reproduce, type ArtifactResolver } from "../pipeline/pipeline.ts";
import { DockerSandbox, sandboxImage } from "../sandbox/docker.ts";
import { draftClaim } from "./draft.ts";
import { latestAttestation, readHashed, readMethods, saveMethods, saveSealed, type EventHub } from "./store.ts";

/**
 * The Lab's public HTTP surface: live run streams (SSE), reports, logs, attestation records, AI
 * claim drafts, private-data uploads and optional dry runs. No keys or private data are served.
 */

const MAX_JSON_BYTES = 64 * 1024;
const MAX_SEALED_BYTES = 64 * 1024 * 1024;
const DRAFTS_PER_HOUR = 10;

export interface ServerOptions {
  hub: EventHub;
  publicUrl: string;
  info: Record<string, unknown>;
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  resolverFor: (spec: ClaimSpec) => ArtifactResolver;
  labCodehash: string;
  labAccount: string;
  modelId: string;
  dryRunEnabled: boolean;
  /** Where the scout keeps its queue. Without it, the scout's endpoints answer 404. */
  scoutDir?: string;
  /** Confirms on-chain that a market came from this candidate and the contract's owner opened it. */
  verifyScoutApproval?: (marketId: number, candidate: Candidate) => Promise<boolean>;
}

export function startLabServer(port: number, opts: ServerOptions) {
  const draftTimes: number[] = [];
  const suggestionTimes: number[] = [];
  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => json(res, 500, { error: e.message.slice(0, 300) }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://lab");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET") {
      if (url.pathname === "/scout" && opts.scoutDir) return json(res, 200, loadScoutState(opts.scoutDir));
      if (url.pathname === "/health") return json(res, 200, { ok: true, dry_run: opts.dryRunEnabled, ...opts.info });
      if (url.pathname === "/runs") return json(res, 200, opts.hub.recent(Math.min(Number(url.searchParams.get("limit") ?? 20), 50)));
      if (parts[0] === "runs" && parts[2] === "stream" && parts[1]) return stream(req, res, parts[1]);
      if (parts[0] === "runs" && parts[1]) return json(res, 200, opts.hub.history(parts[1]));
      if (url.pathname === "/attestations/latest") return bytes(res, latestAttestation(), "application/json");
      if (parts[0] === "attestations" && parts[1]) return bytes(res, readHashed("attestations", parts[1]), "application/json");
      if (parts[0] === "reports" && parts[1]) return bytes(res, readHashed("reports", parts[1]), "text/plain; charset=utf-8");
      if (parts[0] === "evidence" && parts[1]) return bytes(res, readHashed("evidences", parts[1]), "application/json");
      if (parts[0] === "methods" && parts[1]) {
        const text = readMethods(parts[1]);
        return bytes(res, text === undefined ? null : Buffer.from(text), "text/plain; charset=utf-8");
      }
      if (parts[0] === "logs" && parts[1]) return bytes(res, readHashed("logs", parts[1]), "text/plain; charset=utf-8");
      if (parts[0] === "sealed" && parts[1]) return bytes(res, readHashed("sealed", parts[1]), "application/octet-stream");
    }

    if (req.method === "POST") {
      if (url.pathname === "/draft") {
        const now = Date.now();
        while (draftTimes[0] !== undefined && draftTimes[0] < now - 3_600_000) draftTimes.shift();
        if (draftTimes.length >= DRAFTS_PER_HOUR) return json(res, 429, { error: "Too many AI drafts this hour. Fill in the fields by hand, or try later." });
        draftTimes.push(now);
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as { repo_url?: string; paper_url?: string };
        const llm = new LlmClient(llmConfigFromEnv(), mockDraft);
        llm.newRun();
        const model = new NearAiModel(llm, opts.modelId);
        await model.attest();
        try {
          return json(res, 200, await draftClaim(body.repo_url ?? "", body.paper_url, model));
        } catch (e) {
          return json(res, 422, { error: (e as Error).message.slice(0, 300) });
        }
      }
      if (parts[0] === "scout" && parts[2] === "approved" && parts[1] && opts.scoutDir && opts.verifyScoutApproval) {
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as { market_id?: number };
        const state = loadScoutState(opts.scoutDir);
        const candidate = state.candidates[decodeURIComponent(parts[1])];
        if (!candidate || typeof body.market_id !== "number") return json(res, 404, { error: "Unknown suggestion." });
        // Anyone can call this, so it believes the blockchain and not the caller.
        if (!(await opts.verifyScoutApproval(body.market_id, candidate))) return json(res, 403, { error: "That claim doesn't match this suggestion, or wasn't opened by the owner." });
        state.candidates[candidate.id] = { ...candidate, status: "approved", marketId: body.market_id };
        saveScoutState(opts.scoutDir, state);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/suggestions" && opts.scoutDir) {
        const now = Date.now();
        while (suggestionTimes[0] !== undefined && suggestionTimes[0] < now - 3_600_000) suggestionTimes.shift();
        if (suggestionTimes.length >= SUGGESTIONS_PER_HOUR) return json(res, 429, { error: "Lots of suggestions this hour. Try again later." });
        suggestionTimes.push(now);
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as { repo_url?: string; paper_url?: string };
        const state = loadScoutState(opts.scoutDir);
        const result = addSuggestion(state, body.repo_url ?? "", body.paper_url ?? "");
        if (result.ok) saveScoutState(opts.scoutDir, state);
        return json(res, result.ok ? 201 : 422, result.ok ? { message: result.message } : { error: result.message });
      }
      if (url.pathname === "/methods") {
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as { spec_hash?: string; methods?: string };
        if (!body.methods?.trim() || body.methods.length > 20_000) return json(res, 422, { error: "Paste the methods section, up to 20,000 characters." });
        const saved = saveMethods(body.spec_hash ?? "", body.methods);
        return json(res, saved ? 201 : 409, saved ? { ok: true } : { error: "Methods were already added for this claim." });
      }
      if (url.pathname === "/sealed") {
        const hash = saveSealed(await readBody(req, MAX_SEALED_BYTES));
        return json(res, 200, { ref: `${opts.publicUrl}/sealed/${hash}` });
      }
      if (url.pathname === "/dry-run") {
        if (!opts.dryRunEnabled) return json(res, 403, { error: "This Lab does not offer dry runs." });
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as unknown;
        const parsed = ClaimSpec.safeParse(body);
        if (!parsed.success) return json(res, 422, { error: parsed.error.issues[0]?.message ?? "invalid spec" });
        if (parsed.data.private_data) return json(res, 422, { error: "Dry runs do not accept private data." });
        const run = `dry-${specHash(parsed.data).slice(0, 16)}-${Date.now().toString(36)}`;
        void dryRun(parsed.data, run);
        return json(res, 202, { run });
      }
    }
    json(res, 404, { error: "not found" });
  }

  function stream(req: IncomingMessage, res: ServerResponse, run: string): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.flushHeaders(); // otherwise the browser only sees the stream open at the first event
    res.write(": connected\n\n");
    for (const e of opts.hub.history(run)) res.write(`data: ${JSON.stringify(e)}\n\n`);
    const unsubscribe = opts.hub.subscribe(run, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  }

  async function dryRun(spec: ClaimSpec, run: string): Promise<void> {
    await opts.exclusive(async () => {
      const llm = new LlmClient(llmConfigFromEnv());
      llm.newRun();
      await reproduce(
        { spec, marketId: 0, runIndex: 0, labAccount: opts.labAccount, labCodehash: opts.labCodehash },
        {
          sandbox: new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb }),
          model: new NearAiModel(llm, opts.modelId),
          resolver: opts.resolverFor(spec),
          dateInstall: true,
          newSandbox: () => new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb }),
          emit: (e) => opts.hub.publish(run, e),
        },
      );
    }).catch((e: Error) => opts.hub.publish(run, { stage: "done", message: `Dry run stopped: ${e.message.slice(0, 200)}` }));
  }

  server.listen(port);
  return server;
}

function mockDraft(req: { purpose: string }): string | undefined {
  if (req.purpose !== "draft") return undefined;
  return JSON.stringify({ title: "", statement: "", notes: "MOCK_LLM is on, so nothing was drafted. Fill in the fields by hand." });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function bytes(res: ServerResponse, body: Buffer | null, contentType: string): void {
  if (!body) return json(res, 404, { error: "not found" });
  res.writeHead(200, { "content-type": contentType }).end(body);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
