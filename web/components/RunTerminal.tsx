"use client";

import { useEffect, useRef } from "react";
import type { StageEvent, StreamStatus } from "@/lib/lab";

const STAGE_LABEL: Record<string, string> = {
  attesting: "safety check",
  fetching: "downloading",
  verifying_hashes: "checking data",
  installing: "setting up",
  decrypting: "unlocking",
  running: "running",
  repairing: "fixing setup",
  extracting: "reading result",
  comparing: "comparing",
  stress_testing: "stress test",
  reimplementing: "rebuilding",
  reporting: "writing up",
  done: "verdict",
};

/** The Lab's notebook, live: what it is doing as it does it. Private-data content is never streamed. */
export function RunTerminal({ events, status, waitingText }: { events: StageEvent[]; status: StreamStatus; waitingText: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const finished = events.at(-1)?.stage === "done";
  const barText = status === "offline" ? "Lab not reachable" : finished ? "Run finished" : events.length ? "Running now" : status === "live" ? "Connected to the Lab" : "Connecting to the Lab";

  return (
    <div className="terminal" ref={box} aria-live="polite" aria-label="Live re-run log" tabIndex={0}>
      <div className="terminal-bar">
        <span>
          {status === "live" && !finished && <span className="live-dot" aria-hidden="true" />}
          {barText}
        </span>
        <span>{events.length} entries</span>
      </div>
      {events.length === 0 ? (
        <p style={{ margin: 0 }}>{status === "offline" ? "The Lab's stream is not available right now. Results still appear here from the chain." : waitingText}</p>
      ) : (
        <ol>
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <time>{new Date(e.at).toLocaleTimeString(undefined, { hour12: false })}</time>
              <span className="stage">{STAGE_LABEL[e.stage] ?? e.stage}</span>
              <span>{e.message}</span>
              {e.diff && <pre>{e.diff.trim()}</pre>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
