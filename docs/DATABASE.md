# Database

PostgreSQL 17, with PostGIS used where available. The schema is normalized around the
**parcel**, with temporal columns on every material record so history can be reconstructed
rather than overwritten. Definitions live in `server/src/db/schema.sql`; migrations are
applied idempotently by `server/src/db/migrate.ts`.

## Temporal columns

Every important record supports:

| Column | Meaning |
| --- | --- |
| `created_at` | Row insertion (system time) |
| `updated_at` | Last modification (system time) |
| `valid_from` / `valid_to` | When the fact was true in the world (valid time) |
| `recorded_at` | When the authority recorded it (transaction time) |
| `source_id` | Provenance link to `data_sources` |
| `source_version` | Version of the source record |
| `confidence` | Confidence where the value is derived or inferred |

This bitemporal split lets the platform answer both "what is true now" and "what did we
believe at the time", which is why the timeline can be rendered without a separate event
log for every table.

## Entity groups

**Identity and access**
`users`, `roles`, `permissions`, `role_permissions`, `sessions`, `consent_records`

**Parcel core**
`parcels`, `parcel_geometries`, `parcel_identifiers`, `parcel_versions`, `administrative_units`

**Parties and rights**
`parties`, `party_addresses`, `ownerships`, `rights`, `restrictions`, `interests`

**Revenue and registration**
`revenue_records`, `ror_records`, `registrations`, `registration_documents`, `deeds`, `documents`, `parcel_documents`

**Encumbrance**
`encumbrances`, `mortgages`

**Fiscal**
`tax_records`, `property_tax_records`

**Planning**
`planning_records`, `building_permissions`, `building_approvals`, `land_use`, `zoning`, `master_plans`

**Judiciary**
`judiciary_cases`, `judiciary_events`

**Geospatial**
`gis_layers`, `gis_features`, `satellite_observations`, `change_detections`, `context_snapshots`

**Data fabric**
`data_sources`, `source_runs`, `ingestion_runs`, `quality_metrics`, `authority_mappings`

**Integrity**
`integrity_findings`, `integrity_evidence`, `rule_definitions`

**Workflow**
`verification_cases`, `case_events`, `case_comments`, `case_assignments`, `workflow_definitions`

**Citizen services**
`service_requests`, `service_request_events`, `notifications`

**Governance**
`audit_logs`, `analytics_snapshots`, `temporal_versions`

## The parcel

```sql
parcels (
  parcel_id, display_id, survey_number, subdivision_number,
  district, taluk, block, village, state, local_body,
  latitude, longitude,
  area_sqft, area_sq_m,
  status, source_id, source_authority, data_status,
  created_at, updated_at, valid_from, valid_to, recorded_at
)
```

`display_id` holds the synthetic, ULPIN-compatible display identifier
(e.g. `3301DEMO000042`). Parcels contain no Aadhaar or any other national identifier, and
no unnecessary personal data.

`parcel_identifiers` models the identity resolution problem explicitly: one parcel can carry
several identifiers (ULPIN-like, survey, local), each with its own source and confidence, so
linkage can be *linked*, *partially linked*, *unlinked* or *conflicting* rather than a
single brittle foreign key.

## Geometry

`parcel_geometries` stores the polygon as GeoJSON text with a centroid and a dimensional
metadata block. PostGIS can be used for spatial predicates where installed; the schema and
queries degrade to plain text geometry when it is not, so PostGIS is recommended but not a
hard requirement.

## Indexes

Indexes are created for the access paths the application actually uses:

`parcel_id`, `display_id`, ULPIN and survey identifiers, `village`, `district`,
owner/party name, case `status`, risk/severity, `source_id`, and `created_at`. Queue queries
(case list, officer scope, findings by rule) are served by covering indexes on the filing
columns so a dashboard render does not scan a table.

## Integrity findings

`integrity_findings` rows are a **cache for queue traversal, not the source of truth**. The
engine is a pure function of the current records; `reconcileAllFindings()` recomputes and
reconciles the persisted rows at boot and on demand. Deleting the rows and recomputing
reproduces them exactly, which is what the unit tests assert.

## Seeding and migration safety

`seed.ts` is **idempotent**: it upserts the six demonstration parcels, their geometry,
parties, rights, records, findings and sources by stable identifiers, so restarting the
server never duplicates rows. Migrations never drop existing data during a normal
deployment; the destructive path is confined to the explicit `db:reset` script.
