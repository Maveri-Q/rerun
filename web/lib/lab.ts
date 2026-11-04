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

export const lab = {
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
