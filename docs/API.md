# API

All endpoints are served by the API process (default `http://localhost:12001`) under the
`/api` prefix. Requests and responses are JSON. Every endpoint validates its request with a
zod schema and returns a consistent error envelope.

**Success** returns the resource directly (or `{ items, total, limit, offset }` for lists).

**Error** returns:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "limit must be an integer between 1 and 100",
    "details": null,
    "requestId": "b74d1386-…"
  }
}
```

Common codes: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`VALIDATION_ERROR` (400), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (502),
`INTERNAL_ERROR` (500). Response details never include a stack trace, a database URL, a
token or a secret.

**Authentication** accepts a session cookie or an `Authorization: Bearer <token>` header.
Endpoints noted *anonymous* are readable without authentication and return the masked,
citizen-safe projection.

**Authorization** is enforced by permission codes, not by route hiding. A route marked with
a permission returns `403 FORBIDDEN` with the missing permission name when the caller's role
lacks it.

---

## Meta, health and capabilities

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/meta` | anonymous | Product name, version, data mode, dataset notice |
| GET | `/api/health` | anonymous | Database, PostGIS, adapters, latency, version |
| GET | `/api/auth/capabilities` | anonymous | Roles, permission codes, workflow service types |
| GET | `/api/stats` | anonymous | Aggregate platform counters |
| GET | `/api/districts` | anonymous | District/village coverage list |

## Authentication

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | rate-limited | Exchange credentials for a session; bcrypt-verified, sets an httpOnly cookie and returns a bearer token |
| POST | `/api/auth/logout` | authenticated | Invalidate the session |
| GET | `/api/auth/me` | authenticated | Current user, role, permissions, capabilities |

`POST /api/auth/login` body: `{ "username": string, "password": string }`. The route is rate
limited (12 requests / 60 s / key) to blunt credential stuffing.

## Parcels and geometry

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/parcels` | anonymous | Paged parcel list; filters `district`, `village`, `q`, `limit`, `offset` |
| GET | `/api/parcels/:parcelId` | anonymous | Parcel detail with integrity summary |
| GET | `/api/passport/:parcelId` | anonymous | Full land passport; masking applied by the caller's role |
| GET | `/api/parcels/:parcelId/timeline` | anonymous | Bitemporal timeline of record, finding, case and audit events |
| GET | `/api/geojson` | anonymous | GeoJSON `FeatureCollection` of parcels; filters by district, village, risk, finding |
| GET | `/api/layers` | anonymous | GIS layer catalogue with source, authority, opacity, visibility |
| GET | `/api/layers/:layerId/features` | anonymous | GeoJSON features for a layer, bounded by bbox/limit |
| GET | `/api/osm-context` | rate-limited | Bounded Overpass contextual query (nearest road, buildings, water, amenities) |
| GET | `/api/satellite/observations` | anonymous | Satellite observation records for a parcel |
| POST | `/api/satellite/catalogue` | anonymous | Copernicus catalogue search architecture; returns `REQUIRES_AUTH` when unconfigured |

Each GeoJSON feature's `properties` include `parcelId`, `displayId`, `surveyNumber`, `area`,
`risk`, `status` and `findingCount`, and each carries its `dataStatus`.

## Integrity

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/findings` | anonymous | Findings, filterable by parcel, rule, severity, status |
| GET | `/api/rules` | anonymous | Rule definitions with thresholds and deduction weights |
| PATCH | `/api/rules/:ruleCode` | `rule.configure` | Adjust a rule threshold; audited |
| PATCH | `/api/findings/:findingId` | `finding.update` | Move a finding between OPEN / UNDER_REVIEW / RESOLVED / DISMISSED; audited |

## Search

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/search` | rate-limited | Unified search: `parcelId`, display/ULPIN-like ID, survey number, subdivision, owner, village, taluk, district, address, coordinates |
| POST | `/api/search` | rate-limited | Same contract with a JSON body, for structured filters |

Response hits include `parcelId`, `displayId`, `matchType`, `confidence`, `riskBand`, `score`,
`findingCount`, `findingCodes`, `linkage`, `dataStatus` and location. When no language model
is configured the endpoint returns a **structured search fallback** with `fallbackUsed: true`;
search never depends on an LLM.

## Cases and verification workflow

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/cases` | authenticated | Case list; filters status, priority, officer, role, parcel, district, village |
| GET | `/api/cases/:caseId` | authenticated | Case detail with events, comments, assignments and linked parcel |
| POST | `/api/cases` | authenticated | Create a verification case (`SUBMITTED`); writes a case event and an audit row |
| POST | `/api/cases/:caseId/update` | authenticated | Transition status / assign / comment / escalate; transactional, writes events and audit |
| GET | `/api/cases-workflow/definition` | anonymous | Declared statuses and allowed transitions |

Statuses: `SUBMITTED`, `UNDER_REVIEW`, `FIELD_VERIFICATION`, `RESOLVED`, `ESCALATED`.

## Officer

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/officer` | officer/admin | Role-scoped dashboard: open/high-risk/field-verification/escalated/due, unlinked, ownership and area counts, case queue, workload, `caseTotal` (in scope) and `platformCaseTotal` |
| GET | `/api/officers` | `case.assign` | Assignable officers |

## Citizen services

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/service-requests` | authenticated | Create a service request (ownership verification, parcel/area correction, document update, registration/tax inquiry, building verification, other) |
| GET | `/api/service-requests` | authenticated | Requests visible to the caller's role |
| POST | `/api/service-requests/:requestId/update` | authenticated | Advance a request; every transition is audited |
| GET | `/api/notifications` | authenticated | In-app notifications |
| POST | `/api/notifications/:id/read` | authenticated | Mark a notification read |

## Analytics, gateway and data fabric

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/analytics` | `analytics.read` | KPIs, distributions and trends, all computed from the database at request time |
| GET | `/api/gateway` | `gateway.read` | Per-department adapter status, sync counts, coverage and internal entity mapping |
| GET | `/api/data-sources` | anonymous | Source catalogue; `?probe=true` runs live upstream probes |
| GET | `/api/data-sources/:sourceId` | anonymous | One source with provenance metadata and licence note |
| POST | `/api/data-sources/:sourceId/toggle` | `source.configure` | Enable/disable a source; audited |

## Administration and audit

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | `user.manage` | Studio console: users, roles, rule and workflow configuration |
| GET | `/api/admin/ingestion` | `source.configure` | Ingestion runs and errors |
| GET | `/api/audit` | `audit.read` | Audit log; filters actor, entity type, action, date range |
| GET | `/api/temporal` | `audit.read` | Temporal version inspection |

## Reports

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/reports/parcel/:parcelId` | anonymous | Downloadable parcel summary with the mandatory disclaimer |
| GET | `/api/reports/case/:caseId` | authenticated | Case report |
| GET | `/api/reports/geojson` | anonymous | GeoJSON export |
| GET | `/api/reports/audit` | `audit.read` | Audit report |

Generated reports are stamped with `BHUMISETU`, the provenance of each field, a generated
timestamp and the data status, and carry the disclaimer:

> This report is a digital information and verification-support view. It does not by itself
> constitute a legal determination, title certificate, ownership certificate, or government
> record.

---

## Rate limits

Outward-facing and mutation endpoints are rate limited: login (12/60 s), search
(120/60 s), and OSM context (90/60 s). Limits are enforced server-side; the client surfaces
a retry state on `429` rather than failing silently.

## Versioning

The application version is reported by `/api/health` and `/api/meta`. Additive fields are
introduced compatibly; existing response shapes are not broken within a version.
