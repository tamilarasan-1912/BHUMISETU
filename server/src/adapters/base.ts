import { config } from '../config.js';
import { rawPool } from '../db/client.js';

/* -------------------------------------------------------------------------- */
/* Adapter contract                                                           */
/* -------------------------------------------------------------------------- */

export interface AdapterHealth {
  sourceId: string;
  status:
    | 'CONNECTED'
    | 'AVAILABLE'
    | 'ADAPTER_READY'
    | 'UPSTREAM_UNAVAILABLE'
    | 'REQUIRES_AUTH'
    | 'DEMO_DATA'
    | 'NOT_CONFIGURED';
  reachable: boolean;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  requiresAuth: boolean;
  configured: boolean;
}

export interface SourceMetadata {
  sourceId: string;
  name: string;
  organization: string;
  authority: string;
  licenceNote: string;
  isAuthoritative: boolean;
  isContextual: boolean;
  isDerived: boolean;
  isDemonstration: boolean;
  url: string;
}

/**
 * Every external integration implements this surface. `health()` must never
 * throw: an unreachable upstream is a *reported state*, not an application
 * failure. Core parcel workflow does not depend on any adapter being reachable.
 */
export interface DataAdapter {
  sourceId: string;
  sourceMetadata(): SourceMetadata;
  /** Runs a probe (subject to the snapshot cache at the registry boundary). */
  health(): Promise<AdapterHealth>;
  /** Synchronous read of the last snapshot; never touches the network. */
  cachedHealth?(): AdapterHealth | null;
  lastSync(): Promise<{ lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null }>;
}

/* -------------------------------------------------------------------------- */
/* Cache (external calls are never made on every render)                      */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  fetchedAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export interface CachedResult<T> {
  data: T;
  cacheHit: boolean;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > now) {
    return {
      data: hit.value as T,
      cacheHit: true,
      fetchedAt: new Date(hit.fetchedAt).toISOString(),
      expiresAt: new Date(hit.expiresAt).toISOString(),
      stale: false,
    };
  }

  // Single-flight: concurrent identical requests share one upstream call.
  const existing = inflight.get(key);
  if (existing) {
    const data = (await existing) as T;
    const e = memoryCache.get(key);
    return {
      data,
      cacheHit: true,
      fetchedAt: new Date(e?.fetchedAt ?? now).toISOString(),
      expiresAt: new Date(e?.expiresAt ?? now + ttlMs).toISOString(),
      stale: false,
    };
  }

  const p = loader();
  inflight.set(key, p);
  try {
    const data = await p;
    memoryCache.set(key, { value: data, expiresAt: now + ttlMs, fetchedAt: now });
    return {
      data,
      cacheHit: false,
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      stale: false,
    };
  } catch (err) {
    // Serve a stale entry rather than failing, when one exists.
    if (hit) {
      return {
        data: hit.value as T,
        cacheHit: true,
        fetchedAt: new Date(hit.fetchedAt).toISOString(),
        expiresAt: new Date(hit.expiresAt).toISOString(),
        stale: true,
      };
    }
    throw err;
  } finally {
    inflight.delete(key);
  }
}

export function clearCache(prefix?: string) {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const k of [...memoryCache.keys()]) if (k.startsWith(prefix)) memoryCache.delete(k);
}

/* -------------------------------------------------------------------------- */
/* Health snapshot cache                                                      */
/* -------------------------------------------------------------------------- */

interface HealthSnapshot {
  value: AdapterHealth;
  expiresAt: number;
  checkedAt: number;
  refreshing: boolean;
}

const healthCache = new Map<string, HealthSnapshot>();

/**
 * Adapters that have never been probed return an immediate "not yet checked"
 * record instead of blocking the request. The first call schedules a background
 * refresh; subsequent calls read the cached snapshot.
 */
export const UNPROBED_DETAIL =
  'Status not yet checked in this process. A background probe has been scheduled; core parcel workflow does not depend on this source.';

export function cachedHealth(
  sourceId: string,
  ttlMs: number,
  probe: () => Promise<AdapterHealth>,
): AdapterHealth {
  const now = Date.now();
  const entry = healthCache.get(sourceId);
  if (entry && entry.expiresAt > now) return entry.value;

  if (!entry) {
    const placeholder: AdapterHealth = {
      sourceId,
      status: 'NOT_CONFIGURED',
      reachable: false,
      latencyMs: null,
      detail: UNPROBED_DETAIL,
      checkedAt: new Date(now).toISOString(),
      lastSuccessAt: null,
      requiresAuth: false,
      configured: false,
    };
    healthCache.set(sourceId, { value: placeholder, expiresAt: now, checkedAt: now, refreshing: true });
    void probe()
      .then((health) => {
        healthCache.set(sourceId, {
          value: health,
          expiresAt: Date.now() + ttlMs,
          checkedAt: Date.now(),
          refreshing: false,
        });
      })
      .catch(() => {
        healthCache.delete(sourceId);
      });
    return placeholder;
  }

  if (!entry.refreshing) {
    entry.refreshing = true;
    void probe()
      .then((health) => {
        healthCache.set(sourceId, {
          value: health,
          expiresAt: Date.now() + ttlMs,
          checkedAt: Date.now(),
          refreshing: false,
        });
      })
      .catch(() => {
        entry.refreshing = false;
      });
  }
  return entry.value;
}

/** Synchronous snapshot read; returns null when the source has never been probed. */
export function readHealthSnapshot(sourceId: string): AdapterHealth | null {
  const entry = healthCache.get(sourceId);
  if (!entry) return null;
  if (entry.expiresAt > Date.now()) return entry.value;
  // A stale snapshot is still more useful than nothing; the refresh is already
  // scheduled and the caller must not be made to wait for it.
  return entry.value;
}

/**
 * Record a freshly probed health result in the shared snapshot cache. Used by
 * the explicit refresh path so a forced probe also benefits subsequent
 * non-forced status reads.
 */
export function putHealthSnapshot(sourceId: string, health: AdapterHealth, ttlMs: number): void {
  healthCache.set(sourceId, { value: health, expiresAt: Date.now() + ttlMs, checkedAt: Date.now(), refreshing: false });
}

export function healthCacheStats() {
  return { entries: healthCache.size, probed: [...healthCache.values()].filter((h) => h.expiresAt > Date.now()).length };
}

export function cacheStats() {
  const now = Date.now();
  let live = 0;
  let stale = 0;
  for (const v of memoryCache.values()) (v.expiresAt > now ? live++ : stale++);
  return { entries: memoryCache.size, live, stale };
}

/* -------------------------------------------------------------------------- */
/* HTTP with timeout + retry + graceful failure                              */
/* -------------------------------------------------------------------------- */

export interface HttpResult<T> {
  ok: boolean;
  status: number | null;
  data: T | null;
  error: string | null;
  latencyMs: number;
  attempts: number;
}

export async function httpJson<T>(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    retries?: number;
    accept?: string;
    parseAs?: 'json' | 'text';
  } = {},
): Promise<HttpResult<T>> {
  const timeoutMs = opts.timeoutMs ?? config.adapterTimeoutMs;
  const retries = opts.retries ?? config.adapterRetries;
  const started = Date.now();
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          accept: opts.accept ?? 'application/json',
          'user-agent': 'BHUMISETU/1.0 (land-governance platform; adapter health probe)',
          ...(opts.headers ?? {}),
        },
        body: opts.body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        // 4xx other than 429 will not improve on retry.
        if (res.status < 500 && res.status !== 429) {
          return { ok: false, status: res.status, data: null, error: lastError, latencyMs: Date.now() - started, attempts: attempt };
        }
        continue;
      }
      const text = await res.text();
      let data: unknown = text;
      if ((opts.parseAs ?? 'json') === 'json') {
        try {
          data = text.length > 0 ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
      }
      return {
        ok: true,
        status: res.status,
        data: data as T,
        error: null,
        latencyMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg.includes('abort') ? `timeout after ${timeoutMs}ms` : msg;
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }
  return { ok: false, status: null, data: null, error: lastError, latencyMs: Date.now() - started, attempts: retries + 1 };
}

/* -------------------------------------------------------------------------- */
/* Adapter run recording                                                      */
/* -------------------------------------------------------------------------- */

export async function recordRun(
  sourceId: string,
  operation: string,
  status: 'OK' | 'FAILED' | 'SKIPPED',
  startedAt: number,
  opts: { error?: string | null; records?: number; cacheHit?: boolean } = {},
): Promise<void> {
  const latency = Date.now() - startedAt;
  try {
    await rawPool.query(
      `INSERT INTO source_runs (source_id, operation, status, latency_ms, records, error, cache_hit, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [sourceId, operation, status, latency, opts.records ?? null, opts.error ?? null, opts.cacheHit ?? false],
    );
    if (status === 'OK') {
      await rawPool.query(
        `UPDATE data_sources SET last_checked_at = now(), last_success_at = now(),
           latency_ms = $2, last_error = NULL, updated_at = now() WHERE source_id = $1`,
        [sourceId, latency],
      );
    } else if (status === 'FAILED') {
      await rawPool.query(
        `UPDATE data_sources SET last_checked_at = now(), last_error_at = now(),
           last_error = $2, latency_ms = $3, updated_at = now() WHERE source_id = $1`,
        [sourceId, opts.error ?? 'unknown error', latency],
      );
    } else {
      await rawPool.query(
        `UPDATE data_sources SET last_checked_at = now(), latency_ms = $2, updated_at = now() WHERE source_id = $1`,
        [sourceId, latency],
      );
    }
  } catch {
    // Observability must never break the request path.
  }
}

export async function getLastSync(sourceId: string) {
  const res = await rawPool.query(
    `SELECT last_checked_at, last_success_at, last_error FROM data_sources WHERE source_id = $1`,
    [sourceId],
  );
  const r = res.rows[0];
  return {
    lastAttemptAt: r?.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
    lastSuccessAt: r?.last_success_at ? new Date(r.last_success_at).toISOString() : null,
    lastError: r?.last_error ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Rate limiting (protects upstream services and our own request budget)      */
/* -------------------------------------------------------------------------- */

const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export function takeToken(key: string, perMinute: number): boolean {
  const now = Date.now();
  const refillRate = perMinute / 60_000;
  const b = buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
  const elapsed = now - b.updatedAt;
  b.tokens = Math.min(perMinute, b.tokens + elapsed * refillRate);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
