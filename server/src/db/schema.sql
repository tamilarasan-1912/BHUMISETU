-- =============================================================================
-- BHUMISETU — Integrated GIS Land Stack & Parcel Intelligence Platform
-- Normalized parcel-centric schema. Every governance record resolves to a parcel.
-- Safe to re-run: all statements are idempotent (IF NOT EXISTS / guarded).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Enumerations (guarded - Postgres has no CREATE TYPE IF NOT EXISTS)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE data_status_t AS ENUM ('REAL','DERIVED','CONTEXTUAL','DEMONSTRATION','AI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE severity_t AS ENUM ('LOW','MEDIUM','HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finding_status_t AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE case_status_t AS ENUM ('SUBMITTED','UNDER_REVIEW','FIELD_VERIFICATION','RESOLVED','ESCALATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE service_status_t AS ENUM ('SUBMITTED','ACKNOWLEDGED','UNDER_REVIEW','FIELD_VERIFICATION','RESOLVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_status_t AS ENUM ('CONNECTED','AVAILABLE','ADAPTER_READY','UPSTREAM_UNAVAILABLE','REQUIRES_AUTH','DEMO_DATA','NOT_CONFIGURED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE linkage_t AS ENUM ('LINKED','PARTIALLY_LINKED','UNLINKED','CONFLICTING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Identity, roles, permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  is_officer      boolean NOT NULL DEFAULT false,
  is_admin        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  description     text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS users (
  user_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text NOT NULL UNIQUE,
  email           text UNIQUE,
  full_name       text NOT NULL,
  password_hash   text NOT NULL,
  role_code       text NOT NULL REFERENCES roles(code),
  district        text,
  department      text,
  phone_masked    text,
  active          boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_code);

CREATE TABLE IF NOT EXISTS sessions (
  session_id      text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked         boolean NOT NULL DEFAULT false,
  user_agent      text,
  ip              text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(user_id) ON DELETE CASCADE,
  audience_role   text REFERENCES roles(code),
  type            text NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  entity_type     text,
  entity_id       text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at);

-- ---------------------------------------------------------------------------
-- Data fabric: sources, ingestion runs, health
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_sources (
  source_id       text PRIMARY KEY,
  name            text NOT NULL,
  organization    text NOT NULL,
  category        text NOT NULL,
  url             text NOT NULL DEFAULT '',
  authority       text NOT NULL DEFAULT '',
  status          source_status_t NOT NULL DEFAULT 'NOT_CONFIGURED',
  capability      text[] NOT NULL DEFAULT '{}',
  coverage        text NOT NULL DEFAULT '',
  licence_note    text NOT NULL DEFAULT '',
  is_authoritative boolean NOT NULL DEFAULT false,
  is_contextual   boolean NOT NULL DEFAULT false,
  is_derived      boolean NOT NULL DEFAULT false,
  is_demonstration boolean NOT NULL DEFAULT false,
  is_enabled      boolean NOT NULL DEFAULT true,
  data_status     data_status_t NOT NULL DEFAULT 'CONTEXTUAL',
  freshness_note  text NOT NULL DEFAULT '',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  latency_ms      integer,
  endpoint        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_runs (
  run_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       text NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  operation       text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL,
  latency_ms      integer,
  records         integer,
  error           text,
  cache_hit       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS source_runs_source_idx ON source_runs(source_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Administrative hierarchy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS administrative_units (
  unit_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level           text NOT NULL, -- STATE|DISTRICT|TALUK|BLOCK|VILLAGE|ULB|PANCHAYAT
  code            text NOT NULL,
  name            text NOT NULL,
  parent_code     text,
  state           text NOT NULL DEFAULT 'Tamil Nadu',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  geometry        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, code)
);
CREATE INDEX IF NOT EXISTS admin_units_name_idx ON administrative_units(name);

-- ---------------------------------------------------------------------------
-- Parcels — the central entity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parcels (
  parcel_id       text PRIMARY KEY,          -- internal id, e.g. PARC-A
  display_id      text NOT NULL UNIQUE,      -- demonstration ULPIN-compatible id
  survey_number   text,
  subdivision_number text,
  state           text NOT NULL DEFAULT 'Tamil Nadu',
  district        text NOT NULL,
  taluk           text,
  block           text,
  village         text NOT NULL,
  local_body      text,
  local_body_type text,                     -- ULB | PANCHAYAT
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  area_sqft       numeric(14,2),
  area_sqm        numeric(14,2),
  status          text NOT NULL DEFAULT 'ACTIVE',
  classification  text NOT NULL DEFAULT 'DEMONSTRATION',
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcels_district_idx ON parcels(district);
CREATE INDEX IF NOT EXISTS parcels_village_idx ON parcels(village);
CREATE INDEX IF NOT EXISTS parcels_taluk_idx ON parcels(taluk);
CREATE INDEX IF NOT EXISTS parcels_survey_idx ON parcels(survey_number);
CREATE INDEX IF NOT EXISTS parcels_created_idx ON parcels(created_at);

CREATE TABLE IF NOT EXISTS parcel_identifiers (
  identifier_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  scheme          text NOT NULL,            -- ULPIN_DEMO | SURVEY | LOCAL | LEGACY
  value           text NOT NULL,
  is_primary      boolean NOT NULL DEFAULT false,
  is_official     boolean NOT NULL DEFAULT false,
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheme, value)
);
CREATE INDEX IF NOT EXISTS parcel_identifiers_parcel_idx ON parcel_identifiers(parcel_id);

CREATE TABLE IF NOT EXISTS parcel_geometries (
  geometry_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  geometry        jsonb NOT NULL,           -- GeoJSON geometry
  geometry_type   text NOT NULL,
  centroid        jsonb NOT NULL,
  area_sqm        numeric(14,2),
  perimeter_m     numeric(14,2),
  srid            integer NOT NULL DEFAULT 4326,
  is_valid        boolean NOT NULL DEFAULT true,
  validity_note   text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcel_geometries_parcel_idx ON parcel_geometries(parcel_id);

CREATE TABLE IF NOT EXISTS parcel_versions (
  version_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  version_no      integer NOT NULL,
  change_type     text NOT NULL,
  snapshot        jsonb NOT NULL,
  actor           text NOT NULL DEFAULT 'system',
  source_id       text REFERENCES data_sources(source_id),
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, version_no)
);

-- ---------------------------------------------------------------------------
-- Parties and ownership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parties (
  party_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  party_type      text NOT NULL DEFAULT 'INDIVIDUAL', -- INDIVIDUAL|ENTITY|GOVERNMENT
  masked_name     text NOT NULL,
  identifier_hash text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parties_name_idx ON parties(display_name);

CREATE TABLE IF NOT EXISTS party_addresses (
  address_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id        uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  line1           text,
  village         text,
  district        text,
  state           text NOT NULL DEFAULT 'Tamil Nadu',
  pincode         text,
  is_current      boolean NOT NULL DEFAULT true,
  source_id       text REFERENCES data_sources(source_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ownerships (
  ownership_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  party_id        uuid NOT NULL REFERENCES parties(party_id),
  share_numerator integer NOT NULL DEFAULT 1,
  share_denominator integer NOT NULL DEFAULT 1,
  ownership_type  text NOT NULL DEFAULT 'ABSOLUTE',
  asserted_area_sqft numeric(14,2),
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ownerships_parcel_idx ON ownerships(parcel_id);
CREATE INDEX IF NOT EXISTS ownerships_party_idx ON ownerships(party_id);

CREATE TABLE IF NOT EXISTS rights (
  right_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  party_id        uuid REFERENCES parties(party_id),
  right_type      text NOT NULL,   -- OWNERSHIP|LEASE|EASEMENT|USUFRUCT|TENANCY|ACCESS
  description     text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restrictions (
  restriction_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  restriction_type text NOT NULL,  -- MORTGAGE|COURT_ATTACHMENT|CEILING|ALIENATION|ENVIRONMENTAL|EASEMENT
  description     text NOT NULL DEFAULT '',
  authority       text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restrictions_parcel_idx ON restrictions(parcel_id, restriction_type);

CREATE TABLE IF NOT EXISTS interests (
  interest_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  party_id        uuid REFERENCES parties(party_id),
  interest_type   text NOT NULL,
  description     text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Revenue / RoR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_records (
  revenue_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  record_type     text NOT NULL DEFAULT 'CADASTRAL',
  survey_number   text,
  subdivision_number text,
  recorded_area_sqft numeric(14,2),
  classification  text,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revenue_records_parcel_idx ON revenue_records(parcel_id, record_type);

CREATE TABLE IF NOT EXISTS ror_records (
  ror_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  record_number   text,
  owner_party_id  uuid REFERENCES parties(party_id),
  owner_name      text,
  asserted_area_sqft numeric(14,2),
  land_classification text,
  patta_number    text,
  issuing_office  text,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ror_parcel_idx ON ror_records(parcel_id);
CREATE INDEX IF NOT EXISTS ror_owner_idx ON ror_records(owner_name);

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registrations (
  registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  document_number text NOT NULL,
  registration_date date,
  document_type   text NOT NULL, -- SALE_DEED|GIFT_DEED|MORTGAGE_DEED|PARTITION|LEASE
  registration_office text,
  consideration_amount numeric(16,2),
  stamp_duty      numeric(16,2),
  status          text NOT NULL DEFAULT 'REGISTERED',
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registrations_parcel_idx ON registrations(parcel_id);

CREATE TABLE IF NOT EXISTS registration_documents (
  registration_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  document_id     uuid,
  document_role   text NOT NULL DEFAULT 'PRIMARY',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deeds (
  deed_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  deed_type       text NOT NULL,
  execution_date  date,
  transferor_name text,
  transferee_name text,
  consideration_amount numeric(16,2),
  area_transferred_sqft numeric(14,2),
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deeds_parcel_idx ON deeds(parcel_id);

CREATE TABLE IF NOT EXISTS encumbrances (
  encumbrance_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  encumbrance_type text NOT NULL,  -- MORTGAGE|LIEN|CHARGE|ATTACHMENT|NOC_MISSING
  holder_name     text,
  amount          numeric(16,2),
  start_date      date,
  end_date        date,
  is_active       boolean NOT NULL DEFAULT true,
  noc_status      text,            -- PRESENT|ABSENT|NOT_APPLICABLE
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS encumbrances_parcel_idx ON encumbrances(parcel_id, is_active);

CREATE TABLE IF NOT EXISTS mortgages (
  mortgage_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  encumbrance_id  uuid REFERENCES encumbrances(encumbrance_id) ON DELETE SET NULL,
  lender_name     text NOT NULL,
  borrower_name   text,
  mortgage_amount numeric(16,2),
  mortgage_date   date,
  closure_date    date,
  status          text NOT NULL DEFAULT 'ACTIVE',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Taxation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_records (
  tax_record_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  authority_type  text NOT NULL DEFAULT 'MUNICIPAL',
  assessment_number text,
  tax_period      text NOT NULL,
  demand_amount   numeric(16,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(16,2) NOT NULL DEFAULT 0,
  due_amount      numeric(16,2) NOT NULL DEFAULT 0,
  last_payment_date date,
  owner_name      text,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_records_parcel_idx ON tax_records(parcel_id);
CREATE INDEX IF NOT EXISTS tax_records_owner_idx ON tax_records(owner_name);

CREATE TABLE IF NOT EXISTS property_tax_records (
  property_tax_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_record_id   uuid REFERENCES tax_records(tax_record_id) ON DELETE CASCADE,
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  property_id     text,
  annual_value    numeric(16,2),
  tax_rate        numeric(6,4),
  computation_note text,
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Planning / building / land use / zoning
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_plans (
  master_plan_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  authority       text NOT NULL,
  district        text,
  approved_date   date,
  valid_from      date,
  valid_to        date,
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zoning (
  zoning_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  zone_code       text NOT NULL,
  zone_name       text NOT NULL,
  permitted_use   text,
  far_limit       numeric(6,2),
  authority       text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zoning_parcel_idx ON zoning(parcel_id);

CREATE TABLE IF NOT EXISTS land_use (
  land_use_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  use_code        text NOT NULL,
  use_description text NOT NULL,
  is_contextual   boolean NOT NULL DEFAULT true,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'CONTEXTUAL',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS land_use_parcel_idx ON land_use(parcel_id);

CREATE TABLE IF NOT EXISTS planning_records (
  planning_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  record_type     text NOT NULL,
  reference_number text,
  description     text NOT NULL DEFAULT '',
  authority       text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS building_permissions (
  building_permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  permission_number text NOT NULL,
  application_number text,
  approval_date   date,
  building_use    text,
  floor_count     integer,
  built_up_area_sqm numeric(14,2),
  status          text NOT NULL DEFAULT 'APPROVED',
  authority       text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_permissions_parcel_idx ON building_permissions(parcel_id);

CREATE TABLE IF NOT EXISTS building_approvals (
  building_approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  approval_type   text NOT NULL,
  approval_number text,
  approval_date   date,
  authority       text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'APPROVED',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Judiciary
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS judiciary_cases (
  judiciary_case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  case_number     text NOT NULL,
  court           text NOT NULL,
  case_type       text NOT NULL,
  parties         text,
  status          text NOT NULL DEFAULT 'PENDING',
  filing_date     date,
  next_hearing    date,
  orders_summary  text,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  confidence      numeric(4,3),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS judiciary_parcel_idx ON judiciary_cases(parcel_id);
CREATE INDEX IF NOT EXISTS judiciary_case_number_idx ON judiciary_cases(case_number);

CREATE TABLE IF NOT EXISTS judiciary_events (
  judiciary_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judiciary_case_id uuid NOT NULL REFERENCES judiciary_cases(judiciary_case_id) ON DELETE CASCADE,
  event_date      date NOT NULL,
  event_type      text NOT NULL,
  description     text NOT NULL DEFAULT '',
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  document_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  document_type   text NOT NULL, -- ROR|PATTA|DEED|EC|TAX_RECEIPT|BUILDING_APPROVAL|PLANNING|COURT|SURVEY|OTHER
  title           text NOT NULL,
  issued_by       text NOT NULL DEFAULT '',
  issue_date      date,
  valid_from      date,
  valid_to        date,
  content_hash    text NOT NULL DEFAULT '',
  mime_type       text NOT NULL DEFAULT 'application/pdf',
  status          text NOT NULL DEFAULT 'METADATA_ONLY',
  page_count      integer,
  is_public       boolean NOT NULL DEFAULT false,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_parcel_idx ON documents(parcel_id, document_type);

CREATE TABLE IF NOT EXISTS parcel_documents (
  parcel_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  relation        text NOT NULL DEFAULT 'EVIDENCE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Satellite observations & change detection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satellite_observations (
  observation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  sensor          text NOT NULL,
  capture_date    date NOT NULL,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  cloud_coverage  numeric(5,2),
  change_score    numeric(5,4),
  possible_change boolean NOT NULL DEFAULT false,
  confidence      numeric(4,3),
  geometry        jsonb,
  processing_note text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satellite_parcel_idx ON satellite_observations(parcel_id, capture_date DESC);

CREATE TABLE IF NOT EXISTS change_detections (
  change_detection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  observation_id  uuid REFERENCES satellite_observations(observation_id) ON DELETE SET NULL,
  change_type     text NOT NULL,
  change_score    numeric(5,4),
  possible_change boolean NOT NULL DEFAULT false,
  confidence      numeric(4,3),
  description     text NOT NULL DEFAULT '',
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_detections_parcel_idx ON change_detections(parcel_id);

-- ---------------------------------------------------------------------------
-- GIS layer catalogue & features
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gis_layers (
  layer_id        text PRIMARY KEY,
  name            text NOT NULL,
  category        text NOT NULL,
  source_id       text REFERENCES data_sources(source_id),
  authority       text NOT NULL DEFAULT '',
  geometry_kind   text NOT NULL DEFAULT 'vector',
  service_type    text NOT NULL DEFAULT 'GEOJSON', -- GEOJSON|WMS|WFS|XYZ
  service_url     text,
  attribution     text NOT NULL DEFAULT '',
  default_opacity numeric(3,2) NOT NULL DEFAULT 0.8,
  default_visible boolean NOT NULL DEFAULT true,
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  status          source_status_t NOT NULL DEFAULT 'ADAPTER_READY',
  description     text NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gis_features (
  feature_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id        text NOT NULL REFERENCES gis_layers(layer_id) ON DELETE CASCADE,
  parcel_id       text REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  properties      jsonb NOT NULL DEFAULT '{}',
  geometry        jsonb,
  source_id       text REFERENCES data_sources(source_id),
  data_status     data_status_t NOT NULL DEFAULT 'CONTEXTUAL',
  fetched_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gis_features_layer_idx ON gis_features(layer_id);
CREATE INDEX IF NOT EXISTS gis_features_parcel_idx ON gis_features(parcel_id);

CREATE TABLE IF NOT EXISTS context_snapshots (
  snapshot_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  source_id       text NOT NULL REFERENCES data_sources(source_id),
  cache_key       text NOT NULL,
  radius_m        integer NOT NULL,
  payload         jsonb NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  UNIQUE (cache_key)
);
CREATE INDEX IF NOT EXISTS context_snapshots_parcel_idx ON context_snapshots(parcel_id, source_id);

-- ---------------------------------------------------------------------------
-- Integrity findings & evidence (recomputed at read time; these persist
-- lifecycle state such as acknowledgment of a computed finding)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrity_findings (
  finding_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  rule_code       text NOT NULL,
  severity        severity_t NOT NULL,
  confidence      numeric(4,3) NOT NULL,
  title           text NOT NULL,
  description     text NOT NULL,
  expected_value  text,
  observed_value  text,
  recommended_action text NOT NULL DEFAULT '',
  routed_authority text NOT NULL DEFAULT '',
  status          finding_status_t NOT NULL DEFAULT 'OPEN',
  computed_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, rule_code)
);
CREATE INDEX IF NOT EXISTS integrity_findings_parcel_idx ON integrity_findings(parcel_id);
CREATE INDEX IF NOT EXISTS integrity_findings_sev_idx ON integrity_findings(severity, status);

CREATE TABLE IF NOT EXISTS integrity_evidence (
  evidence_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id      uuid NOT NULL REFERENCES integrity_findings(finding_id) ON DELETE CASCADE,
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  source_id       text REFERENCES data_sources(source_id),
  source_authority text NOT NULL DEFAULT '',
  document_id     uuid REFERENCES documents(document_id) ON DELETE SET NULL,
  record_table    text NOT NULL DEFAULT '',
  record_id       text NOT NULL DEFAULT '',
  field           text NOT NULL DEFAULT '',
  observed_value  text,
  expected_value  text,
  observed_at     timestamptz,
  confidence      numeric(4,3),
  data_status     data_status_t NOT NULL DEFAULT 'DEMONSTRATION',
  provenance      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integrity_evidence_finding_idx ON integrity_evidence(finding_id);

-- ---------------------------------------------------------------------------
-- Verification cases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_cases (
  case_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number     text NOT NULL UNIQUE,
  parcel_id       text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  priority        text NOT NULL DEFAULT 'NORMAL', -- LOW|NORMAL|HIGH|URGENT
  status          case_status_t NOT NULL DEFAULT 'SUBMITTED',
  origin          text NOT NULL DEFAULT 'CITIZEN', -- CITIZEN|OFFICER|SYSTEM
  finding_refs    text[] NOT NULL DEFAULT '{}',
  assigned_officer uuid REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_role   text REFERENCES roles(code),
  assigned_department text,
  created_by      uuid REFERENCES users(user_id) ON DELETE SET NULL,
  due_date        date,
  closed_at       timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_parcel_idx ON verification_cases(parcel_id);
CREATE INDEX IF NOT EXISTS cases_status_idx ON verification_cases(status);
CREATE INDEX IF NOT EXISTS cases_officer_idx ON verification_cases(assigned_officer);
CREATE INDEX IF NOT EXISTS cases_created_idx ON verification_cases(created_at DESC);

CREATE TABLE IF NOT EXISTS case_events (
  case_event_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES verification_cases(case_id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  from_status     case_status_t,
  to_status       case_status_t,
  description     text NOT NULL DEFAULT '',
  actor           text NOT NULL DEFAULT 'system',
  actor_role      text NOT NULL DEFAULT '',
  actor_user_id   uuid REFERENCES users(user_id) ON DELETE SET NULL,
  visibility      text NOT NULL DEFAULT 'INTERNAL', -- INTERNAL|PUBLIC
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_events_case_idx ON case_events(case_id, created_at);

CREATE TABLE IF NOT EXISTS case_comments (
  comment_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES verification_cases(case_id) ON DELETE CASCADE,
  body            text NOT NULL,
  visibility      text NOT NULL DEFAULT 'INTERNAL',
  author_user_id  uuid REFERENCES users(user_id) ON DELETE SET NULL,
  author_name     text NOT NULL DEFAULT '',
  author_role     text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_comments_case_idx ON case_comments(case_id, created_at);

CREATE TABLE IF NOT EXISTS case_assignments (
  assignment_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES verification_cases(case_id) ON DELETE CASCADE,
  assigned_to     uuid REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_role   text REFERENCES roles(code),
  department      text,
  assigned_by     uuid REFERENCES users(user_id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  is_current      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_assignments_case_idx ON case_assignments(case_id, is_current);

-- ---------------------------------------------------------------------------
-- Citizen service requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_requests (
  request_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  parcel_id       text REFERENCES parcels(parcel_id) ON DELETE SET NULL,
  request_type    text NOT NULL,
  subject         text NOT NULL,
  description     text NOT NULL DEFAULT '',
  status          service_status_t NOT NULL DEFAULT 'SUBMITTED',
  channel         text NOT NULL DEFAULT 'WEB',
  requester_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
  requester_name_masked text,
  contact_masked  text,
  assigned_department text,
  linked_case_id  uuid REFERENCES verification_cases(case_id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_requests_parcel_idx ON service_requests(parcel_id);
CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests(status);

CREATE TABLE IF NOT EXISTS service_request_events (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES service_requests(request_id) ON DELETE CASCADE,
  from_status     service_status_t,
  to_status       service_status_t,
  description     text NOT NULL DEFAULT '',
  actor           text NOT NULL DEFAULT 'system',
  visibility      text NOT NULL DEFAULT 'PUBLIC',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Consent records (privacy controls)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consent_records (
  consent_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(user_id) ON DELETE CASCADE,
  purpose         text NOT NULL,
  scope           text NOT NULL,
  granted         boolean NOT NULL DEFAULT true,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  note            text NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- Temporal version ledger (bitemporal: valid time + record time)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temporal_versions (
  version_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  parcel_id       text REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  change_type     text NOT NULL,
  valid_from      timestamptz,
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL DEFAULT 'system',
  source_id       text REFERENCES data_sources(source_id),
  before_value    jsonb,
  after_value     jsonb,
  reason          text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS temporal_entity_idx ON temporal_versions(entity_type, entity_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS temporal_parcel_idx ON temporal_versions(parcel_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Audit log (append-only by policy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp"     timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL DEFAULT 'anonymous',
  actor_user_id   uuid,
  role            text NOT NULL DEFAULT '',
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  before_value    jsonb,
  after_value     jsonb,
  source          text NOT NULL DEFAULT 'bhumisetu-api',
  reason          text NOT NULL DEFAULT '',
  request_id      text,
  ip              text,
  parcel_id       text
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity_type, entity_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS audit_parcel_idx ON audit_logs(parcel_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_logs("timestamp" DESC);

-- ---------------------------------------------------------------------------
-- Configuration (rules, workflow, thresholds) — every change is auditable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_definitions (
  rule_code       text PRIMARY KEY,
  title           text NOT NULL,
  description     text NOT NULL,
  severity        severity_t NOT NULL,
  deduction       integer NOT NULL DEFAULT 0,
  recommended_action text NOT NULL DEFAULT '',
  routed_authority text NOT NULL DEFAULT '',
  is_enabled      boolean NOT NULL DEFAULT true,
  parameters      jsonb NOT NULL DEFAULT '{}',
  version         integer NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  workflow_code   text PRIMARY KEY,
  label           text NOT NULL,
  states          text[] NOT NULL DEFAULT '{}',
  transitions     jsonb NOT NULL DEFAULT '{}',
  is_enabled      boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authority_mappings (
  mapping_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text NOT NULL,          -- OWNERSHIP|AREA|TAX|PLANNING|...
  rule_code       text REFERENCES rule_definitions(rule_code) ON DELETE SET NULL,
  department      text NOT NULL,
  role_code       text REFERENCES roles(code),
  escalation      text NOT NULL DEFAULT '',
  sla_days        integer NOT NULL DEFAULT 14,
  is_enabled      boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Analytics snapshots (materialized calculator output, never fabricated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  snapshot_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL,
  scope_key       text,
  payload         jsonb NOT NULL,
  dataset_label   text NOT NULL DEFAULT 'Demo dataset',
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_scope_idx ON analytics_snapshots(scope, scope_key, computed_at DESC);

-- ---------------------------------------------------------------------------
-- Ingestion pipeline stage log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  ingestion_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       text NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  pipeline_stage  text NOT NULL, -- SOURCE|FETCH|VALIDATE|NORMALIZE|MAP|PROVENANCE|STORE|INDEX|ANALYZE|DISPLAY
  status          text NOT NULL,
  records_in      integer NOT NULL DEFAULT 0,
  records_out     integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  detail          text NOT NULL DEFAULT '',
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ingestion_source_idx ON ingestion_runs(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id       text REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT 'PARCEL',
  completeness    numeric(5,2),
  consistency     numeric(5,2),
  freshness       numeric(5,2),
  linkage         numeric(5,2),
  geometry_validity numeric(5,2),
  source_availability numeric(5,2),
  score           numeric(5,2),
  breakdown       jsonb NOT NULL DEFAULT '{}',
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_parcel_idx ON quality_metrics(parcel_id, computed_at DESC);

-- ---------------------------------------------------------------------------
-- Database views for fast read paths
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_parcel_risk AS
SELECT
  p.parcel_id,
  count(f.finding_id) FILTER (WHERE f.status <> 'DISMISSED') AS finding_count,
  max(CASE f.severity WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)
    FILTER (WHERE f.status <> 'DISMISSED') AS max_severity_rank
FROM parcels p
LEFT JOIN integrity_findings f ON f.parcel_id = p.parcel_id
GROUP BY p.parcel_id;

CREATE OR REPLACE VIEW v_case_load AS
SELECT
  coalesce(assigned_role, 'UNASSIGNED') AS role_code,
  status,
  count(*) AS case_count
FROM verification_cases
GROUP BY 1, 2;
