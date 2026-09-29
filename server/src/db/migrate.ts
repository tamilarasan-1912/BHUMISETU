import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rawPool } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies the idempotent schema. `--reset` drops the BHUMISETU schema objects
 * (development convenience only) before reapplying. Normal deploys never drop
 * anything, so existing data survives a restart or rolling deploy.
 */
export async function migrate(opts: { reset?: boolean; quiet?: boolean } = {}): Promise<void> {
  const sqlText = await readFile(path.join(here, 'schema.sql'), 'utf8');
  const client = await rawPool.connect();
  try {
    if (opts.reset) {
      // Development-only reset. Drops exactly the objects this application owns.
      // PostGIS-managed relations (spatial_ref_sys, geography_columns,
      // geometry_columns, raster_columns, ...) are never touched: they belong to
      // the extension, not to BHUMISETU.
      const owned = [
        // views first
        'v_case_load', 'v_parcel_risk',
        // then tables (CASCADE resolves FKs)
        'quality_metrics', 'ingestion_runs', 'analytics_snapshots',
        'authority_mappings', 'workflow_definitions', 'rule_definitions',
        'audit_logs', 'temporal_versions', 'consent_records',
        'service_request_events', 'service_requests',
        'case_assignments', 'case_comments', 'case_events', 'verification_cases',
        'integrity_evidence', 'integrity_findings',
        'context_snapshots', 'gis_features', 'gis_layers',
        'change_detections', 'satellite_observations',
        'parcel_documents', 'documents',
        'judiciary_events', 'judiciary_cases',
        'building_approvals', 'building_permissions', 'planning_records',
        'land_use', 'zoning', 'master_plans',
        'property_tax_records', 'tax_records',
        'mortgages', 'encumbrances',
        'deeds', 'registration_documents', 'registrations',
        'ror_records', 'revenue_records',
        'interests', 'restrictions', 'rights', 'ownerships',
        'party_addresses', 'parties',
        'parcel_versions', 'parcel_geometries', 'parcel_identifiers', 'parcels',
        'administrative_units',
        'source_runs', 'data_sources',
        'notifications', 'sessions', 'users',
        'role_permissions', 'permissions', 'roles',
      ];
      await client.query(`
        DO $$
        DECLARE r text;
        BEGIN
          FOREACH r IN ARRAY ARRAY[${owned.map((t) => `'${t}'`).join(',')}]::text[]
          LOOP
            EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r);
            EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r);
          END LOOP;
        END $$;
      `);
      if (!opts.quiet) console.log('[migrate] schema reset (application objects only)');
    }
    await client.query(sqlText);
    if (!opts.quiet) console.log('[migrate] schema applied');
  } finally {
    client.release();
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const reset = process.argv.includes('--reset');
  migrate({ reset })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
