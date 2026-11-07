"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SeedContext } from "./seed-context";

const CACHE_PREFIX = "rerun.cache.";

function readCache<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, text: string) {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, text);
  } catch {
    // Storage can be full or blocked. The page still works, it just loads from the network next time.
  }
}

/** Text to compare answers by. Balances are bigints, which plain JSON refuses, and that would lose the answer. */
export function answerText(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) ?? "null";
}

/**
 * Loads data and refreshes it on an interval. `refresh()` reloads straight after a transaction.
 * It doesn't re-render when the answer is unchanged, and pauses while the tab is hidden, so polling
 * can't make a phone lag. With `cacheKey`, the last answer shows at once while a fresh one loads, and
 * an answer the server already read (see Seed) is in the first HTML, for people and tools with no JavaScript.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 0, cacheKey?: string) {
  const seeded = useContext(SeedContext);
  const seed = cacheKey ? (seeded[cacheKey] as T | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(seed);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const value = await latest.current();
      const text = answerText(value);
      if (text !== seen.current) {
        seen.current = text;
        setData(value);
        if (cacheKey) writeCache(cacheKey, text);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    setLoading(true);
    seen.current = null;
    if (cacheKey) {
      const cached = readCache<T>(cacheKey);
      if (cached !== undefined && seed === undefined) setData(cached);
    }
    void refresh();
    if (!intervalMs) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, refresh, cacheKey]);

  return { data, error, loading, refresh };
}
