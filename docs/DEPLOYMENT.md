# Deployment

## Requirements

| Component | Version |
| --- | --- |
| Node.js | ≥ 20 |
| PostgreSQL | 17 (PostGIS recommended, not required) |
| npm | ≥ 10 |

BHUMISETU is a modular monolith. There is no Kubernetes, no service mesh and no message
broker to operate. A single API process and a single database are sufficient.

## Configuration

Configuration is read once at boot in `server/src/config.ts`. Every value has a development
default; in production, `JWT_SECRET` and `DATABASE_URL` must be supplied explicitly.

### Core

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Enables production checks when `production` |
| `PORT` | `12001` | API listen port |
| `WEB_ORIGIN` | `*` | CORS origin for the web client |
| `DATABASE_URL` | `postgres://bhumisetu:bhumisetu_dev_pw@127.0.0.1:5432/bhumisetu` | PostgreSQL connection string |
| `JWT_SECRET` | random per boot in dev | Session signing key — **required in production** |
| `JWT_EXPIRY_SECONDS` | `43200` | Session lifetime (12 h) |

### Adapters

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADAPTER_TIMEOUT_MS` | `8000` | Per-request adapter timeout |
| `ADAPTER_RETRIES` | `2` | Bounded retry count |
| `ADAPTER_CACHE_TTL_MS` | `600000` | Contextual cache TTL (10 min) |
| `ADAPTER_HEALTH_TTL_MS` | `120000` | How long a probed status stays authoritative |
| `HEALTH_BUDGET_MS` | `2000` | Hard ceiling for a synchronous health report |
| `OVERPASS_RADIUS_LIMIT_M` | `1500` | Maximum Overpass query radius |
| `OVERPASS_URL` | `https://overpass.kumi.systems/api/interpreter` | Overpass endpoint |
| `BHUVAN_WMS_URL` | `https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms` | Bhuvan WMS endpoint |
| `TNGIS_BASE_URL` | `https://tngis.tn.gov.in/` | TNGIS base URL |
| `SURVEY_OF_INDIA_URL` | `https://onlinemaps.surveyofindia.gov.in/` | Survey of India portal |

### Optional credentials

Unset by default. The application runs fully without any of them; the corresponding adapter
reports `REQUIRES_AUTH` or `NOT_CONFIGURED`.

| Variable | Purpose |
| --- | --- |
| `COPERNICUS_CLIENT_ID` | Copernicus Data Space OAuth client |
| `COPERNICUS_CLIENT_SECRET` | Copernicus Data Space OAuth secret |
| `COPERNICUS_TOKEN_URL` | Token endpoint override |
| `DATA_GOV_IN_API_KEY` | data.gov.in API key |
| `OTHER_SOURCE_API_KEY` | Generic reserved adapter key |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` | Optional AI provider — never required for core operation |

Secrets are read server-side only and are never included in the web bundle.

## First-time setup

```bash
npm install
npm run migrate     # idempotent schema creation
npm run seed        # idempotent demonstration dataset
npm run dev         # API :12001 + web :12000
```

## Production build and run

```bash
npm run typecheck
npm test
npm run build                    # web build + PWA service worker into web/dist
NODE_ENV=production \
  DATABASE_URL='postgres://…' \
  JWT_SECRET='<long random secret>' \
  WEB_ORIGIN='https://your-domain' \
  npm start                      # serves the API
```

Serve `web/dist` from any static host or reverse proxy and point it at the API. The client
reads the API base URL from its environment; it holds no secrets.

## Verifying a running deployment

Two harnesses exercise the application beyond unit tests. Both need the API and web
server running:

```bash
npm run verify:api                                    # API contract and workflow checks
npm run audit:ui -- --label desktop --width 1440 --height 900
npm run audit:ui -- --label mobile  --width 390  --height 844
```

`verify:api` drives the real HTTP surface and cleans up the records it creates.

`audit:ui` drives a headless Chromium over the DevTools Protocol and visits every route,
failing on any console error, uncaught exception, or horizontal overflow at the given
viewport. Run it at several widths when changing layout. A missing tile or a failed call
to a public upstream that the app already degrades on is treated as expected; anything
else is reported. Against the production build, point it at the preview server:

```bash
npm --workspace web run build
npm --workspace web run preview -- --port 12010   # has an API proxy
npm run audit:ui -- --base http://localhost:12010 --label prod --width 1440 --height 900
```

## Database operations

| Task | Command | Notes |
| --- | --- | --- |
| Apply migrations | `npm run migrate` | Idempotent; safe to run on every deploy |
| Seed demonstration data | `npm run seed` | Idempotent upserts by stable id |
| Rebuild schema | `npm run db:reset` | **Destructive** — drops and recreates; never run during a normal deploy |

Migrations do not destroy existing data during a normal deployment. The destructive path is
confined to the explicit `db:reset` script.

## Health and monitoring

`GET /api/health` reports database reachability and latency, PostGIS availability, adapter
status, source latency, last successful sync, failed request counts and application version.
The `/health` page in the UI renders the same information, and `/sources` reports per-adapter
reachability. A degraded upstream is visible but does not take the platform down.

## Operational notes

- **Rate limits** apply to login, search and the OSM context endpoint. Tune them at the
  reverse proxy for higher traffic.
- **Caching** — contextual adapter results are cached with a TTL. Do not disable the cache;
  it is what keeps Overpass off the request path.
- **Connection pool** — the pool is capped (12 connections, 30 s idle timeout). Size it to
  the database, not to the request rate.
- **Backups** — back up PostgreSQL normally. Demonstration data can be regenerated at any
  time with `npm run seed`.
- **PWA updates** — the service worker precaches the app shell. After a deploy, clients pick
  up the new version on next load.

## Scaling

The application scales vertically and by read replicas on the database. Because every
external call is bounded, cached and rate limited, load on upstream providers does not grow
with user count. The modular domains can be extracted into separate services later without
changing the data model or the API contract.
