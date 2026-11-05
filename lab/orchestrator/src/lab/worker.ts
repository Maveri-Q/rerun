import { ClaimSpec, specHash, type Receipt } from "@rerun/shared";
import type { Account } from "near-api-js";
import type { Chain } from "../chain/near.ts";
import { LlmClient, type ChatRequest, type LlmConfig } from "../nearai/client.ts";
import { NearAiModel } from "../pipeline/model.ts";
import { reproduce, type ArtifactResolver, type LabKeys, type StageEvent } from "../pipeline/pipeline.ts";
import { DockerSandbox, sandboxImage } from "../sandbox/docker.ts";

/**
 * The Lab's loop (build plan §5.2): watch the contract for markets past their lock time,
 * re-run them one at a time, and post the receipt. Challenged markets get an independent second
 * run with a different model.
 */

interface MarketView {
  id: number;
  state: string;
  lock_time: number;
  spec: { spec_hash: string };
}

export interface WorkerConfig {
  chain: Chain;
  lab: Account;
  labCodehash: string;
  labKeys: LabKeys;
  modelId: string;
  rerunModelId: string;
  llm: LlmConfig;
  resolverFor: (spec: ClaimSpec) => ArtifactResolver;
  mockResponderFor?: (spec: ClaimSpec) => ((req: ChatRequest) => string | undefined) | undefined;
  /** The paper's methods section, if anyone provided it. */
  methodsFor?: (spec: ClaimSpec) => string | undefined;
  store?: (kind: "log" | "report" | "evidence", hash: string, content: string) => Promise<string>;
  onEvent?: (marketId: number, e: StageEvent) => void;
  onAttestation?: (digest: string, record: unknown) => void | Promise<void>;
  /** Serialises runs with anything else using the sandbox, such as dry runs. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  log?: (message: string) => void;
}

const RECEIPT_DEPOSIT_NEAR = "0.2"; // covers receipt storage; the excess is refunded

export class LabWorker {
  constructor(private readonly cfg: WorkerConfig) {}

  /** Handles every market that needs the Lab right now. Returns how many were processed. */
  async tick(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const list = (state: string) => this.cfg.chain.view<MarketView[]>("list_markets", { state, limit: 100 });
    const [locked, open, running, challenged] = await Promise.all(["Locked", "Open", "Running", "Challenged"].map(list));
    const due = [
      // `running` covers a Lab restart between start_run and propose_result.
      ...running!.map((m) => ({ m, runIndex: 0, start: false })),
      ...challenged!.map((m) => ({ m, runIndex: 1, start: false })),
      ...locked!.map((m) => ({ m, runIndex: 0, start: true })),
      ...open!.filter((m) => now >= m.lock_time).map((m) => ({ m, runIndex: 0, start: true })),
    ].sort((a, b) => a.m.id - b.m.id);

    let handled = 0;
    for (const { m, runIndex, start } of due) {
      try {
        const run = () => this.process(m, runIndex, start);
        await (this.cfg.exclusive ? this.cfg.exclusive(run) : run());
        handled++;
      } catch (e) {
        // Leave it for the next tick; if the Lab stays down, refund_stale protects traders.
        this.cfg.log?.(`market ${m.id}: ${(e as Error).message}`);
      }
    }
    return handled;
  }

  private async process(m: MarketView, runIndex: number, start: boolean): Promise<Receipt> {
    const { chain, lab } = this.cfg;
    const raw = await chain.view<string | null>("get_spec", { market_id: m.id });
    if (!raw) throw new Error("spec not found");
    const spec = ClaimSpec.parse(JSON.parse(raw));
    if (specHash(spec) !== m.spec.spec_hash) throw new Error("stored spec does not match its hash");

    if (start) {
      const r = await chain.call(lab, "start_run", { market_id: m.id });
      this.cfg.log?.(`market ${m.id}: run started (${r.txHash})`);
    }

    const modelId = runIndex === 0 ? this.cfg.modelId : this.cfg.rerunModelId;
    const llm = new LlmClient(this.cfg.llm, this.cfg.mockResponderFor?.(spec));
    llm.newRun();
    const model = new NearAiModel(llm, modelId);
    const { receipt } = await reproduce(
      { spec, marketId: m.id, runIndex, labAccount: lab.accountId, labCodehash: this.cfg.labCodehash, labKeys: this.cfg.labKeys, methods: this.cfg.methodsFor?.(spec) },
      {
        sandbox: new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb }),
        model,
        newSandbox: () => new DockerSandbox({ image: sandboxImage(spec.artifact.runtime), cpus: spec.resources.cpu, memGb: spec.resources.mem_gb }),
        resolver: this.cfg.resolverFor(spec),
        dateInstall: true,
        store: this.cfg.store,
        emit: (e) => this.cfg.onEvent?.(m.id, e),
      },
    );

    await this.cfg.onAttestation?.(receipt.nearai.attestation_digest, model.attestationRecord());
    const method = runIndex === 0 ? "propose_result" : "propose_rerun_result";
    const r = await chain.call(lab, method, { receipt }, { deposit: RECEIPT_DEPOSIT_NEAR, tgas: 200 });
    this.cfg.log?.(`market ${m.id}: ${method} ${receipt.outcome} (${r.txHash})`);
    return receipt;
  }
}
