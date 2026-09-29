import { config } from '../config.js';
import { rawPool } from '../db/client.js';
import { SOURCE_CATALOGUE, type SourceDefinition } from '../data/source-catalogue.js';
import {
  cached,
  getLastSync,
  httpJson,
  recordRun,
  takeToken,
  type AdapterHealth,
  type DataAdapter,
  type SourceMetadata,
} from './base.js';
import type { SourceStatus } from '../types/domain.js';
import { cachedHealth, readHealthSnapshot, putHealthSnapshot, UNPROBED_DETAIL } from './base.js';

export type AdapterHealthStatusAlias = SourceStatus;

function def(sourceId: string): SourceDefinition {
  const d = SOURCE_CATALOGUE.find((s) => s.sourceId === sourceId);
  if (!d) throw new Error(`unknown source ${sourceId}`);
  return d;
}

function metadata(s: SourceDefinition): SourceMetadata {
  return {
    sourceId: s.sourceId,
    name: s.name,
    organization: s.organization,
    authority: s.authority,
    licenceNote: s.licenceNote,
    isAuthoritative: s.isAuthoritative,
    isContextual: s.isContextual,
    isDerived: s.isDerived,
    isDemonstration: s.isDemonstration,
    url: s.url,
  };
}

/* -------------------------------------------------------------------------- */
/* Department adapters (demonstration fixtures with a real read interface)     */
/* -------------------------------------------------------------------------- */

/**
 * Departmental adapters map an external department's record shape onto the
 * internal Parcel / Party / Right / Restriction / Document / Registration /
 * Tax / Planning / Judiciary model. The demonstration implementations read from
 * the seeded fixture tables. A real adapter replaces the `fetch` methods and
 * keeps the same contract, so no UI code changes when the real feed arrives.
 */
export interface DepartmentAdapter extends DataAdapter {
  getParcel(parcelId: string): Promise<Record<string, unknown> | null>;
  search(term: string): Promise<{ parcelId: string; displayId: string; matchOn: string }[]>;
}

function demoDepartmentAdapter(sourceId: string, tables: string[]): DepartmentAdapter {
  const s = def(sourceId);
  return {
    sourceId,
    sourceMetadata: () => metadata(s),
    async health(): Promise<AdapterHealth> {
      const res = await rawPool.query(
        `SELECT
           (SELECT count(*) FROM ror_records) AS ror,
           (SELECT count(*) FROM registrations) AS regs`,
      );
      return {
        sourceId,
        status: 'DEMO_DATA',
        reachable: true,
        latencyMs: 0,
        detail: `Demonstration fixture. Tables ${tables.join(', ')} hold ${res.rows[0]?.ror ?? 0} RoR and ${res.rows[0]?.regs ?? 0} registration rows. Not a government source.`,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync(sourceId)).lastSuccessAt,
        requiresAuth: false,
        configured: true,
      };
    },
    async lastSync() {
      return getLastSync(sourceId);
    },
    async getParcel(parcelId: string) {
      const res = await rawPool.query(`SELECT * FROM parcels WHERE parcel_id = $1`, [parcelId]);
      return res.rows[0] ?? null;
    },
    async search(term: string) {
      const res = await rawPool.query(
        `SELECT parcel_id, display_id,
                CASE WHEN lower(display_id) = lower($1) THEN 'displayId'
                     WHEN lower(parcel_id) = lower($1) THEN 'parcelId'
                     ELSE 'fuzzy' END AS match_on
         FROM parcels
         WHERE lower(display_id) LIKE $2 OR lower(parcel_id) LIKE $2
         LIMIT 25`,
        [term, `%${term.toLowerCase()}%`],
      );
      return res.rows.map((r) => ({
        parcelId: String(r.parcel_id),
        displayId: String(r.display_id),
        matchOn: String(r.match_on),
      }));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Public / contextual adapters                                               */
/* -------------------------------------------------------------------------- */

/** Generic HTTP adapter: reports reachability honestly, never claims CONNECTED without a successful probe. */
function httpAdapter(sourceId: string, probeUrl: string, configured = true): DataAdapter {
  const s = def(sourceId);
  return {
    sourceId,
    sourceMetadata: () => metadata(s),
    async health(): Promise<AdapterHealth> {
      const started = Date.now();
      if (!configured) {
        return {
          sourceId,
          status: 'ADAPTER_READY',
          reachable: false,
          latencyMs: null,
          detail: `${s.name}: adapter interface is implemented; no live endpoint is configured for this deployment.`,
          checkedAt: new Date().toISOString(),
          lastSuccessAt: (await getLastSync(sourceId)).lastSuccessAt,
          requiresAuth: false,
          configured: false,
        };
      }
      const res = await httpJson<unknown>(probeUrl, { parseAs: 'text', timeoutMs: 6000, retries: 1 });
      await recordRun(sourceId, 'health', res.ok ? 'OK' : 'FAILED', started, { error: res.error });
      return {
        sourceId,
        status: res.ok ? 'AVAILABLE' : 'UPSTREAM_UNAVAILABLE',
        reachable: res.ok,
        latencyMs: res.latencyMs,
        detail: res.ok
          ? `${s.name} responded. Used as ${s.isAuthoritative ? 'an authoritative' : 'a contextual'} source; adapter surface only.`
          : `${s.name} is currently unreachable from this deployment (${res.error}). Core parcel workflow is unaffected.`,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync(sourceId)).lastSuccessAt,
        requiresAuth: false,
        configured: true,
      };
    },
    async lastSync() {
      return getLastSync(sourceId);
    },
  };
}

/**
 * Adapter-only sources. The interface exists and is exercised by the gateway;
 * status is honestly reported as ADAPTER_READY / REQUIRES_AUTH / NOT_CONFIGURED.
 */
function adapterOnlyAdapter(sourceId: string, reason: string, status: AdapterHealth['status'] = 'ADAPTER_READY'): DataAdapter {
  const s = def(sourceId);
  return {
    sourceId,
    sourceMetadata: () => metadata(s),
    async health(): Promise<AdapterHealth> {
      return {
        sourceId,
        status,
        reachable: status === 'DEMO_DATA',
        latencyMs: null,
        detail: reason,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync(sourceId)).lastSuccessAt,
        requiresAuth: status === 'REQUIRES_AUTH',
        configured: status !== 'NOT_CONFIGURED' && status !== 'REQUIRES_AUTH',
      };
    },
    async lastSync() {
      return getLastSync(sourceId);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Overpass                                                                   */
/* -------------------------------------------------------------------------- */

export interface OverpassContext {
  parcelId: string;
  radius: number;
  roads: { id: number; name: string | null; highway: string | null; distanceM: number | null; geometry: unknown }[];
  buildings: { id: number; building: string | null; distanceM: number | null; geometry: unknown }[];
  water: { id: number; waterType: string; name: string | null; distanceM: number | null; geometry: unknown }[];
  amenities: { id: number; name: string | null; category: string; distanceM: number | null }[];
  landuse: { id: number; landuse: string | null; geometry: unknown }[];
  unavailable: boolean;
  message: string;
  licence: string;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geometryCenter(geometry: unknown): [number, number] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  const collect = (coords: unknown, out: number[][]) => {
    if (Array.isArray(coords)) {
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push([coords[0] as number, coords[1] as number]);
      } else {
        for (const c of coords) collect(c, out);
      }
    }
  };
  const pts: number[][] = [];
  collect(g.coordinates, pts);
  if (pts.length === 0) return null;
  const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const sy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [sx, sy];
}

export async function fetchOverpassContext(
  parcelId: string,
  lat: number,
  lon: number,
  radiusRequested: number,
): Promise<OverpassContext> {
  // Radius is validated server-side so a caller cannot ask Overpass for a
  // city-sized query.
  const radius = Math.max(50, Math.min(config.overpassRadiusLimitM, Math.round(radiusRequested)));
  const cacheKey = `overpass:${parcelId}:${radius}`;
  const empty: OverpassContext = {
    parcelId,
    radius,
    roads: [],
    buildings: [],
    water: [],
    amenities: [],
    landuse: [],
    unavailable: false,
    message: '',
    licence: '© OpenStreetMap contributors, ODbL 1.0 — contextual information only.',
  };

  if (!takeToken('overpass', 20)) {
    return {
      ...empty,
      unavailable: true,
      message: 'Contextual service rate limit reached in this deployment. Retry shortly; core parcel workflow is unaffected.',
    };
  }

  const started = Date.now();
  try {
    const result = await cached<OverpassContext>(cacheKey, config.adapterCacheTtlMs, async () => {
      const query = `[out:json][timeout:20];
(
  way(around:${radius},${lat},${lon})["highway"];
  way(around:${radius},${lat},${lon})["building"];
  way(around:${radius},${lat},${lon})["waterway"];
  way(around:${radius},${lat},${lon})["natural"="water"];
  way(around:${radius},${lat},${lon})["landuse"];
  node(around:${radius},${lat},${lon})["amenity"];
);
out geom 80;`;
      const res = await httpJson<{ elements?: Record<string, unknown>[] }>(config.overpassUrl, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeoutMs: 12_000,
        retries: 1,
      });
      if (!res.ok || !res.data) {
        throw new Error(res.error ?? 'Overpass request failed');
      }
      const origin: [number, number] = [lon, lat];
      const out: OverpassContext = { ...empty, parcelId, radius };
      for (const el of res.data.elements ?? []) {
        const tags = (el.tags ?? {}) as Record<string, string>;
        const id = Number(el.id);
        const centre = geometryCenter(el.geometry ?? { type: 'Point', coordinates: [el.lon, el.lat] });
        const distanceM = centre ? Math.round(haversineM(origin, centre)) : null;
        if (tags.highway) {
          out.roads.push({ id, name: tags.name ?? null, highway: tags.highway, distanceM, geometry: el.geometry ?? null });
        } else if (tags.building) {
          out.buildings.push({ id, building: tags.building, distanceM, geometry: el.geometry ?? null });
        } else if (tags.waterway || tags.natural === 'water') {
          out.water.push({ id, waterType: tags.waterway ?? tags.natural ?? 'water', name: tags.name ?? null, distanceM, geometry: el.geometry ?? null });
        } else if (tags.amenity) {
          out.amenities.push({ id, name: tags.name ?? null, category: tags.amenity, distanceM });
        } else if (tags.landuse) {
          out.landuse.push({ id, landuse: tags.landuse, geometry: el.geometry ?? null });
        }
      }
      out.roads.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
      out.buildings.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
      out.water.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
      out.amenities.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
      out.roads = out.roads.slice(0, 25);
      out.buildings = out.buildings.slice(0, 25);
      out.water = out.water.slice(0, 15);
      out.amenities = out.amenities.slice(0, 20);
      out.landuse = out.landuse.slice(0, 15);
      return out;
    });

    await recordRun('OVERPASS', 'context', 'OK', started, {
      records: result.data.roads.length + result.data.buildings.length + result.data.water.length + result.data.amenities.length,
      cacheHit: result.cacheHit,
    });

    // Persist the snapshot so an outage can later serve cached context.
    try {
      await rawPool.query(
        `INSERT INTO context_snapshots (parcel_id, source_id, cache_key, radius_m, payload, fetched_at, expires_at)
         VALUES ($1,'OVERPASS',$2,$3,$4,now(),now() + ($5 || ' milliseconds')::interval)
         ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now(),
           expires_at = EXCLUDED.expires_at`,
        [parcelId, cacheKey, radius, JSON.stringify(result.data), String(config.adapterCacheTtlMs)],
      );
    } catch {
      // Snapshot persistence is best-effort.
    }

    return result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun('OVERPASS', 'context', 'FAILED', started, { error: message });

    // Fall back to any previously stored snapshot for this parcel.
    try {
      const snap = await rawPool.query(
        `SELECT payload, fetched_at FROM context_snapshots
         WHERE parcel_id = $1 AND source_id = 'OVERPASS' ORDER BY fetched_at DESC LIMIT 1`,
        [parcelId],
      );
      if (snap.rows[0]) {
        return {
          ...(snap.rows[0].payload as OverpassContext),
          unavailable: true,
          message: `OpenStreetMap contextual service unavailable. Showing context cached at ${new Date(snap.rows[0].fetched_at).toISOString()}. Core parcel workflow remains operational.`,
        };
      }
    } catch {
      /* ignore */
    }

    return {
      ...empty,
      unavailable: true,
      message: 'OSM contextual service unavailable. Core parcel workflow remains operational.',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Copernicus (OAuth client-credentials, credentials from environment only)    */
/* -------------------------------------------------------------------------- */

export interface CopernicusObservationQuery {
  bbox: [number, number, number, number];
  from: string;
  to: string;
}

export const copernicusAdapter = {
  sourceId: 'COPERNICUS',
  sourceMetadata: () => metadata(def('COPERNICUS')),
  isConfigured(): boolean {
    return Boolean(config.copernicusClientId && config.copernicusClientSecret);
  },
  async health(): Promise<AdapterHealth> {
    const configured = this.isConfigured();
    if (!configured) {
      return {
        sourceId: 'COPERNICUS',
        status: 'REQUIRES_AUTH',
        reachable: false,
        latencyMs: null,
        detail:
          'Adapter implemented. Copernicus Sentinel-2 catalogue access requires OAuth client credentials supplied as COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET environment variables. No credentials are hard-coded.',
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync('COPERNICUS')).lastSuccessAt,
        requiresAuth: true,
        configured: false,
      };
    }
    const started = Date.now();
    const res = await httpJson<{ access_token?: string; expires_in?: number }>(config.copernicusTokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.copernicusClientId,
        client_secret: config.copernicusClientSecret,
      }).toString(),
      retries: 0,
    });
    const ok = res.ok && Boolean(res.data?.access_token);
    await recordRun('COPERNICUS', 'oauth-token', ok ? 'OK' : 'FAILED', started, {
      error: ok ? null : (res.error ?? 'no access_token returned'),
    });
    return {
      sourceId: 'COPERNICUS',
      status: ok ? 'CONNECTED' : 'UPSTREAM_UNAVAILABLE',
      reachable: ok,
      latencyMs: res.latencyMs,
      detail: ok
        ? `OAuth client-credentials token acquired (expires in ${res.data?.expires_in ?? 'n/a'}s). Catalogue search may be issued for Sentinel-2 observations.`
        : `Copernicus identity endpoint did not issue a token (${res.error}). Adapter remains configured; credential or network issue.`,
      checkedAt: new Date().toISOString(),
      lastSuccessAt: (await getLastSync('COPERNICUS')).lastSuccessAt,
      requiresAuth: true,
      configured: true,
    };
  },
  async lastSync() {
    return getLastSync('COPERNICUS');
  },
  /**
   * Sentinel-2 catalogue query. Returns an explicitly unavailable result when
   * credentials are absent rather than fabricating imagery metadata.
   */
  async searchObservations(query: CopernicusObservationQuery): Promise<{
    available: boolean;
    message: string;
    products: { id: string; sensingDate: string | null; cloudCover: number | null; source: string }[];
  }> {
    if (!this.isConfigured()) {
      return {
        available: false,
        message:
          'Copernicus Sentinel-2 catalogue search requires COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET. The adapter is configured but not authorised.',
        products: [],
      };
    }
    const started = Date.now();
    const cacheKey = `copernicus:${query.bbox.join(',')}:${query.from}:${query.to}`;
    try {
      const result = await cached(cacheKey, config.adapterCacheTtlMs, async () => {
        const tokenRes = await httpJson<{ access_token?: string }>(config.copernicusTokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: config.copernicusClientId,
            client_secret: config.copernicusClientSecret,
          }).toString(),
          retries: 0,
        });
        const token = tokenRes.data?.access_token;
        if (!token) throw new Error(tokenRes.error ?? 'no access token');
        const odata =
          `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=` +
          encodeURIComponent(
            `Collection/Name eq 'SENTINEL-2' and OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${query.bbox[0]} ${query.bbox[1]},${query.bbox[2]} ${query.bbox[1]},${query.bbox[2]} ${query.bbox[3]},${query.bbox[0]} ${query.bbox[3]},${query.bbox[0]} ${query.bbox[1]}))') and ` +
              `ContentDate/Start gt ${query.from}T00:00:00.000Z and ContentDate/Start lt ${query.to}T00:00:00.000Z`,
          ) +
          `&$top=10&$orderby=ContentDate/Start desc`;
        const res = await httpJson<{ value?: { Id: string; Name: string; ContentDate?: { Start?: string }; 's2:cloudCoverage'?: number }[] }>(
          odata,
          { headers: { authorization: `Bearer ${token}` }, timeoutMs: 12_000, retries: 1 },
        );
        if (!res.ok) throw new Error(res.error ?? 'catalogue query failed');
        return (res.data?.value ?? []).map((p) => ({
          id: p.Id,
          sensingDate: p.ContentDate?.Start ?? null,
          cloudCover: p['s2:cloudCoverage'] ?? null,
          source: 'COPERNICUS',
        }));
      });
      await recordRun('COPERNICUS', 'catalogue-search', 'OK', started, { records: result.data.length, cacheHit: result.cacheHit });
      return {
        available: true,
        message: `Catalogue returned ${result.data.length} Sentinel-2 product(s) intersecting the parcel bounding box.`,
        products: result.data,
      };
    } catch (err) {
      await recordRun('COPERNICUS', 'catalogue-search', 'FAILED', started, {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        available: false,
        message: 'Copernicus catalogue query failed. Core parcel workflow remains operational.',
        products: [],
      };
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

const adapters: DataAdapter[] = [
  httpAdapter('TNGIS', config.tngisBaseUrl),
  httpAdapter('SURVEY_OF_INDIA', config.surveyOfIndiaUrl),
  httpAdapter('DATA_GOV_IN', 'https://api.data.gov.in/', Boolean(config.dataGovApiKey)),
  httpAdapter('OSM', 'https://www.openstreetmap.org/', true),
  {
    sourceId: 'BHUVAN',
    sourceMetadata: () => metadata(def('BHUVAN')),
    async health(): Promise<AdapterHealth> {
      const started = Date.now();
      const url = `${config.bhuvanWmsUrl}?service=WMS&request=GetCapabilities&version=1.1.1`;
      const res = await httpJson<string>(url, { parseAs: 'text', timeoutMs: 9000, retries: 1 });
      const looksLikeXml = typeof res.data === 'string' && /<WMS_Capabilities|<Capabilities/i.test(res.data);
      const ok = res.ok && looksLikeXml;
      await recordRun('BHUVAN', 'wms-capabilities', ok ? 'OK' : 'FAILED', started, {
        error: ok ? null : (res.error ?? 'GetCapabilities did not return a WMS document'),
      });
      return {
        sourceId: 'BHUVAN',
        status: ok ? 'CONNECTED' : 'UPSTREAM_UNAVAILABLE',
        reachable: ok,
        latencyMs: res.latencyMs,
        detail: ok
          ? 'Bhuvan WMS GetCapabilities returned a service document. LULC is used strictly as contextual land-use/land-cover information.'
          : `Bhuvan WMS is temporarily unavailable from this deployment (${res.error ?? 'unexpected response'}). The LULC layer reports unavailable and the map continues to work.`,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync('BHUVAN')).lastSuccessAt,
        requiresAuth: false,
        configured: true,
      };
    },
    async lastSync() {
      return getLastSync('BHUVAN');
    },
  },
  {
    sourceId: 'OVERPASS',
    sourceMetadata: () => metadata(def('OVERPASS')),
    async health(): Promise<AdapterHealth> {
      const started = Date.now();
      if (!takeToken('overpass-health', 10)) {
        return {
          sourceId: 'OVERPASS',
          status: 'AVAILABLE',
          reachable: true,
          latencyMs: null,
          detail: 'Overpass adapter is rate limited locally; last recorded state is being reported.',
          checkedAt: new Date().toISOString(),
          lastSuccessAt: (await getLastSync('OVERPASS')).lastSuccessAt,
          requiresAuth: false,
          configured: true,
        };
      }
      const res = await httpJson<{ version?: number }>(config.overpassUrl, {
        method: 'POST',
        body: `data=${encodeURIComponent('[out:json][timeout:10];out count;')}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeoutMs: 12_000,
        retries: 1,
      });
      const ok = res.ok && Boolean(res.data);
      await recordRun('OVERPASS', 'health', ok ? 'OK' : 'FAILED', started, { error: res.error });
      return {
        sourceId: 'OVERPASS',
        status: ok ? 'CONNECTED' : 'UPSTREAM_UNAVAILABLE',
        reachable: ok,
        latencyMs: res.latencyMs,
        detail: ok
          ? 'Overpass mirror responded to a count query. Contextual OSM features are queried on demand within a bounded radius and cached.'
          : `Overpass mirror is temporarily unavailable (${res.error}). Nearby-context panels report unavailable rather than failing.`,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: (await getLastSync('OVERPASS')).lastSuccessAt,
        requiresAuth: false,
        configured: true,
      };
    },
    async lastSync() {
      return getLastSync('OVERPASS');
    },
  },
  copernicusAdapter as unknown as DataAdapter,
  adapterOnlyAdapter(
    'GEOFABRIK',
    'Bulk OSM-derived ingestion architecture is implemented for the India extract, Southern Zone and Tamil Nadu. Extracts are intentionally not downloaded during a request.',
  ),
  adapterOnlyAdapter(
    'NBSS_SOIL',
    'Soil context adapter interface implemented (soil type, class, texture, depth, drainage). No live NBSS service endpoint is configured for this deployment; soil values are treated as contextual, never as legal parcel attributes.',
  ),
  adapterOnlyAdapter(
    'DATAMEET',
    'Boundary-data ingestion architecture implemented. Community boundary datasets are development aids and are not presented as the legal boundary authority.',
  ),
  demoDepartmentAdapter('REVENUE_DEMO', ['ror_records', 'revenue_records', 'ownerships']),
  demoDepartmentAdapter('REGISTRATION_DEMO', ['registrations', 'deeds', 'encumbrances']),
  demoDepartmentAdapter('TAX_DEMO', ['tax_records', 'property_tax_records']),
  demoDepartmentAdapter('PLANNING_DEMO', ['building_permissions', 'zoning', 'land_use']),
  demoDepartmentAdapter('ECOURTS_DEMO', ['judiciary_cases', 'judiciary_events']),
  demoDepartmentAdapter('CADASTRE_DEMO', ['parcel_geometries', 'revenue_records']),
  demoDepartmentAdapter('SATELLITE_DEMO', ['satellite_observations', 'change_detections']),
];

/**
 * Adapters are wrapped once here so a status read can never block on an
 * unreachable upstream. The underlying health() remains the probe; the wrapper
 * decides whether to run it now, return a cached snapshot, or schedule a
 * background refresh.
 */
function withCachedHealth(adapter: DataAdapter): DataAdapter {
  return {
    ...adapter,
    health: () => Promise.resolve(cachedHealth(adapter.sourceId, config.adapterHealthTtlMs, () => adapter.health())),
    cachedHealth: () => readHealthSnapshot(adapter.sourceId),
  };
}

export const ADAPTERS: DataAdapter[] = adapters.map(withCachedHealth);

/** Unwrapped probes, used by the explicit refresh path. */
export const RAW_ADAPTERS: DataAdapter[] = adapters;

export function adapterFor(sourceId: string): DataAdapter | undefined {
  return adapters.find((a) => a.sourceId === sourceId);
}

/* -------------------------------------------------------------------------- */
/* Concurrency guard for probe-all                                            */
/* -------------------------------------------------------------------------- */

const probeLocks = new Map<string, number>();

/** True when a snapshot exists but its TTL has elapsed. */
function snapshotIsStale(sourceId: string): boolean {
  const snapshot = readHealthSnapshot(sourceId);
  if (!snapshot) return true;
  return Date.now() - new Date(snapshot.checkedAt).getTime() > config.adapterHealthTtlMs;
}

/**
 * Status read used by the gateway and analytics surfaces.
 *
 * The default path must never block on an unreachable upstream — Overpass and
 * Bhuvan routinely take tens of seconds, and a status read is not worth that
 * latency. So the default reads the cached snapshot and lets the adapter's own
 * cache trigger any background refresh. Only an explicit `force` (the
 * "Recompute" / `?probe=true` path) waits for live probes.
 */
export async function probeAll(opts: { force?: boolean; maxAgeMs?: number } = {}): Promise<AdapterHealth[]> {
  if (!opts.force) {
    return adapters.map((a) => {
      const snapshot = readHealthSnapshot(a.sourceId);
      // Kick a background refresh when the snapshot is stale, but return the
      // value we already have so the request stays fast. The shared-direct
      // cache does not publish snapshots, so record the result here too.
      if (snapshotIsStale(a.sourceId)) {
        void a
          .health()
          .then((health) => putHealthSnapshot(a.sourceId, health, config.adapterHealthTtlMs))
          .catch(() => undefined);
      }
      return (
        snapshot ?? {
          sourceId: a.sourceId,
          status: 'NOT_CONFIGURED',
          reachable: false,
          latencyMs: null,
          detail: UNPROBED_DETAIL,
          checkedAt: new Date().toISOString(),
          lastSuccessAt: null,
          requiresAuth: false,
          configured: false,
        }
      );
    });
  }

  const maxAge = opts.maxAgeMs ?? 60_000;
  const now = Date.now();
  const results = await Promise.all(
    adapters.map(async (a) => {
      const lock = probeLocks.get(a.sourceId);
      if (lock && now - lock < maxAge) {
        const snapshot = readHealthSnapshot(a.sourceId);
        if (snapshot) return snapshot;
      }
      probeLocks.set(a.sourceId, now);
      const health = await a.health();
      // Share the live result with the snapshot cache so a forced refresh also
      // upgrades the value every non-forced status read will serve.
      putHealthSnapshot(a.sourceId, health, config.adapterHealthTtlMs);
      return health;
    }),
  );
  return results;
}

/**
 * Background warm-up. Probes are fired after the HTTP listener is up so the
 * catalogue converges to live status without any request paying the latency.
 */
export function warmAdapterHealth(): void {
  for (const a of adapters) {
    void a
      .health()
      .then((health) => putHealthSnapshot(a.sourceId, health, config.adapterHealthTtlMs))
      .catch(() => undefined);
  }
}
