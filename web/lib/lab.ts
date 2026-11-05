"use client";

import { useEffect, useRef, useState } from "react";
import { LAB_URL } from "./config";

export interface StageEvent {
  stage: string;
  message: string;
  diff?: string;
  at: number;
}

export interface LabHealth {
  ok: boolean;
  dry_run: boolean;
  network: string;
  account: string;
  codehash: string;
  model: string;
  mock_llm: boolean;
  tee: boolean;
}

export interface Evidence {
  note: string;
  robustness: {
    status: "stable" | "sensitive" | "could_not_complete" | "not_attempted";
    reason?: string;
    seed_had_effect?: boolean;
    measured?: string;
    runs: { kind: "seed" | "resample"; label: string; value: string | null }[];
  };
  reimplementation: {
    status: "agrees" | "differs" | "could_not_complete" | "not_attempted";
    reason?: string;
    value?: string;
    model?: string;
    script?: string;
  };
}

export const evidenceHashIn = (report: string): string | null => /Evidence file sha256: ([0-9a-f]{64})/.exec(report)?.[1] ?? null;

export interface AttestationCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface QuoteVerification {
  role: "gateway" | "model";
  signingAddress: string;
  tcbStatus?: string;
  composeHash?: string;
  checks: AttestationCheck[];
  ok: boolean;
}

export interface AttestationRecord {
  digest: string;
  recorded_at: number;
  mock: boolean;
  model: string;
  reports: { nonce: string; gateway: QuoteVerification; models: QuoteVerification[]; ok: boolean }[];
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${LAB_URL}${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface ScoutCandidate {
  id: string;
  source: string;
  title: string;
  paperUrl: string;
  repoUrl: string | null;
  status: "pending" | "rejected" | "retry" | "approved";
  reasons: string[];
  checkedAt: string;
  license?: string | null;
  runtime?: string | null;
  marketId?: number;
  attention?: { source: string; label: string; value: number };
  interest?: number;
  draft?: {
    question: string;
    topic: string;
    relatability: number;
    relatability_why: string;
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
  };
}

export const lab = {
  /** From the Lab if it's on, otherwise the log the scheduled scan publishes with the site. */
  scout: async () => {
    const res = await fetch(`${LAB_URL}/scout`).catch(() => null);
    const live = res?.ok ? res : await fetch("/scout.json");
    if (!live.ok) throw new Error(`no scout log (${live.status})`);
    return (await live.json()) as { lastScanAt: string | null; candidates: Record<string, ScoutCandidate> };
  },
  async suggest(repoUrl: string, paperUrl: string): Promise<string> {
    const res = await fetch(`${LAB_URL}/suggestions`, { method: "POST", body: JSON.stringify({ repo_url: repoUrl, paper_url: paperUrl }) });
    const body = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? "The Lab didn't take that suggestion.");
    return body.message!;
  },
  async scoutApproved(id: string, marketId: number): Promise<void> {
    const res = await fetch(`${LAB_URL}/scout/${encodeURIComponent(id)}/approved`, { method: "POST", body: JSON.stringify({ market_id: marketId }) });
    if (!res.ok) throw new Error(`The claim is open, but the Lab couldn't mark the suggestion as approved (${res.status}).`);
  },
  /** Opens a short demo claim, or finds the one already open. Throws a message fit to show. */
  async tryNow(): Promise<number> {
    const res = await fetch(`${LAB_URL}/try`, { method: "POST" }).catch(() => null);
    if (!res) throw new Error("The Lab is offline, so a new demo can't start. Finished claims below still show their proof.");
    const body = (await res.json().catch(() => ({}))) as { market_id?: number; error?: string };
    if (!res.ok || body.market_id === undefined) throw new Error(body.error ?? "The Lab couldn't open a demo claim. Try again in a minute.");
    return body.market_id;
  },
  health: () => get<LabHealth>("/health"),
  attestation: (digest: string) => get<AttestationRecord>(`/attestations/${digest}`),
  latestAttestation: () => get<AttestationRecord>("/attestations/latest"),
  recentRuns: () => get<{ run: string; event: StageEvent }[]>("/runs?limit=12"),
  async report(hash: string): Promise<string | null> {
    try {
      const res = await fetch(`${LAB_URL}/reports/${hash}`);
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  },
  /** The evidence file named inside a report, if there is one. */
  async evidenceForReport(reportHash: string): Promise<Evidence | null> {
    const report = await lab.report(reportHash);
    const hash = report && evidenceHashIn(report);
    return hash ? get<Evidence>(`/evidence/${hash}`) : null;
  },
  async saveMethods(specHash: string, methods: string): Promise<void> {
    await fetch(`${LAB_URL}/methods`, { method: "POST", body: JSON.stringify({ spec_hash: specHash, methods }) }).catch(() => {});
  },
  async uploadSealed(bytes: Uint8Array): Promise<string> {
    const res = await fetch(`${LAB_URL}/sealed`, { method: "POST", body: bytes as BodyInit });
    if (!res.ok) throw new Error("The Lab did not accept the encrypted file.");
    return ((await res.json()) as { ref: string }).ref;
  },
  async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${LAB_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new Error("The Lab is not reachable right now.");
    }
    const parsed = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(parsed.error ?? `The Lab answered ${res.status}.`);
    return parsed;
  },
};

export type StreamStatus = "connecting" | "live" | "offline";

/** Follows a run: replays what already happened, then stays open for live stages. */
export function useRunStream(run: string | null) {
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  /** True once the viewer has watched at least one event arrive live, not from the replay. */
  const [liveSeen, setLiveSeen] = useState(false);
  const opened = useRef(0);

  useEffect(() => {
    if (!run) return;
    setEvents([]);
    setStatus("connecting");
    setLiveSeen(false);
    opened.current = Date.now();
    const source = new EventSource(`${LAB_URL}/runs/${run}/stream`);
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    source.onmessage = (m) => {
      const e = JSON.parse(m.data as string) as StageEvent;
      setEvents((prev) => (prev.some((p) => p.at === e.at && p.message === e.message) ? prev : [...prev, e]));
      if (e.at > opened.current) setLiveSeen(true);
    };
    return () => source.close();
  }, [run]);

  return { events, status, liveSeen };
}
