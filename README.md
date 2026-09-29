# BHUMISETU

**BHUMISETU — Integrated GIS Land Stack & Parcel Intelligence Platform**

*One Parcel. One Digital Identity. Every Record. Every Change.*

BHUMISETU is a parcel-centric land governance digital public infrastructure platform.
The parcel is the single organising object: every record, finding, case, document and
audit event in the system attaches to a spatial unit, and every value shown in the UI is
traceable to a source with a stated authority and data status.

It is built as a modular monolith — a TypeScript API server, a PostgreSQL database, and a
React + Leaflet web client — with no microservices, no Kubernetes, and no paid services
required for core functionality.

---

## What this is, and what it is not

**This is** a working full-stack application with a persistent database, a deterministic
integrity engine, a verification workflow, an audit trail, a data-fabric control plane and
a parcel land passport.

**This is not** a source of official government land records. The governance records in
this deployment are **clearly labelled demonstration fixtures** unless a source is
explicitly marked REAL. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for the exact
real/demonstration boundary.

BHUMISETU never claims that:

- OpenStreetMap is a cadastral or ownership authority (it is contextual geographic data);
- satellite imagery proves ownership;
- a detected building change is a legally unauthorised construction;
- a rule-engine finding proves fraud, illegality, invalid ownership or a live dispute.

Findings use language such as *possible discrepancy*, *records require reconciliation*,
*field verification required*, and *requires review*. The integrity score is an internal
verification-support indicator, never a legal score.

---

## Quick start

Requirements: Node.js ≥ 20, PostgreSQL 17 with PostGIS (optional but recommended).

```bash
# 1. Database (adjust to your local setup)
createdb bhumisetu
psql bhumisetu -c 'CREATE EXTENSION IF NOT EXISTS postgis;'

# 2. Configure (all values have development defaults except in production)
export DATABASE_URL='postgres://bhumisetu:bhumisetu_dev_pw@127.0.0.1:5432/bhumisetu'

# 3. Install, migrate and seed
npm install
npm run migrate
npm run seed

# 4. Run both workspaces (API on 12001, web on 12000)
npm run dev
```

Open the web URL (default <http://localhost:12000>). The API listens on
<http://localhost:12001>.

### Demonstration sign-in

Seeded development accounts (passwords are bcrypt-hashed; the values below are the
documented development fixtures):

| Username | Password | Role |
| --- | --- | --- |
| `citizen` | `citizen@123` | CITIZEN |
| `field` | `officer@123` | FIELD_OFFICER |
| `revenue` | `officer@123` | REVENUE_OFFICER |
| `registration` | `officer@123` | REGISTRATION_OFFICER |
| `municipal` | `officer@123` | MUNICIPAL_OFFICER |
| `planning` | `officer@123` | PLANNING_OFFICER |
| `judiciary` | `officer@123` | JUDICIARY_VIEWER |
| `gis` | `admin@123` | GIS_ADMIN |
| `admin` | `admin@123` | SYSTEM_ADMIN |

Anonymous access is permitted for a masked, citizen-safe view of public parcel
information. Authenticated officers see internal notes and unmasked party names.

---

## The demonstration dataset

Six demonstration parcels are seeded idempotently at boot. Each is defined to exercise one
integrity rule, so the engine's output is verifiable end to end:

| Parcel | Display ID (synthetic) | Finding | Severity |
| --- | --- | --- | --- |
| `PARC-A` | `3301DEMO000041` | none (clean parcel) | — |
| `PARC-B` | `3301DEMO000042` | `OWNERSHIP_MISMATCH` | HIGH |
| `PARC-C` | `3301DEMO000043` | `AREA_MISMATCH` | MEDIUM |
| `PARC-D` | `3301DEMO000044` | `ENCUMBRANCE_RISK` | HIGH |
| `PARC-E` | `3301DEMO000045` | `BUILDING_UNAPPROVED_CHANGE` | MEDIUM |
| `PARC-F` | `3301DEMO000046` | `NOT_LINKED` | LOW |

The `3301DEMO…` identifiers are **synthetic identifiers in a ULPIN-compatible format**.
They are not official ULPIN values.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API + web concurrently |
| `npm run build` | Production web build with PWA service worker |
| `npm run typecheck` | TypeScript check across both workspaces |
| `npm test` | Deterministic unit tests (integrity engine, workflow/RBAC/masking, sources) |
| `npm run migrate` | Apply idempotent schema migrations |
| `npm run seed` | Seed demonstration data (idempotent) |
| `npm run db:reset` | Drop and rebuild the schema |
| `npm run verify:api` | Live end-to-end API checks against a running server |
| `npm start` | Run the API server |

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, domains, request flow, integrity engine |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, entities, temporal model, indexes |
| [docs/API.md](docs/API.md) | Every endpoint, its authorization, request and response |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Source catalogue, adapter status, real vs demonstration |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, RBAC, masking, hardening, privacy boundaries |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Configuration, environment variables, operations |

---

## Interface

Routes: `/` (map command centre), `/parcels`, `/intelligence`, `/cases`, `/officer`,
`/analytics`, `/gateway`, `/sources`, `/studio`, plus a masked citizen portal.

The visual language is a restrained government GIS command centre: translucent glass
surfaces, thin borders, soft elevation, a deep civic palette, and maps that stay readable.
The map is the primary surface and remains visually dominant.

A global data-mode indicator (`REAL DATA` / `DEMONSTRATION` / `MIXED`) is always visible, so
a demonstration record can never be mistaken for a government record.

---

## Integrations

BHUMISETU architecturally supports and, where a public endpoint is genuinely reachable,
connects to: TNGIS, Bhuvan/ISRO WMS, OpenStreetMap, the Overpass API, Geofabrik, Copernicus
Data Space, Survey of India, data.gov.in, NBSS & LUP soil data, DataMeet boundaries, and
eCourts-style judiciary feeds.

A source is marked `CONNECTED` only when a live upstream request actually succeeded. Where
an official API is unavailable, the adapter interface exists and the gap is stated plainly
rather than filled with fabricated data. External failure never breaks the application:
every adapter has a timeout, bounded retries, caching and a visible degradation path.

---

## License and attribution

Map data © OpenStreetMap contributors (ODbL 1.0). Bhuvan imagery and thematic layers
© ISRO / NRSC. Survey of India maps © Survey of India. Copernicus data © ESA. Each source's
terms and licence note is recorded in the source catalogue and surfaced in the UI.
