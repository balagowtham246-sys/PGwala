import { useCallback, useEffect, useRef, useState } from 'react';
import { endTrace, startTrace } from '@/lib/perf-monitor';
import {
  DEFAULT_CACHE_TTL_MS,
  getCachedEntry,
  setCached,
  subscribeCache,
} from '@/lib/query-cache';
import { AppError, normalizeAppError } from '@/lib/service-result';

export interface UseCachedQueryOptions<T> {
  cacheKey: string | null;
  fetcher: () => Promise<T>;
  ttlMs?: number;
  enabled?: boolean;
  traceLabel?: string;
}

export interface UseCachedQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  error: AppError | null;
  refetch: (options?: { forceNetwork?: boolean }) => Promise<T | null>;
}

export function useCachedQuery<T>({
  cacheKey,
  fetcher,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  enabled = true,
  traceLabel,
}: UseCachedQueryOptions<T>): UseCachedQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(enabled && cacheKey));
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [error, setError] = useState<AppError | null>(null);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const executeQuery = useCallback(
    async (options?: { forceNetwork?: boolean; silentCache?: boolean }): Promise<T | null> => {
      if (!enabled || !cacheKey) {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
        return null;
      }

      const activeTrace = traceLabel ?? cacheKey;
      startTrace(activeTrace);
      let hadCacheHit = false;

      if (!options?.forceNetwork && !options?.silentCache) {
        const cached = await getCachedEntry<T>(cacheKey);
        if (cached && mountedRef.current) {
          hadCacheHit = true;
          setData(cached.data);
          setIsStale(cached.isStale);
          setIsLoading(false);
          setError(null);
        }
      }

      if (mountedRef.current) {
        if (hadCacheHit || options?.forceNetwork) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
      }

      try {
        const fresh = await fetcherRef.current();
        await setCached(cacheKey, fresh, ttlMs);
        if (mountedRef.current) {
          setData(fresh);
          setIsStale(false);
          setError(null);
        }
        return fresh;
      } catch (err) {
        if (mountedRef.current) {
          setError(normalizeAppError(err));
        }
        return null;
      } finally {
        endTrace(activeTrace);
        if (mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [cacheKey, enabled, ttlMs, traceLabel]
  );

  useEffect(() => {
    if (!enabled || !cacheKey) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (!cancelled) {
        void executeQuery();
      }
    }, 0);

    const unsubscribe = subscribeCache(cacheKey, () => {
      if (cancelled) return;
      void getCachedEntry<T>(cacheKey).then((entry) => {
        if (cancelled || !mountedRef.current || !entry) return;
        setData(entry.data);
        setIsStale(entry.isStale);
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [cacheKey, enabled, executeQuery]);

  const refetch = useCallback(
    (options?: { forceNetwork?: boolean }) =>
      executeQuery({ forceNetwork: options?.forceNetwork ?? true }),
    [executeQuery]
  );

  return {
    data,
    isLoading,
    isRefreshing,
    isStale,
    error,
    refetch,
  };
}
