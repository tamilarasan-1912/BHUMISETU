import { sql } from 'kysely';
import { db, rawPool } from '../db/client.js';
import type { ParcelRecordSet } from '../domain/integrity-engine.js';

/**
 * Loads the complete record set for one or more parcels in a bounded number of
 * queries. All reads are parameterised; no string interpolation of user input.
 * Every row carries source/provenance columns so the UI can attribute values.
 */

type Row = Record<string, unknown>;

async function q<T extends Row>(text: string, params: unknown[]): Promise<T[]> {
  const res = await rawPool.query(text, params);
  return res.rows as T[];
}

export async function loadRecordSets(parcelIds: string[]): Promise<ParcelRecordSet[]> {
  if (parcelIds.length === 0) return [];

  const idList = parcelIds;
  const parcels = await q<Row>(
    `SELECT p.*, 
            (SELECT jsonb_agg(jsonb_build_object('scheme', i.scheme, 'value', i.value,
               'isPrimary', i.is_primary, 'isOfficial', i.is_official, 'note', i.note))
             FROM parcel_identifiers i WHERE i.parcel_id = p.parcel_id) AS identifiers
     FROM parcels p
     WHERE p.parcel_id = ANY($1::text[])
     ORDER BY p.parcel_id`,
    [idList],
  );

  const [
    geometries,
    rorRecords,
    revenueRecords,
    registrations,
    deeds,
    encumbrances,
    mortgages,
    taxRecords,
    buildingPermissions,
    observations,
    judiciaryCases,
    escalatedCases,
  ] = await Promise.all([
    q<Row>(`SELECT * FROM parcel_geometries WHERE parcel_id = ANY($1::text[]) AND valid_to IS NULL`, [idList]),
    q<Row>(`SELECT * FROM ror_records WHERE parcel_id = ANY($1::text[]) ORDER BY recorded_at DESC`, [idList]),
    q<Row>(`SELECT * FROM revenue_records WHERE parcel_id = ANY($1::text[]) ORDER BY recorded_at DESC`, [idList]),
    q<Row>(`SELECT * FROM registrations WHERE parcel_id = ANY($1::text[]) ORDER BY registration_date DESC NULLS LAST`, [idList]),
    q<Row>(`SELECT * FROM deeds WHERE parcel_id = ANY($1::text[]) ORDER BY execution_date DESC NULLS LAST`, [idList]),
    q<Row>(`SELECT * FROM encumbrances WHERE parcel_id = ANY($1::text[])`, [idList]),
    q<Row>(`SELECT * FROM mortgages WHERE parcel_id = ANY($1::text[])`, [idList]),
    q<Row>(`SELECT * FROM tax_records WHERE parcel_id = ANY($1::text[]) ORDER BY recorded_at DESC`, [idList]),
    q<Row>(`SELECT * FROM building_permissions WHERE parcel_id = ANY($1::text[]) ORDER BY approval_date DESC NULLS LAST`, [idList]),
    q<Row>(`SELECT * FROM satellite_observations WHERE parcel_id = ANY($1::text[]) ORDER BY capture_date DESC`, [idList]),
    q<Row>(`SELECT * FROM judiciary_cases WHERE parcel_id = ANY($1::text[]) ORDER BY filing_date DESC NULLS LAST`, [idList]),
    q<Row>(
      `SELECT case_id, case_number, parcel_id FROM verification_cases
       WHERE parcel_id = ANY($1::text[]) AND status = 'ESCALATED'`,
      [idList],
    ),
  ]);

  const byParcel = <T extends Row>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r.parcel_id);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };

  const gMap = new Map(geometries.map((g) => [String(g.parcel_id), g]));
  const rorMap = byParcel(rorRecords);
  const revMap = byParcel(revenueRecords);
  const regMap = byParcel(registrations);
  const deedMap = byParcel(deeds);
  const encMap = byParcel(encumbrances);
  const mortMap = byParcel(mortgages);
  const taxMap = byParcel(taxRecords);
  const bpMap = byParcel(buildingPermissions);
  const obsMap = byParcel(observations);
  const judMap = byParcel(judiciaryCases);
  const escMap = byParcel(escalatedCases);

  return parcels.map((p) => {
    const id = String(p.parcel_id);
    return {
      parcel: p as unknown as ParcelRecordSet['parcel'],
      geometry: (gMap.get(id) as unknown as ParcelRecordSet['geometry']) ?? null,
      rorRecords: (rorMap.get(id) ?? []) as unknown as ParcelRecordSet['rorRecords'],
      revenueRecords: (revMap.get(id) ?? []) as unknown as ParcelRecordSet['revenueRecords'],
      registrations: (regMap.get(id) ?? []) as unknown as ParcelRecordSet['registrations'],
      deeds: (deedMap.get(id) ?? []) as unknown as ParcelRecordSet['deeds'],
      encumbrances: (encMap.get(id) ?? []) as unknown as ParcelRecordSet['encumbrances'],
      mortgages: (mortMap.get(id) ?? []) as unknown as ParcelRecordSet['mortgages'],
      taxRecords: (taxMap.get(id) ?? []) as unknown as ParcelRecordSet['taxRecords'],
      buildingPermissions: (bpMap.get(id) ?? []) as unknown as ParcelRecordSet['buildingPermissions'],
      observations: (obsMap.get(id) ?? []) as unknown as ParcelRecordSet['observations'],
      judiciaryCases: (judMap.get(id) ?? []) as unknown as ParcelRecordSet['judiciaryCases'],
      escalatedCases: (escMap.get(id) ?? []) as unknown as ParcelRecordSet['escalatedCases'],
    };
  });
}

export interface ParcelListFilters {
  district?: string;
  village?: string;
  taluk?: string;
  q?: string;
  risk?: string;
  linkage?: string;
  limit: number;
  offset: number;
}

export async function listParcels(filters: ParcelListFilters) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.district) {
    params.push(filters.district);
    where.push(`p.district = $${params.length}`);
  }
  if (filters.village) {
    params.push(filters.village);
    where.push(`p.village = $${params.length}`);
  }
  if (filters.taluk) {
    params.push(filters.taluk);
    where.push(`p.taluk = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    const i = params.length;
    where.push(`(
      lower(p.parcel_id) LIKE $${i} OR lower(p.display_id) LIKE $${i} OR
      lower(p.village) LIKE $${i} OR lower(p.district) LIKE $${i} OR
      lower(coalesce(p.survey_number,'')) LIKE $${i} OR
      EXISTS (SELECT 1 FROM ror_records r WHERE r.parcel_id = p.parcel_id AND lower(coalesce(r.owner_name,'')) LIKE $${i}) OR
      EXISTS (SELECT 1 FROM tax_records t WHERE t.parcel_id = p.parcel_id AND lower(coalesce(t.owner_name,'')) LIKE $${i})
    )`);
  }

  const whereSql = where.join(' AND ');
  const countRes = await q<{ total: string }>(
    `SELECT count(*)::text AS total FROM parcels p WHERE ${whereSql}`,
    params,
  );
  params.push(filters.limit, filters.offset);
  const rows = await q<Row>(
    `SELECT p.*, 
            (SELECT count(*) FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') AS finding_count,
            (SELECT jsonb_agg(jsonb_build_object('ruleCode', f.rule_code, 'severity', f.severity, 'status', f.status))
               FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') AS findings
     FROM parcels p WHERE ${whereSql}
     ORDER BY p.parcel_id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: Number(countRes[0]?.total ?? 0) };
}

export async function findByAnyIdentifier(term: string): Promise<string[]> {
  const rows = await q<{ parcel_id: string }>(
    `SELECT DISTINCT parcel_id FROM (
       SELECT parcel_id FROM parcels WHERE
         lower(parcel_id) = lower($1) OR lower(display_id) = lower($1) OR
         lower(coalesce(survey_number,'')) = lower($1) OR lower(village||'-'||coalesce(survey_number,'')) = lower($1)
       UNION
       SELECT parcel_id FROM parcel_identifiers WHERE lower(value) = lower($1)
     ) t`,
    [term],
  );
  return rows.map((r) => r.parcel_id);
}

export async function districtsWithCounts() {
  return q<{ district: string; total: string; villages: string }>(
    `SELECT district, count(*)::text AS total, count(DISTINCT village)::text AS villages
     FROM parcels GROUP BY district ORDER BY district`,
    [],
  );
}

export async function auditCount() {
  return q<{ total: string }>(`SELECT count(*)::text AS total FROM audit_logs`, []);
}

export { db, sql };
