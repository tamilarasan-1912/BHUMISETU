import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  /** Refetches the resource. Use after a mutation to keep views consistent. */
  reload: () => void;
  /** True while a background reload is in flight and previous data is shown. */
  refreshing: boolean;
}

/**
 * Data-fetching hook with abort handling, a manual reload, and a distinction
 * between the first load (no data yet) and a refresh (data already on screen).
 * Every consumer therefore has the information needed to render a skeleton,
 * a stale-while-refreshing view, or an error state rather than a blank page.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const hasLoaded = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);
    setError(null);

    fnRef
      .current(controller.signal)
      .then((result) => {
        setData(result);
        hasLoaded.current = true;
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error('Unknown error'));
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload, refreshing };
}

/** Debounces a rapidly-changing value such as a search box. */
export function useDebounced<T>(value: T, delayMs = 320): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Persists a small piece of UI state the way a user would expect across visits. */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set];
}

/** Tracks whether the viewport is at or below a breakpoint, for map sizing. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
