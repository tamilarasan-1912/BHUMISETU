# Data sources

The source catalogue is the control plane for every feed into BHUMISETU. It is defined in
`server/src/data/source-catalogue.ts` and surfaced at `/sources` and `/api/data-sources`.
Each entry states its authority, coverage, licence note and whether it is authoritative,
contextual, derived or demonstration.

## Status semantics

A status is a statement about the integration, not a marketing claim.

| Status | Meaning |
| --- | --- |
| `CONNECTED` | A live upstream request succeeded and returned a usable response |
| `AVAILABLE` | The public endpoint is reachable without credentials |
| `ADAPTER_READY` | The adapter interface is implemented and registered; no upstream harvest is configured, so no data is claimed |
| `UPSTREAM_UNAVAILABLE` | The last probe failed; the cached status and error are shown and the platform keeps running |
| `REQUIRES_AUTH` | Credentials are necessary and must be supplied through environment variables |
| `DEMO_DATA` | A labelled fixture substitutes for the authoritative feed |
| `NOT_CONFIGURED` | Not enabled, by design or by an administrator |

**`CONNECTED` is never displayed unless a live probe actually succeeded.** Where a source is
registered but not harvested, the honest status is `ADAPTER_READY` — the interface exists,
and no data is claimed.

## Registered sources

### Real, publicly reachable

| Source | Organization | Category | Nature | Notes |
| --- | --- | --- | --- | --- |
| OpenStreetMap | OpenStreetMap Foundation / contributors | `CONTEXT_GIS` | contextual | Tiles and API. Not a cadastral or ownership authority |
| Overpass API | OpenStreetMap community mirrors | `CONTEXT_GIS` | contextual, derived | Bounded radius queries; timeout, retry, cache and rate limit enforced |
| Survey of India — Open Series Maps | Survey of India, Government of India | `NATIONAL_MAPPING` | authoritative | Records map authority and purpose; restricted sheets need portal access |
| data.gov.in | National Informatics Centre, Government of India | `OPEN_DATA` | contextual | Optional `DATA_GOV_IN_API_KEY`; rate limited and cached |
| Copernicus Data Space Ecosystem | ESA / European Commission | `SATELLITE` | contextual | Sentinel-2 catalogue access via OAuth; credentials supplied through environment variables |
| Tamil Nadu Geographic Information System (TNGIS) | Government of Tamil Nadu | `STATE_GIS` | authoritative | Administrative boundaries, land use, roads, water bodies; adapter interface until an authorised endpoint is supplied |
| Bhuvan WMS — LULC | ISRO / NRSC | `SATELLITE_CONTEXT` | contextual | Contextual land-use/land-cover WMS; degrades to "layer temporarily unavailable" |
| NBSS & LUP soil context | ICAR — NBSS&LUP | `SOIL` | contextual | Agronomic context only; never parcel ownership or legal evidence |
| Geofabrik India extracts | Geofabrik GmbH | `BULK_CONTEXT` | contextual, derived | Offline bulk ingestion path (India / Southern Zone / Tamil Nadu); never downloaded during a request |
| DataMeet boundary data | DataMeet community | `BOUNDARY` | contextual, derived | Community boundary ingestion for development use; not the legal boundary authority |

### Demonstration fixtures (clearly labelled)

`DEMO_DATA`, authority "Demo fixture", `is_demonstration = true`:

| Source | Supplies |
| --- | --- |
| Revenue Record Adapter (demonstration) | RoR, cadastral area, land classification |
| Registration Adapter (demonstration) | Deeds, registration documents, transfer chain |
| Municipal Tax Adapter (demonstration) | Property tax demand, payments, dues |
| Planning & Building Adapter (demonstration) | Building permissions, zoning, land use |
| eCourts Adapter (demonstration) | One demonstration case (`OS-2025-114`) |
| Cadastral Geometry Adapter (demonstration) | Parcel polygons, centroids, planar area |
| Change Detection Adapter (demonstration) | One observation on `PARC-E`, `possibleChange = true`, confidence `0.91` |

Every one of these is labelled in the UI with the `◇ DEMO` chip. The passport carries the
notice *"Demonstration records — not official government land records."*

## Real vs demonstration — the exact boundary

**Real in this deployment:** OpenStreetMap and Overpass contextual queries (when the upstream
responds), the Survey of India and data.gov.in adapter metadata, the Bhuvan WMS tile URL, and
the Copernicus catalogue adapter. These are geography, imagery and open-data *context*.

**Demonstration in this deployment:** all governance records — ownership, RoR, registration,
encumbrance, tax, planning, judiciary, and the integrity findings derived from them. The
`PARC-A … PARC-F` parcels, their geometry, and every `3301DEMO…` identifier are synthetic.

The global data-mode indicator reads `MIXED`: **real GIS context + demonstration governance
records**. This distinction is never collapsed.

## Adapting a real source

`server/src/adapters/base.ts` defines the contract:

```ts
interface DataAdapter {
  sourceId: string;
  sourceMetadata(): SourceMetadata;   // authority, licence, nature flags
  health(): Promise<AdapterHealth>;   // probe — never throws
  cachedHealth?(): AdapterHealth | null;
  lastSync(): Promise<{ lastAttemptAt; lastSuccessAt; lastError }>;
}
```

An adapter must:

1. Never throw from `health()` — an unreachable upstream is a reported state.
2. Carry explicit nature flags (`isAuthoritative`, `isContextual`, `isDerived`,
   `isDemonstration`) so presentation can label it correctly.
3. Respect timeout, bounded retries and the TTL cache; never call a heavy upstream on every
   request, and never download a bulk extract inside a request.
4. Keep credentials in environment variables only — never in the client bundle.

Adding TNGIS WFS, a live eCourts feed, a ULPIN service, Bhu-Naksha or Tamil Nilam is a
matter of implementing this interface and registering it; no UI or schema change is needed.

## Ingestion pipeline

```
SOURCE → FETCH → VALIDATE → NORMALIZE → MAP → PROVENANCE → STORE → INDEX → ANALYZE → DISPLAY
```

Each run is recorded in `ingestion_runs` with status, counts and errors, inspectable at
`/studio` → Ingestion and `GET /api/admin/ingestion`.

## Degradation policy

- Every adapter call has a timeout and bounded retries, and records its outcome.
- Contextual calls are cached with a TTL; Overpass is never called on every render.
- A failed tile or WMS layer degrades to the neutral basemap with a visible message.
- A failed contextual query shows a notice and leaves the parcel workflow fully usable.
- External failure never crashes the frontend and never blocks core parcel workflow.

## Known upstream limitations in this environment

These are the actual observed states, not aspirations:

- **OpenStreetMap** — the tile/API endpoint was reachable but the probe recorded
  `HTTP 406` (a server-side content-negotiation rejection). Tiles may still render in the
  browser; the adapter reports only what the probe saw.
- **Overpass** — the public mirror timed out at the configured budget (`timeout after
  12000ms`). Contextual queries degrade to a notice.
- **Bhuvan WMS** — the WMS endpoint timed out at the configured budget
  (`timeout after 9000ms`). The layer degrades to "temporarily unavailable".
- **TNGIS** — portal reachable but timed out at the budget (`timeout after 6000ms`); the
  adapter remains `ADAPTER_READY`, not `CONNECTED`.
- **Copernicus** — `REQUIRES_AUTH`; no OAuth client is configured in this deployment.
- **Survey of India** — last probe succeeded; map downloads still require portal access.

None of these prevent the application from operating, which is the design intent.

## Licences and attribution

| Source | Licence / terms |
| --- | --- |
| OpenStreetMap / Overpass / Geofabrik | ODbL 1.0 — © OpenStreetMap contributors |
| Bhuvan | Bhuvan open geospatial services — © ISRO / NRSC; attribution required |
| Survey of India | © Survey of India; sheet access per portal terms |
| Copernicus | Free, open Copernicus data — © ESA / European Commission |
| data.gov.in | Open Government Data Platform, Government of India |
| NBSS & LUP | © ICAR — contextual agronomic use |
| DataMeet | Community-maintained boundary datasets |

Attribution is rendered in the map attribution control and repeated in the source catalogue.
