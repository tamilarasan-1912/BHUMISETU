import type { PoolClient } from 'pg';

/**
 * Transaction-scoped advisory lock. Used to make human-readable reference
 * numbers (case numbers, service-request references) collision-free under
 * concurrency without exposing a table-level lock.
 */
export async function advisoryLock(client: PoolClient, key: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
}
