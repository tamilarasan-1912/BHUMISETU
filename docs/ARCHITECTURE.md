# Architecture

## Overview

BHUMISETU is a **modular monolith**. One API process, one PostgreSQL database, one web
client. The domains are separated in source, not in deployment: there are no microservices,
no message broker, and no orchestration layer to run.

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  web/  React + TypeScript │  HTTP  │  server/  TypeScript API  │
│  Leaflet GIS · PWA shell  │ ─────▶ │  Express-style endpoints  │
└───────────────────────────┘        └───────────┬───────────────┘
                                                 │ Kysely + pg pool
                                                 ▼
                                     ┌───────────────────────────┐
                                     │  PostgreSQL 17 (+PostGIS) │
                                     │  normalized parcel schema │
                                     └───────────────────────────┘
                                                 ▲
                                                 │ adapter registry (bounded, cached)
                                     ┌───────────┴───────────────┐
                                     │  OSM · Overpass · Bhuvan  │
                                     │  TNGIS · Copernicus · …   │
                                     └───────────────────────────┘
```

## Principles

1. **The parcel is the organising object.** Ownership, RoR, registration, encumbrance, tax,
   planning, land use, judiciary, satellite, findings, evidence, cases, documents, timeline
   and audit all attach to a parcel. There are no disconnected dashboards.
2. **Provenance is mandatory.** Every material value carries a source, authority, timestamp
   and data-status label (`REAL` / `DERIVED` / `CONTEXTUAL` / `AI` / `DEMONSTRATION`).
3. **Findings are recomputed, not stored as truth.** The integrity engine runs at read time;
   persisted finding rows are a cache for queue queries, reconcilable from current records.
4. **External failure is a state, not an exception.** Adapters report `UPSTREAM_UNAVAILABLE`
   and the platform continues to operate.
5. **Never overstate.** A source is `CONNECTED` only when a live probe succeeded.

## Server layout (`server/src`)

| Directory | Responsibility |
| --- | --- |
| `endpoints/` | HTTP routes, request validation, authorization wiring |
| `services/` | Application services: passport, intelligence, workflow, analytics, search, gateway |
| `domain/` | Pure domain logic — the deterministic integrity engine and its rules |
| `adapters/` | External integration contracts and implementations |
| `auth/` | Session issuing/verification, RBAC permission model, masking policy |
| `db/` | Connection pool, migrations, schema, idempotent seed |
| `data/` | Source catalogue, role/permission tables, parcel fixtures |
| `helpers/` | HTTP envelope, errors, masking primitives, formatting |
| `types/` | Shared domain and API types |
| `tests/` | Deterministic unit tests |
| `config.ts` | Environment-driven configuration |

## Request flow

```
HTTP request
  → rate limit / body parse
  → route match
  → requireAuth (session cookie or bearer)
  → requirePermission('…')            RBAC gate
  → zod schema validation
  → service layer                     business logic
  → Kysely / pg (parameterized SQL)
  → role-aware presentation           masking + provenance
  → typed response envelope
```

Errors return a consistent envelope (`{ error: { code, message, details, requestId } }`) so
the client can render a precise state rather than a blank page. No stack trace or secret is
ever serialized to the client.

## The integrity engine

`domain/integrity-engine.ts` is a pure function of a parcel's record set:

```
records  →  evaluateParcel()  →  IntegrityFinding[]
```

Rules:

| Rule code | Trigger | Severity |
| --- | --- | --- |
| `OWNERSHIP_MISMATCH` | RoR/tax holder disagrees with the latest registered deed transferee | HIGH |
| `AREA_MISMATCH` | Cadastral area differs from the asserted RoR area beyond tolerance | MEDIUM |
| `TAX_MISMATCH` | Assessment holder differs from the recorded holder | MEDIUM |
| `ENCUMBRANCE_RISK` | Active mortgage with no NOC, or recent transfer over an encumbrance | HIGH |
| `BUILDING_UNAPPROVED_CHANGE` | A possible change observation with no matching building approval record | MEDIUM |
| `NOT_LINKED` | Geometry exists but no RoR linkage | LOW |

Every finding carries: `findingId`, `parcelId`, `ruleCode`, `severity`, `confidence`,
`title`, `description`, `sourceRecords`, `timestamps`, `expectedValue`, `observedValue`,
`ruleUsed`, `routedAuthority`, `recommendedAction` and `status`.

Findings are worded as reconciliation prompts, never as accusations. `data_status` travels
with each finding so a demonstration fixture is never presented as a government record.

### Verification-support score

A transparent, explainable score starting at 100 with documented deductions
(ownership −25, encumbrance −30, building change −18, not linked −20, judiciary −15,
area −12, tax dues −8). Bands: `VERIFIED` 80–100, `REVIEW` 50–79, `HIGH RISK` 0–49.
The UI shows exactly which points were deducted and why. It is explicitly labelled an
internal verification-support indicator, **not a legal score**.

## Intelligence and provenance

`services/intelligence.ts` assembles the rule outputs, the record set, linkage state, data
quality and the bitemporal timeline for a parcel. `services/passport.ts` composes the full
land passport from these plus the domain sections, applying the caller's masking policy at
the boundary. A recursive scrub removes party names embedded in free text (finding
descriptions, evidence values, timeline prose) so a citizen view cannot leak an identifier
through an unmasked string.

## Data fabric

`adapters/` defines one interface (`DataAdapter`) with `sourceMetadata()`, `health()`,
`cachedHealth()` and `lastSync()`. A registry holds every adapter, applies a TTL cache,
enforces timeouts and bounded retries, and records the outcome. Contextual queries
(Overpass) are rate-limited and radius-bounded; bulk sources (Geofabrik) declare an
ingestion path but never download during a request.

`services/gateway.ts` maps each department's records into the normalized internal entities
(Parcel, Party, Right, Restriction, Document, Registration, Tax, Planning, Judiciary) and
reports adapter status, sync counts and coverage.

## Web layout (`web/src`)

| Path | Responsibility |
| --- | --- |
| `pages/` | Route-level views (map, parcels, intelligence, cases, officer, analytics, gateway, sources, studio, citizen, passport, account, health) |
| `components/ui.tsx` | The design system: GlassCard, GlassPanel, StatusBadge, RiskBadge, SourceBadge, DataProvenance, MetricCard, Timeline, DataTable, EmptyState, LoadingState, ErrorState, and more |
| `hooks/` | `useAsync` (loading / refreshing / error / reload), debounce, persistent state, media queries |
| `services/api.ts` | Typed API client with abort support and a single error type |
| `types/` | API response types mirroring the server contracts |

Every asynchronous view renders one of three honest states: a skeleton, a populated view, or
an error with a retry — never a blank screen.

## Progressive web app

`vite-plugin-pwa` generates a service worker with a precache manifest and an offline app
shell. The manifest, icons and mobile navigation are part of the same build; there is no
separate mobile codebase and no duplicated business logic.

## Extension points

The architecture makes these additive rather than invasive: ULPIN, Bhu-Naksha, Tamil Nilam,
official registration and municipal taxation systems, live eCourts, state GIS endpoints,
satellite ML behind the change-detection adapter, document OCR, an optional AI provider
(never a hard dependency), 3D parcel visualisation, OGC WMS/WFS, OpenAPI generation,
QR-verifiable certificates, and offline field capture.
