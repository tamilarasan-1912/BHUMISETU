import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rawPool } from './client.js';
import { migrate } from './migrate.js';
import { ROLES, PERMISSIONS } from '../data/roles.js';
import { SOURCE_CATALOGUE, LAYER_CATALOGUE } from '../data/source-catalogue.js';
import { RULES } from '../domain/rules.js';
import { PARCEL_FIXTURES, fixtureGeometry, sqftToSqm } from '../data/parcel-fixtures.js';
import { randomUUID } from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* Demo users                                                                 */
/* -------------------------------------------------------------------------- */

export const DEMO_USERS = [
  {
    username: 'citizen',
    fullName: 'Demo Citizen',
    role: 'CITIZEN',
    email: 'citizen@demo.bhumisetu.local',
    password: 'citizen@123',
    district: 'Chengalpattu',
    department: null,
  },
  {
    username: 'field',
    fullName: 'Demo Field Officer',
    role: 'FIELD_OFFICER',
    email: 'field@demo.bhumisetu.local',
    password: 'officer@123',
    district: 'Chengalpattu',
    department: 'Survey/GIS',
  },
  {
    username: 'revenue',
    fullName: 'Demo Revenue Officer',
    role: 'REVENUE_OFFICER',
    email: 'revenue@demo.bhumisetu.local',
    password: 'officer@123',
    district: 'Chengalpattu',
    department: 'Revenue',
  },
  {
    username: 'registration',
    fullName: 'Demo Registration Officer',
    role: 'REGISTRATION_OFFICER',
    email: 'registration@demo.bhumisetu.local',
    password: 'officer@123',
    district: 'Chennai',
    department: 'Registration',
  },
  {
    username: 'municipal',
    fullName: 'Demo Municipal Officer',
    role: 'MUNICIPAL_OFFICER',
    email: 'municipal@demo.bhumisetu.local',
    password: 'officer@123',
    district: 'Chennai',
    department: 'Municipal Tax',
  },
  {
    username: 'planning',
    fullName: 'Demo Planning Officer',
    role: 'PLANNING_OFFICER',
    email: 'planning@demo.bhumisetu.local',
    password: 'officer@123',
    district: 'Kanchipuram',
    department: 'Planning',
  },
  {
    username: 'gistadmin',
    fullName: 'Demo GIS Administrator',
    role: 'GIS_ADMIN',
    email: 'gis@demo.bhumisetu.local',
    password: 'admin@123',
    district: 'Chennai',
    department: 'Survey/GIS',
  },
  {
    username: 'admin',
    fullName: 'Demo System Administrator',
    role: 'SYSTEM_ADMIN',
    email: 'admin@demo.bhumisetu.local',
    password: 'admin@123',
    district: 'Chennai',
    department: 'Revenue',
  },
];

/** Masks a name for the citizen-safe view: "K. Meenakshi" -> "K. M•••••••". */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0];
    return p.length <= 2 ? `${p[0]}•` : `${p.slice(0, 2)}${'•'.repeat(Math.max(1, p.length - 2))}`;
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first} ${last[0]}${'•'.repeat(Math.max(1, last.length - 1))}`;
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

export async function seed(opts: { quiet?: boolean } = {}): Promise<void> {
  const log = (...a: unknown[]) => {
    if (!opts.quiet) console.log(...a);
  };
  await migrate({ quiet: true });
  const c = await rawPool.connect();
  try {
    await c.query('BEGIN');

    /* --- roles & permissions ------------------------------------------- */
    for (const p of PERMISSIONS) {
      await c.query(
        `INSERT INTO permissions (code, label, description) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description`,
        [p.code, p.label, p.description],
      );
    }
    for (const r of ROLES) {
      await c.query(
        `INSERT INTO roles (code, label, description, is_officer, is_admin) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description,
           is_officer=EXCLUDED.is_officer, is_admin=EXCLUDED.is_admin`,
        [r.code, r.label, r.description, r.isOfficer, r.isAdmin],
      );
      for (const pc of r.permissions) {
        await c.query(
          `INSERT INTO role_permissions (role_code, permission_code) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [r.code, pc],
        );
      }
      // Remove permissions no longer granted to a role so the seed stays declarative.
      await c.query(
        `DELETE FROM role_permissions WHERE role_code = $1 AND NOT (permission_code = ANY($2::text[]))`,
        [r.code, r.permissions],
      );
    }

    /* --- users ---------------------------------------------------------- */
    for (const u of DEMO_USERS) {
      const hash = bcrypt.hashSync(u.password, 10);
      await c.query(
        `INSERT INTO users (username, email, full_name, password_hash, role_code, district, department)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (username) DO UPDATE SET
           full_name = EXCLUDED.full_name, role_code = EXCLUDED.role_code,
           district = EXCLUDED.district, department = EXCLUDED.department, updated_at = now()`,
        [u.username, u.email, u.fullName, hash, u.role, u.district, u.department],
      );
    }

    /* --- data sources --------------------------------------------------- */
    for (const s of SOURCE_CATALOGUE) {
      await c.query(
        `INSERT INTO data_sources (source_id, name, organization, category, url, authority, status,
            capability, coverage, licence_note, is_authoritative, is_contextual, is_derived,
            is_demonstration, data_status, freshness_note, endpoint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (source_id) DO UPDATE SET
           name=EXCLUDED.name, organization=EXCLUDED.organization, category=EXCLUDED.category,
           url=EXCLUDED.url, authority=EXCLUDED.authority, capability=EXCLUDED.capability,
           coverage=EXCLUDED.coverage, licence_note=EXCLUDED.licence_note,
           is_authoritative=EXCLUDED.is_authoritative, is_contextual=EXCLUDED.is_contextual,
           is_derived=EXCLUDED.is_derived, is_demonstration=EXCLUDED.is_demonstration,
           data_status=EXCLUDED.data_status, freshness_note=EXCLUDED.freshness_note,
           endpoint=EXCLUDED.endpoint, updated_at = now()`,
        [
          s.sourceId, s.name, s.organization, s.category, s.url, s.authority, s.status,
          s.capability, s.coverage, s.licenceNote, s.isAuthoritative, s.isContextual,
          s.isDerived, s.isDemonstration, s.dataStatus, s.freshnessNote, s.endpoint ?? null,
        ],
      );
    }

    /* --- GIS layers ----------------------------------------------------- */
    for (const l of LAYER_CATALOGUE) {
      await c.query(
        `INSERT INTO gis_layers (layer_id, name, category, source_id, authority, service_type,
            service_url, attribution, default_opacity, default_visible, data_status, status, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (layer_id) DO UPDATE SET
           name=EXCLUDED.name, category=EXCLUDED.category, source_id=EXCLUDED.source_id,
           authority=EXCLUDED.authority, service_type=EXCLUDED.service_type,
           service_url=EXCLUDED.service_url, attribution=EXCLUDED.attribution,
           default_opacity=EXCLUDED.default_opacity, default_visible=EXCLUDED.default_visible,
           data_status=EXCLUDED.data_status, description=EXCLUDED.description, updated_at=now()`,
        [
          l.layerId, l.name, l.category, l.sourceId, l.authority, l.serviceType,
          l.serviceUrl ?? null, l.attribution, l.defaultOpacity, l.defaultVisible,
          l.dataStatus, l.status, l.description,
        ],
      );
    }

    /* --- rules & workflow ----------------------------------------------- */
    for (const r of RULES) {
      await c.query(
        `INSERT INTO rule_definitions (rule_code, title, description, severity, deduction,
            recommended_action, routed_authority, parameters)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (rule_code) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
           severity=EXCLUDED.severity, deduction=EXCLUDED.deduction,
           recommended_action=EXCLUDED.recommended_action, routed_authority=EXCLUDED.routed_authority,
           parameters=EXCLUDED.parameters, updated_at=now()`,
        [
          r.ruleCode, r.title, r.description, r.severity, r.deduction,
          r.recommendedAction, r.routedAuthority, JSON.stringify(r.parameters),
        ],
      );
      await c.query(
        `INSERT INTO authority_mappings (domain, rule_code, department, role_code, escalation, sla_days)
         SELECT $1, $2, $3, r.code, $4, $5
         FROM roles r WHERE r.code = $6
           AND NOT EXISTS (SELECT 1 FROM authority_mappings WHERE rule_code = $2 AND department = $3)`,
        [
          r.ruleCode.split('_')[0],
          r.ruleCode,
          r.routedAuthority,
          r.routedAuthority === 'Revenue' ? 'Revenue Officer' : `Additional ${r.routedAuthority} Officer`,
          r.severity === 'HIGH' ? 7 : 14,
          ROLE_CODE_FOR_DEPT[r.routedAuthority] ?? 'SYSTEM_ADMIN',
        ],
      );
    }
    await c.query(
      `INSERT INTO workflow_definitions (workflow_code, label, states, transitions, is_enabled)
       VALUES ('VERIFICATION_CASE','Verification case workflow',$1,$2,true)
       ON CONFLICT (workflow_code) DO UPDATE SET states=EXCLUDED.states,
         transitions=EXCLUDED.transitions, updated_at=now()`,
      [
        ['SUBMITTED', 'UNDER_REVIEW', 'FIELD_VERIFICATION', 'RESOLVED', 'ESCALATED'],
        JSON.stringify({
          SUBMITTED: ['UNDER_REVIEW', 'FIELD_VERIFICATION', 'ESCALATED', 'RESOLVED'],
          UNDER_REVIEW: ['FIELD_VERIFICATION', 'ESCALATED', 'RESOLVED'],
          FIELD_VERIFICATION: ['UNDER_REVIEW', 'ESCALATED', 'RESOLVED'],
          ESCALATED: ['UNDER_REVIEW', 'RESOLVED'],
          RESOLVED: [],
        }),
      ],
    );
    await c.query(
      `INSERT INTO workflow_definitions (workflow_code, label, states, transitions, is_enabled)
       VALUES ('SERVICE_REQUEST','Citizen service request workflow',$1,$2,true)
       ON CONFLICT (workflow_code) DO UPDATE SET states=EXCLUDED.states,
         transitions=EXCLUDED.transitions, updated_at=now()`,
      [
        ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'FIELD_VERIFICATION', 'RESOLVED', 'REJECTED'],
        JSON.stringify({
          SUBMITTED: ['ACKNOWLEDGED', 'REJECTED'],
          ACKNOWLEDGED: ['UNDER_REVIEW', 'REJECTED'],
          UNDER_REVIEW: ['FIELD_VERIFICATION', 'RESOLVED', 'REJECTED'],
          FIELD_VERIFICATION: ['RESOLVED', 'REJECTED'],
          RESOLVED: [],
          REJECTED: [],
        }),
      ],
    );

    /* --- administrative units ------------------------------------------- */
    const adminUnits = new Map<string, { level: string; code: string; name: string }>();
    for (const f of PARCEL_FIXTURES) {
      adminUnits.set(`STATE:TN`, { level: 'STATE', code: 'TN', name: 'Tamil Nadu' });
      adminUnits.set(`DISTRICT:${f.district}`, { level: 'DISTRICT', code: slug(f.district), name: f.district });
      adminUnits.set(`TALUK:${f.taluk}`, { level: 'TALUK', code: slug(f.taluk), name: f.taluk });
      adminUnits.set(`BLOCK:${f.block}`, { level: 'BLOCK', code: slug(f.block), name: f.block });
      adminUnits.set(`VILLAGE:${f.village}`, { level: 'VILLAGE', code: slug(f.village), name: f.village });
      adminUnits.set(`${f.localBodyType}:${f.localBody}`, {
        level: f.localBodyType,
        code: slug(f.localBody),
        name: f.localBody,
      });
    }
    for (const u of adminUnits.values()) {
      await c.query(
        `INSERT INTO administrative_units (level, code, name, parent_code, source_id, data_status)
         VALUES ($1,$2,$3,NULL,'TNGIS','DEMONSTRATION')
         ON CONFLICT (level, code) DO UPDATE SET name = EXCLUDED.name`,
        [u.level, u.code, u.name],
      );
    }

    /* --- parcels --------------------------------------------------------- */
    for (const f of PARCEL_FIXTURES) {
      const geo = fixtureGeometry(f);
      const areaSqm = sqftToSqm(f.cadastralAreaSqft);
      await c.query(
        `INSERT INTO parcels (parcel_id, display_id, survey_number, subdivision_number, state, district,
            taluk, block, village, local_body, local_body_type, latitude, longitude, area_sqft, area_sqm,
            status, classification, source_id, source_authority, data_status)
         VALUES ($1,$2,$3,$4,'Tamil Nadu',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
            'DEMONSTRATION','CADASTRE_DEMO','Demo fixture','DEMONSTRATION')
         ON CONFLICT (parcel_id) DO UPDATE SET
           display_id=EXCLUDED.display_id, survey_number=EXCLUDED.survey_number,
           subdivision_number=EXCLUDED.subdivision_number, district=EXCLUDED.district,
           taluk=EXCLUDED.taluk, block=EXCLUDED.block, village=EXCLUDED.village,
           local_body=EXCLUDED.local_body, local_body_type=EXCLUDED.local_body_type,
           latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
           area_sqft=EXCLUDED.area_sqft, area_sqm=EXCLUDED.area_sqm, updated_at=now()`,
        [
          f.parcelId, f.displayId, f.surveyNumber, f.subdivisionNumber, f.district, f.taluk,
          f.block, f.village, f.localBody, f.localBodyType, f.latitude, f.longitude,
          f.cadastralAreaSqft, areaSqm, f.status,
        ],
      );

      await c.query(
        `INSERT INTO parcel_identifiers (parcel_id, scheme, value, is_primary, is_official, note)
         VALUES ($1,'ULPIN_DEMO',$2,true,false,'Synthetic demonstration identifier — NOT an official ULPIN')
         ON CONFLICT (scheme, value) DO UPDATE SET parcel_id = EXCLUDED.parcel_id`,
        [f.parcelId, f.displayId],
      );
      await c.query(
        `INSERT INTO parcel_identifiers (parcel_id, scheme, value, is_primary, is_official, note)
         VALUES ($1,'SURVEY',$2,false,false,'Demonstration survey reference')
         ON CONFLICT (scheme, value) DO UPDATE SET parcel_id = EXCLUDED.parcel_id`,
        [f.parcelId, `${f.village}-${f.surveyNumber}`],
      );

      const existingGeom = await c.query(
        `SELECT geometry_id FROM parcel_geometries WHERE parcel_id = $1 LIMIT 1`,
        [f.parcelId],
      );
      if (existingGeom.rowCount === 0) {
        await c.query(
          `INSERT INTO parcel_geometries (parcel_id, geometry, geometry_type, centroid, area_sqm,
              perimeter_m, srid, is_valid, validity_note, source_id, data_status)
           VALUES ($1,$2,$3,$4,$5,$6,4326,true,'Planar area computed from the demonstration polygon; no cadastral survey was performed.', 'CADASTRE_DEMO','DEMONSTRATION')`,
          [
            f.parcelId,
            JSON.stringify(geo.geometry),
            geo.geometry.type,
            JSON.stringify({ type: 'Point', coordinates: geo.centroid }),
            geo.areaSqm,
            Math.round(perimeterM(geo.geometry.coordinates[0]) * 100) / 100,
          ],
        );
      }

      await c.query(
        `INSERT INTO parcel_versions (parcel_id, version_no, change_type, snapshot, actor, source_id)
         VALUES ($1, 1, 'CREATED', $2, 'seed', 'CADASTRE_DEMO')
         ON CONFLICT (parcel_id, version_no) DO NOTHING`,
        [f.parcelId, JSON.stringify({ displayId: f.displayId, review: f.scenario })],
      );

      /* --- governance records, per scenario ---------------------------- */
      await seedGovernance(c, f);
    }

    /* --- gis features for cadastral parcels ----------------------------- */
    await c.query(`DELETE FROM gis_features WHERE layer_id = 'cadastral-parcels'`);
    for (const f of PARCEL_FIXTURES) {
      const geo = fixtureGeometry(f);
      await c.query(
        `INSERT INTO gis_features (layer_id, parcel_id, properties, geometry, source_id, data_status)
         VALUES ('cadastral-parcels',$1,$2,$3,'CADASTRE_DEMO','DEMONSTRATION')`,
        [
          f.parcelId,
          JSON.stringify({
            parcelId: f.parcelId,
            displayId: f.displayId,
            surveyNumber: f.surveyNumber,
            village: f.village,
            district: f.district,
          }),
          JSON.stringify(geo.geometry),
        ],
      );
    }

    /* --- demo content-independence guard -------------------------------- */
    await c.query(`DELETE FROM gis_features WHERE layer_id = 'soil-context'`);

    await c.query('COMMIT');
    log('[seed] demonstration dataset applied (idempotent)');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

const ROLE_CODE_FOR_DEPT: Record<string, string> = {
  Revenue: 'REVENUE_OFFICER',
  Registration: 'REGISTRATION_OFFICER',
  'Municipal Tax': 'MUNICIPAL_OFFICER',
  Planning: 'PLANNING_OFFICER',
  Judiciary: 'JUDICIARY_VIEWER',
  'Survey/GIS': 'FIELD_OFFICER',
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function perimeterM(ring: number[][]): number {
  const lat0 = ring[0][1];
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 111320;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const dx = (ring[i + 1][0] - ring[i][0]) * mx;
    const dy = (ring[i + 1][1] - ring[i][1]) * my;
    total += Math.hypot(dx, dy);
  }
  return total;
}

async function upsertParty(c: import('pg').PoolClient, name: string): Promise<string> {
  const existing = await c.query<{ party_id: string }>(
    `SELECT party_id FROM parties WHERE display_name = $1 LIMIT 1`,
    [name],
  );
  if (existing.rowCount && existing.rows[0]) return existing.rows[0].party_id;
  const id = randomUUID();
  await c.query(
    `INSERT INTO parties (party_id, display_name, party_type, masked_name) VALUES ($1,$2,'INDIVIDUAL',$3)`,
    [id, name, maskName(name)],
  );
  return id;
}

async function seedGovernance(
  c: import('pg').PoolClient,
  f: (typeof PARCEL_FIXTURES)[number],
): Promise<void> {
  const P = f.parcelId;

  // Clear only the demonstration governance rows for this parcel so a re-run is
  // idempotent without touching operator-entered data. Integrity findings and
  // their evidence are derived by the rules engine, not seeded, so they are
  // deliberately left alone here - reconciling them is the engine's job.
  await c.query(`DELETE FROM ror_records WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM revenue_records WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM deeds WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM registration_documents WHERE registration_id IN (SELECT registration_id FROM registrations WHERE parcel_id = $1)`, [P]);
  await c.query(`DELETE FROM registrations WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM mortgages WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM encumbrances WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM tax_records WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM building_permissions WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM judiciary_events WHERE judiciary_case_id IN (SELECT judiciary_case_id FROM judiciary_cases WHERE parcel_id = $1)`, [P]);
  await c.query(`DELETE FROM judiciary_cases WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM satellite_observations WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM change_detections WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM ownerships WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM documents WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM land_use WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM zoning WHERE parcel_id = $1`, [P]);
  await c.query(`DELETE FROM temporal_versions WHERE parcel_id = $1`, [P]);

  const recordedBase = '2026-04-10T09:30:00Z';
  const recordedRecent = '2026-09-20T11:15:00Z';

  // Cadastral revenue record for every parcel — this is the area baseline.
  await c.query(
    `INSERT INTO revenue_records (parcel_id, record_type, survey_number, subdivision_number,
        recorded_area_sqft, classification, source_id, source_authority, data_status, confidence, recorded_at)
     VALUES ($1,'CADASTRAL',$2,$3,$4,'DRY','REVENUE_DEMO','Demo fixture','DEMONSTRATION',1,$5)`,
    [P, f.surveyNumber, f.subdivisionNumber, f.cadastralAreaSqft, recordedBase],
  );

  switch (P) {
    /* ---------------------------------------------------------------- A */
    case 'PARC-A': {
      const party = await upsertParty(c, 'A. Ravi');
      await c.query(
        `INSERT INTO revenue_records (parcel_id, record_type, survey_number, subdivision_number,
            recorded_area_sqft, classification, source_id, source_authority, data_status, confidence, recorded_at)
         VALUES ($1,'ADANGAL',$2,$3,$4,'DRY','REVENUE_DEMO','Demo fixture','DEMONSTRATION',1,$5)`,
        [P, f.surveyNumber, f.subdivisionNumber, f.cadastralAreaSqft, recordedBase],
      );
      await c.query(
        `INSERT INTO ror_records (parcel_id, record_number, owner_party_id, owner_name,
            asserted_area_sqft, land_classification, patta_number, issuing_office, source_id,
            source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,'ROR-A-041',$2,'A. Ravi',$3,'DRY','PATTA-041','Taluk Office, Tambaram',
            'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.95,$4,$5)`,
        [P, party, f.cadastralAreaSqft, '2021-06-01', recordedBase],
      );
      await c.query(
        `INSERT INTO ownerships (parcel_id, party_id, share_numerator, share_denominator, ownership_type,
            asserted_area_sqft, source_id, source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,$2,1,1,'ABSOLUTE',$3,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.95,$4,$5)`,
        [P, party, f.cadastralAreaSqft, '2021-06-01', recordedBase],
      );
      const reg = await c.query<{ registration_id: string }>(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'DOC-A-2019-0412','2019-08-14','SALE_DEED','Joint Sub-Registrar I, Tambaram',
            1850000,129500,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.97,$2)
         RETURNING registration_id`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO deeds (registration_id, parcel_id, deed_type, execution_date, transferor_name,
            transferee_name, consideration_amount, area_transferred_sqft, source_id, data_status)
         VALUES ($1,$2,'SALE_DEED','2019-08-14','M. Kumar','A. Ravi',1850000,$3,'REGISTRATION_DEMO','DEMONSTRATION')`,
        [reg.rows[0].registration_id, P, f.cadastralAreaSqft],
      );
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-A-041','2025-2026',4200,4200,0,'2026-05-12','A. Ravi',
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'RESIDENTIAL','Residential — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO zoning (parcel_id, zone_code, zone_name, permitted_use, far_limit, authority,
            source_id, data_status, recorded_at)
         VALUES ($1,'R1','Residential Zone R1','Residential',1.5,'Demo Planning Authority','PLANNING_DEMO','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO building_permissions (parcel_id, permission_number, application_number, approval_date,
            building_use, floor_count, status, authority, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'BP-A-2022-0041','APP-A-2022-0041','2022-03-18','RESIDENTIAL',2,'APPROVED',
            'Demo Planning Authority','PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'ROR','Record of Rights extract (demonstration)','Taluk Office, Tambaram','2021-06-01',
            $2,'application/pdf','METADATA_ONLY',true,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`ROR-${P}`), recordedBase],
      );
      break;
    }

    /* ---------------------------------------------------------------- B */
    case 'PARC-B': {
      // RoR + tax agree on K. Meenakshi; the latest deed transfers to R. Suresh.
      const meenakshi = await upsertParty(c, 'K. Meenakshi');
      const suresh = await upsertParty(c, 'R. Suresh');
      await c.query(
        `INSERT INTO ror_records (parcel_id, record_number, owner_party_id, owner_name,
            asserted_area_sqft, land_classification, patta_number, issuing_office, source_id,
            source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,'ROR-B-042',$2,'K. Meenakshi',$3,'DRY','PATTA-042','Taluk Office, Tambaram',
            'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.96,'2018-02-11',$4)`,
        [P, meenakshi, f.cadastralAreaSqft, recordedBase],
      );
      await c.query(
        `INSERT INTO ownerships (parcel_id, party_id, share_numerator, share_denominator, ownership_type,
            asserted_area_sqft, source_id, source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,$2,1,1,'ABSOLUTE',$3,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.96,'2018-02-11',$4)`,
        [P, meenakshi, f.cadastralAreaSqft, recordedBase],
      );
      const reg = await c.query<{ registration_id: string }>(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'DOC-B-2026-0311','2026-07-22','SALE_DEED','Joint Sub-Registrar I, Tambaram',
            2450000,171500,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.99,$2)
         RETURNING registration_id`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO deeds (registration_id, parcel_id, deed_type, execution_date, transferor_name,
            transferee_name, consideration_amount, area_transferred_sqft, source_id, data_status)
         VALUES ($1,$2,'SALE_DEED','2026-07-15','K. Meenakshi','R. Suresh',2450000,$3,'REGISTRATION_DEMO','DEMONSTRATION')`,
        [reg.rows[0].registration_id, P, f.cadastralAreaSqft],
      );
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-B-042','2025-2026',3600,3600,0,'2026-04-30','K. Meenakshi',
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'RESIDENTIAL','Residential — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO zoning (parcel_id, zone_code, zone_name, permitted_use, far_limit, authority,
            source_id, data_status, recorded_at)
         VALUES ($1,'R1','Residential Zone R1','Residential',1.5,'Demo Planning Authority','PLANNING_DEMO','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO building_permissions (parcel_id, permission_number, application_number, approval_date,
            building_use, floor_count, status, authority, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'BP-B-2019-0042','APP-B-2019-0042','2019-05-02','RESIDENTIAL',1,'APPROVED',
            'Demo Planning Authority','PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'DEED','Registered sale deed (demonstration)','Joint Sub-Registrar I, Tambaram','2026-07-22',
            $2,'application/pdf','METADATA_ONLY',false,'REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`DEED-${P}`), recordedRecent],
      );
      await c.query(
        `INSERT INTO temporal_versions (entity_type, entity_id, parcel_id, change_type, valid_from,
            recorded_at, actor, source_id, before_value, after_value, reason)
         VALUES ('ownership',$1,$2,'OWNERSHIP_TRANSFER','2026-07-15',$3,'registration-system','REGISTRATION_DEMO',
            $4,$5,'Registered transfer recorded in the demonstration registration fixture')`,
        [
          `OWN-B-${f.displayId}`,
          P,
          recordedRecent,
          JSON.stringify({ owner: 'K. Meenakshi' }),
          JSON.stringify({ owner: 'R. Suresh' }),
        ],
      );
      break;
    }

    /* ---------------------------------------------------------------- C */
    case 'PARC-C': {
      // Cadastral area 2365 sq.ft vs RoR asserted area 2400 sq.ft.
      const party = await upsertParty(c, 'S. Lakshmi');
      await c.query(
        `INSERT INTO ror_records (parcel_id, record_number, owner_party_id, owner_name,
            asserted_area_sqft, land_classification, patta_number, issuing_office, source_id,
            source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,'ROR-C-043',$2,'S. Lakshmi',2400,'DRY','PATTA-043','Taluk Office, Tambaram',
            'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.94,'2017-09-05',$3)`,
        [P, party, recordedBase],
      );
      await c.query(
        `INSERT INTO ownerships (parcel_id, party_id, share_numerator, share_denominator, ownership_type,
            asserted_area_sqft, source_id, source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,$2,1,1,'ABSOLUTE',2400,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.94,'2017-09-05',$3)`,
        [P, party, recordedBase],
      );
      const reg = await c.query<{ registration_id: string }>(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'DOC-C-2017-0288','2017-09-05','SALE_DEED','Joint Sub-Registrar I, Tambaram',
            1620000,113400,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.95,$2)
         RETURNING registration_id`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO deeds (registration_id, parcel_id, deed_type, execution_date, transferor_name,
            transferee_name, consideration_amount, area_transferred_sqft, source_id, data_status)
         VALUES ($1,$2,'SALE_DEED','2017-09-05','V. Anand','S. Lakshmi',1620000,2400,'REGISTRATION_DEMO','DEMONSTRATION')`,
        [reg.rows[0].registration_id, P],
      );
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-C-043','2025-2026',3900,3900,0,'2026-06-01','S. Lakshmi',
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'RESIDENTIAL','Residential — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO zoning (parcel_id, zone_code, zone_name, permitted_use, far_limit, authority,
            source_id, data_status, recorded_at)
         VALUES ($1,'R1','Residential Zone R1','Residential',1.5,'Demo Planning Authority','PLANNING_DEMO','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO building_permissions (parcel_id, permission_number, application_number, approval_date,
            building_use, floor_count, status, authority, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'BP-C-2018-0043','APP-C-2018-0043','2018-01-22','RESIDENTIAL',1,'APPROVED',
            'Demo Planning Authority','PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'SURVEY','Cadastral sketch (demonstration)','Survey Department (demo)','2017-08-20',
            $2,'application/pdf','METADATA_ONLY',true,'CADASTRE_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`SURVEY-${P}`), recordedBase],
      );
      break;
    }

    /* ---------------------------------------------------------------- D */
    case 'PARC-D': {
      const party = await upsertParty(c, 'R. Suresh');
      await c.query(
        `INSERT INTO ror_records (parcel_id, record_number, owner_party_id, owner_name,
            asserted_area_sqft, land_classification, patta_number, issuing_office, source_id,
            source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,'ROR-D-044',$2,'R. Suresh',$3,'DRY','PATTA-044','Taluk Office, Egmore',
            'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.93,'2015-11-19',$4)`,
        [P, party, f.cadastralAreaSqft, recordedBase],
      );
      await c.query(
        `INSERT INTO ownerships (parcel_id, party_id, share_numerator, share_denominator, ownership_type,
            asserted_area_sqft, source_id, source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,$2,1,1,'ABSOLUTE',$3,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.93,'2015-11-19',$4)`,
        [P, party, f.cadastralAreaSqft, recordedBase],
      );
      const reg = await c.query<{ registration_id: string }>(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'DOC-D-2026-0091','2026-02-18','SALE_DEED','Joint Sub-Registrar II, Egmore',
            6400000,448000,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.98,$2)
         RETURNING registration_id`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO deeds (registration_id, parcel_id, deed_type, execution_date, transferor_name,
            transferee_name, consideration_amount, area_transferred_sqft, source_id, data_status)
         VALUES ($1,$2,'SALE_DEED','2026-02-10','N. Priya','R. Suresh',6400000,$3,'REGISTRATION_DEMO','DEMONSTRATION')`,
        [reg.rows[0].registration_id, P, f.cadastralAreaSqft],
      );
      await c.query(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'MORT-D-2026-0092','2026-02-18','MORTGAGE_DEED','Joint Sub-Registrar II, Egmore',
            4200000,294000,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.98,$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO encumbrances (parcel_id, encumbrance_type, holder_name, amount, start_date, end_date,
            is_active, noc_status, source_id, source_authority, data_status, confidence, recorded_at)
         VALUES ($1,'MORTGAGE','Demo Cooperative Bank Ltd',4200000,'2026-02-18',NULL,true,'ABSENT',
            'REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.96,$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO mortgages (parcel_id, lender_name, borrower_name, mortgage_amount, mortgage_date,
            closure_date, status, source_id, data_status)
         VALUES ($1,'Demo Cooperative Bank Ltd','R. Suresh',4200000,'2026-02-18',NULL,'ACTIVE',
            'REGISTRATION_DEMO','DEMONSTRATION')`,
        [P],
      );
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-D-044','2025-2026',18600,7000,11600,'2025-08-14','R. Suresh',
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'COMMERCIAL','Commercial — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO zoning (parcel_id, zone_code, zone_name, permitted_use, far_limit, authority,
            source_id, data_status, recorded_at)
         VALUES ($1,'C1','Commercial Zone C1','Commercial',2.5,'Demo Planning Authority','PLANNING_DEMO','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO building_permissions (parcel_id, permission_number, application_number, approval_date,
            building_use, floor_count, status, authority, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'BP-D-2016-0044','APP-D-2016-0044','2016-04-11','COMMERCIAL',3,'APPROVED',
            'Demo Planning Authority','PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      const jc = await c.query<{ judiciary_case_id: string }>(
        `INSERT INTO judiciary_cases (parcel_id, case_number, court, case_type, parties, status,
            filing_date, next_hearing, orders_summary, source_id, source_authority, data_status,
            confidence, recorded_at)
         VALUES ($1,'OS-2025-114','Demo Civil Court','Property dispute',
            'R. Suresh vs. Demo Housing Co-operative','PENDING','2025-09-08','2026-10-12',
            'Demonstration record. Interim injunction application listed for hearing.',
            'ECOURTS_DEMO','Demo fixture','DEMONSTRATION',0.9,$2)
         RETURNING judiciary_case_id`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO judiciary_events (judiciary_case_id, event_date, event_type, description, source_id, data_status)
         VALUES ($1,'2025-09-08','FILED','Demonstration case filing registered.','ECOURTS_DEMO','DEMONSTRATION')`,
        [jc.rows[0].judiciary_case_id],
      );
      await c.query(
        `INSERT INTO judiciary_events (judiciary_case_id, event_date, event_type, description, source_id, data_status)
         VALUES ($1,'2025-12-04','HEARING','Demonstration hearing held; matter adjourned.','ECOURTS_DEMO','DEMONSTRATION')`,
        [jc.rows[0].judiciary_case_id],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'COURT','Case status extract (demonstration)','Demo Civil Court','2026-09-20',
            $2,'application/pdf','METADATA_ONLY',false,'ECOURTS_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`COURT-${P}`), recordedRecent],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'EC','Encumbrance certificate (demonstration)','Joint Sub-Registrar II, Egmore','2026-02-20',
            $2,'application/pdf','METADATA_ONLY',true,'REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`EC-${P}`), recordedRecent],
      );
      await c.query(
        `INSERT INTO temporal_versions (entity_type, entity_id, parcel_id, change_type, valid_from,
            recorded_at, actor, source_id, before_value, after_value, reason)
         VALUES ('encumbrance',$1,$2,'MORTGAGE_CREATED','2026-02-18',$3,'registration-system','REGISTRATION_DEMO',
            NULL,$4,'Active mortgage recorded in the demonstration registration fixture')`,
        [`ENC-D-${f.displayId}`, P, recordedRecent, JSON.stringify({ lender: 'Demo Cooperative Bank Ltd', amount: 4200000 })],
      );
      break;
    }

    /* ---------------------------------------------------------------- E */
    case 'PARC-E': {
      const party = await upsertParty(c, 'M. Divya');
      await c.query(
        `INSERT INTO ror_records (parcel_id, record_number, owner_party_id, owner_name,
            asserted_area_sqft, land_classification, patta_number, issuing_office, source_id,
            source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,'ROR-E-045',$2,'M. Divya',$3,'DRY','PATTA-045','Taluk Office, Kanchipuram',
            'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.92,'2019-03-27',$4)`,
        [P, party, f.cadastralAreaSqft, recordedBase],
      );
      await c.query(
        `INSERT INTO ownerships (parcel_id, party_id, share_numerator, share_denominator, ownership_type,
            asserted_area_sqft, source_id, source_authority, data_status, confidence, valid_from, recorded_at)
         VALUES ($1,$2,1,1,'ABSOLUTE',$3,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',0.92,'2019-03-27',$4)`,
        [P, party, f.cadastralAreaSqft, recordedBase],
      );
      const reg = await c.query<{ registration_id: string }>(
        `INSERT INTO registrations (parcel_id, document_number, registration_date, document_type,
            registration_office, consideration_amount, stamp_duty, status, source_id, source_authority,
            data_status, confidence, recorded_at)
         VALUES ($1,'DOC-E-2019-0155','2019-03-27','SALE_DEED','Sub-Registrar, Kanchipuram',
            2100000,147000,'REGISTERED','REGISTRATION_DEMO','Demo fixture','DEMONSTRATION',0.94,$2)
         RETURNING registration_id`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO deeds (registration_id, parcel_id, deed_type, execution_date, transferor_name,
            transferee_name, consideration_amount, area_transferred_sqft, source_id, data_status)
         VALUES ($1,$2,'SALE_DEED','2019-03-27','P. Ganesan','M. Divya',2100000,$3,'REGISTRATION_DEMO','DEMONSTRATION')`,
        [reg.rows[0].registration_id, P, f.cadastralAreaSqft],
      );
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-E-045','2025-2026',5100,5100,0,'2026-05-28','M. Divya',
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'RESIDENTIAL','Residential — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO zoning (parcel_id, zone_code, zone_name, permitted_use, far_limit, authority,
            source_id, data_status, recorded_at)
         VALUES ($1,'R1','Residential Zone R1','Residential',1.5,'Demo Planning Authority','PLANNING_DEMO','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      // Deliberately NO building approval record: the scenario is a coverage gap.
      const obs = await c.query<{ observation_id: string }>(
        `INSERT INTO satellite_observations (parcel_id, sensor, capture_date, source_id, source_authority,
            cloud_coverage, change_score, possible_change, confidence, geometry, processing_note, data_status)
         VALUES ($1,'Sentinel-2 (demonstration)','2026-08-04','SATELLITE_DEMO','Demo fixture',
            11.4,0.78,true,0.91,$2,
            'Demonstration change-detection result. No satellite processing was performed for this record; the fixture is replaceable by a real model behind the same adapter interface.',
            'DEMONSTRATION')
         RETURNING observation_id`,
        [P, JSON.stringify(fixtureGeometry(f).geometry)],
      );
      await c.query(
        `INSERT INTO change_detections (parcel_id, observation_id, change_type, change_score, possible_change,
            confidence, description, data_status)
         VALUES ($1,$2,'POSSIBLE_BUILTUP_CHANGE',0.78,true,0.91,
            'Possible building change detected between the 2024 and 2026 demonstration captures; approval record requires verification.',
            'DEMONSTRATION')`,
        [P, obs.rows[0].observation_id],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'ROR','Record of Rights extract (demonstration)','Taluk Office, Kanchipuram','2019-03-27',
            $2,'application/pdf','METADATA_ONLY',true,'REVENUE_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`ROR-${P}`), recordedBase],
      );
      break;
    }

    /* ---------------------------------------------------------------- F */
    case 'PARC-F': {
      // Geometry + identity only. No RoR. Tax and registration exist so the
      // parcel is genuinely "not linked" rather than simply empty.
      await c.query(
        `INSERT INTO tax_records (parcel_id, authority_type, assessment_number, tax_period, demand_amount,
            paid_amount, due_amount, last_payment_date, owner_name, source_id, source_authority,
            data_status, recorded_at)
         VALUES ($1,'MUNICIPAL','TAX-F-046','2025-2026',2900,2900,0,'2026-05-19',NULL,
            'TAX_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedRecent],
      );
      await c.query(
        `INSERT INTO land_use (parcel_id, use_code, use_description, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'RESIDENTIAL','Residential — demonstration land-use classification',
            'PLANNING_DEMO','Demo fixture','DEMONSTRATION',$2)`,
        [P, recordedBase],
      );
      await c.query(
        `INSERT INTO documents (parcel_id, document_type, title, issued_by, issue_date, content_hash,
            mime_type, status, is_public, source_id, source_authority, data_status, recorded_at)
         VALUES ($1,'SURVEY','Village map extract (demonstration)','Survey Department (demo)','2020-02-14',
            $2,'application/pdf','METADATA_ONLY',true,'CADASTRE_DEMO','Demo fixture','DEMONSTRATION',$3)`,
        [P, fakeHash(`MAP-${P}`), recordedBase],
      );
      break;
    }
  }

  // Seed a system-created case for PARC-D so the officer queue is not empty on a
  // fresh install. Uses ON CONFLICT on the generated case number for idempotency.
  if (P === 'PARC-D') {
    const existing = await c.query(`SELECT case_id FROM verification_cases WHERE case_number = 'BHM-DEMO-0001'`);
    if (existing.rowCount === 0) {
      const cs = await c.query<{ case_id: string }>(
        `INSERT INTO verification_cases (case_number, parcel_id, title, description, priority, status,
            origin, finding_refs, assigned_role, assigned_department, due_date)
         VALUES ('BHM-DEMO-0001',$1,'High-risk encumbrance profile — verification required',
            'Active mortgage with no NOC on record, recent registered transfer, outstanding tax dues and a pending demonstration judiciary record. Field verification required before any transaction.',
            'HIGH','SUBMITTED','SYSTEM',$2,'REGISTRATION_OFFICER','Registration','2026-10-12')
         RETURNING case_id`,
        [P, ['FND-PARC-D-ENCUMBRANCE_RISK']],
      );
      await c.query(
        `INSERT INTO case_events (case_id, event_type, to_status, description, actor, actor_role, visibility)
         VALUES ($1,'CASE_CREATED','SUBMITTED','Case raised automatically from the integrity engine (high-risk encumbrance profile).','integrity-engine','SYSTEM','PUBLIC')`,
        [cs.rows[0].case_id],
      );
    }
  }
}

function fakeHash(seed: string): string {
  // Deterministic stand-in for a document content hash. Documents in this build
  // are metadata records; no file content is stored.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `demohash-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed:', err);
      process.exit(1);
    });
}
