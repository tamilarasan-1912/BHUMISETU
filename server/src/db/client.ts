import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on('error', (err) => {
  // A pooled connection dying must not take the process down.
  console.error('[db] idle client error:', err.message);
});

export const db = new Kysely<Record<string, never>>({
  dialect: new PostgresDialect({ pool }),
});

export const rawPool = pool;

export type Sql = typeof sql;

export async function pingDatabase(): Promise<{ ok: boolean; version?: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const res = await pool.query('select version() as version');
    return {
      ok: true,
      version: String(res.rows[0]?.version ?? '').split(' ').slice(0, 2).join(' '),
      latencyMs: Date.now() - started,
    };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

export async function hasPostgis(): Promise<boolean> {
  try {
    const res = await pool.query("select 1 from pg_extension where extname = 'postgis'");
    return res.rowCount === 1;
  } catch {
    return false;
  }
}
