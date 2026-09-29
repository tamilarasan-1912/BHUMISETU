# AGENTS.md — BHUMISETU working notes

Parcel-centric land governance platform. npm workspaces monorepo: `server/` (Fastify-style
typed REST + PostgreSQL 17/PostGIS), `web/` (React + Vite + Leaflet PWA), `docs/`.

## Verify before claiming green

Run all of these; a typecheck pass alone proves little here.

```bash
npm run typecheck              # web (tsc -b --noEmit)
cd server && npx tsc --noEmit  # server, including scripts/
npm test                       # 82 tests (vitest, both workspaces resolve here)
cd server && npx vitest run    # same 82 via the server workspace directly
npm run build                  # web production build + Workbox precache
cd server && npm run verify:api  # live API harness, needs a running server
npm run audit:ui -- --label desktop --width 1440 --height 900   # browser console + layout
```

`npm run verify:api` requires the API on `http://localhost:12001` (override with
`BHUMISETU_BASE_URL`). It creates probe cases and service requests and deletes them on exit,
so it is idempotent — after a clean run the DB is back to **1 case, 0 service requests**.
If a run crashes before cleanup, probe rows are left behind; check
`SELECT count(*) FROM verification_cases` if counts look inflated.

`npm run audit:ui` drives headless Chromium over CDP (`scripts/browser-audit.py`) against
`http://localhost:12000` and fails on any console error, uncaught exception, or horizontal
overflow at the given viewport. Sweep 360 / 390 / 768 / 1024 / 1440 when touching layout.
It does not check the production build by default — see `docs/DEPLOYMENT.md` to point
`--base` at the preview server. Note it appends `PASSPORT_VIEWED` audit rows; that is the
append-only audit trail working as designed, not test residue to clean.

## Non-obvious API contract facts

These cost real debug cycles. Check them before writing assertions.

- **`/api/gateway`, `/api/analytics` and `/api/temporal` require authentication** and return
  401 unauthenticated. Use the seeded `revenue` / `officer@123` officer token.
- **Permission-gate optional fetches with `useAsync(..., { enabled })`,** not by hoping the
  request succeeds. `/api/audit` needs `audit.read`; the landing page holds the request back
  until `user.permissions` contains it, because an unauthenticated call guarantees a 401 and
  a console error. Any panel that is optional for signed-out visitors should do the same.
- **`/api/rules`** returns `{ items, canonical }`. `canonical` entries are camelCase
  (`ruleCode`), while `items` (raw DB rows) are snake_case (`rule_code`).
- **Does not exist:** `GET /api/findings/:findingId`. Only `PATCH` is registered there.
  Finding evidence lives on the passport — `GET /api/passport/:parcelId` returns
  `findings[].evidence[]` each carrying `sourceId`, `sourceAuthority`, `dataStatus`,
  `provenance`.
- **Audit action names** are `SERVICE_REQUEST_CREATED` and `SERVICE_REQUEST_UPDATED`
  (not `..._STATUS_CHANGED`).
- **CSV reports** (`/api/reports/parcel/:id?format=csv`) quote every field:
  `"Section","Field","Value","Source","Authority","Data status"`.
- **Unconfigured features** return **501** with `{ unavailable: true }` from
  `/api/unavailable/:feature` — deliberate disclosures, not gaps. Do not "fix" them.
- **`rawPool.query` passing an array param:** use `ANY($1::text[])`, `[[...arr]]`
  (double-wrapped). Passing the spread array binds one param per element and errors with
  `bind message supplies N parameters`.
- **Frontend parcel route is `/passport/:parcelId`.** `/parcels/:parcelId` 404s by design;
  `/parcels` is the register list.

## Adapter status honesty (do not regress)

External adapters (Overpass, Bhuvan, TNGIS, OSM) fail in this sandbox — that is expected and
must surface as `UPSTREAM_UNAVAILABLE` / `ADAPTER_READY`, never as `CONNECTED`. Status reads
are served from a **bounded cached snapshot**; `probeAll()` must never be awaited on a
request path (that previously made `/api/gateway` take ~24s and render empty).

`DEMO_DATA` means a deliberately labelled fixture serving real records — it is **not** an
error state. Do not treat it as a failure in health or count logic.

## Seed credentials (demonstration only)

`citizen` / `citizen@123`, `revenue` / `officer@123`, `admin` / `admin@123`. Never reuse
these in production paths.

## Invariants to preserve

- Six parcels `PARC-A..PARC-F` with exactly one expected finding each, `PARC-A` clean.
  Cross-parcel finding leakage is a bug.
- The integrity engine recomputes at read time; findings are not a stored source of truth.
- Every case status change writes a case event **and** an audit record in one transaction.
- Case display numbers are monotonic via sequences; a deleted case must never free its
  number for reuse.
- Audit records are append-only and never modified by application code.
- A case's satellite records (case events, comments, assignments, audit rows, and
  `temporal_versions`) are addressed by case id, not by a foreign key. Deleting a case
  therefore leaves them behind, so every path that deletes a case must remove them. The
  verification harness sweeps for orphans on exit; the parcel timeline also filters
  `temporal_versions` to `entity_type <> 'case'`, because case history is already rendered
  from `case_events` and would otherwise appear twice.
