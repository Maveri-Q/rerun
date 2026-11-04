"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Loads data and refreshes it on an interval. `refresh()` reloads straight after a transaction.
 * It doesn't re-render when the answer is unchanged, and pauses while the tab is hidden, so polling
 * can't make a phone lag. With `cacheKey`, the last answer shows at once while a fresh one loads.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 0, cacheKey?: string) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const value = await latest.current();
      const text = JSON.stringify(value) ?? "null";
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
      if (cached !== undefined) setData(cached);
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
