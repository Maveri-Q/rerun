"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Loads data and refreshes it on an interval. `refresh()` reloads straight after a transaction. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 0) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;

  const refresh = useCallback(async () => {
    try {
      const value = await latest.current();
      setData(value);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    if (!intervalMs) return;
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
