import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Fetch immediately, then poll on an interval while `enabled` is true.
 * The interval is cleaned up on unmount / when deps change.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  intervalMs: number = DEFAULT_INTERVAL_MS,
  enabled: boolean = true
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    setLoading(true);
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, load, ...deps]);

  return { data, loading, error, refetch: load };
}
