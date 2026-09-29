/**
 * DEMONSTRATION DATASET.
 *
 * Every record in this file is a synthetic test fixture. It is NOT official
 * government land data, NOT an official ULPIN, and NOT a live court record.
 * Identifiers are labelled DEMO so no consumer can mistake them for the real
 * thing. PARC-A..PARC-F exist so the integrity engine has a known-good
 * behavioural contract in tests and demos.
 */

const SQFT_PER_SQM = 10.7639;
const DEG_LAT_M = 111_320;

export function sqftToSqm(sqft: number): number {
  return Math.round((sqft / SQFT_PER_SQM) * 100) / 100;
}

export function sqmToSqft(sqm: number): number {
  return Math.round(sqm * SQFT_PER_SQM * 100) / 100;
}

/** Builds a north-up rectangle of the requested real-world area around [lon, lat]. */
export function rectangle(
  lon: number,
  lat: number,
  areaSqm: number,
  aspect = 1.35,
): { type: 'Polygon'; coordinates: number[][][] } {
  const heightM = Math.sqrt(areaSqm * aspect);
  const widthM = areaSqm / heightM;
  const dLat = heightM / 2 / DEG_LAT_M;
  const dLon = widthM / 2 / (DEG_LAT_M * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [
      [
        [round6(lon - dLon), round6(lat - dLat)],
        [round6(lon + dLon), round6(lat - dLat)],
        [round6(lon + dLon), round6(lat + dLat)],
        [round6(lon - dLon), round6(lat + dLat)],
        [round6(lon - dLon), round6(lat - dLat)],
      ],
    ],
  };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Shoelace area in projected metres. Adequate for parcel-scale polygons and
 * deliberately dependency-free; PostGIS is used for the authoritative figure.
 */
export function polygonAreaSqm(ring: number[][]): number {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mx = DEG_LAT_M * Math.cos((lat0 * Math.PI) / 180);
  const my = DEG_LAT_M;
  let shoelace = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [xa, ya] = ring[i];
    const [xb, yb] = ring[i + 1];
    const px = xa * mx;
    const py = ya * my;
    const qx = xb * mx;
    const qy = yb * my;
    shoelace += px * qy - qx * py;
  }
  return Math.abs(shoelace) / 2;
}

export function centroidOf(ring: number[][]): [number, number] {
  const n = ring.length - 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [round6(x / n), round6(y / n)];
}

/**
 * Parcel anchors sit inside real Tamil Nadu localities so that genuine public
 * context layers (OSM roads, Bhuvan LULC) return meaningful neighbours. The
 * *governance* records attached to them are synthetic.
 */
export interface ParcelFixture {
  parcelId: string;
  displayId: string;
  surveyNumber: string;
  subdivisionNumber: string;
  district: string;
  taluk: string;
  block: string;
  village: string;
  localBody: string;
  localBodyType: 'ULB' | 'PANCHAYAT';
  latitude: number;
  longitude: number;
  cadastralAreaSqft: number;
  status: string;
  /** Which demonstration behaviour this parcel exists to exercise. */
  scenario: string;
}

export const PARCEL_FIXTURES: ParcelFixture[] = [
  {
    parcelId: 'PARC-A',
    displayId: '3301DEMO000041',
    surveyNumber: '41/2A',
    subdivisionNumber: '2A',
    district: 'Chengalpattu',
    taluk: 'Tambaram',
    block: 'St. Thomas Mount',
    village: 'Perungalathur',
    localBody: 'Perungalathur Panchayat',
    localBodyType: 'PANCHAYAT',
    latitude: 12.9056,
    longitude: 80.0942,
    cadastralAreaSqft: 2400,
    status: 'ACTIVE',
    scenario: 'CLEAN — all governance records agree; expected finding count is 0.',
  },
  {
    parcelId: 'PARC-B',
    displayId: '3301DEMO000042',
    surveyNumber: '42/1',
    subdivisionNumber: '1',
    district: 'Chengalpattu',
    taluk: 'Tambaram',
    block: 'St. Thomas Mount',
    village: 'Perungalathur',
    localBody: 'Perungalathur Panchayat',
    localBodyType: 'PANCHAYAT',
    latitude: 12.9068,
    longitude: 80.0955,
    cadastralAreaSqft: 1980,
    status: 'ACTIVE',
    scenario:
      'OWNERSHIP_MISMATCH — RoR and tax agree on K. Meenakshi; the latest registered deed transfers to R. Suresh. Records require reconciliation.',
  },
  {
    parcelId: 'PARC-C',
    displayId: '3301DEMO000043',
    surveyNumber: '43/3B',
    subdivisionNumber: '3B',
    district: 'Chengalpattu',
    taluk: 'Tambaram',
    block: 'St. Thomas Mount',
    village: 'Perungalathur',
    localBody: 'Perungalathur Panchayat',
    localBodyType: 'PANCHAYAT',
    latitude: 12.9081,
    longitude: 80.0931,
    cadastralAreaSqft: 2365,
    status: 'ACTIVE',
    scenario: 'AREA_MISMATCH — cadastral geometry spans 2365 sq.ft; the RoR asserts 2400 sq.ft.',
  },
  {
    parcelId: 'PARC-D',
    displayId: '3301DEMO000044',
    surveyNumber: '44/1A',
    subdivisionNumber: '1A',
    district: 'Chennai',
    taluk: 'Egmore',
    block: 'Egmore',
    village: 'Egmore',
    localBody: 'Greater Chennai Corporation',
    localBodyType: 'ULB',
    latitude: 13.0795,
    longitude: 80.2609,
    cadastralAreaSqft: 3100,
    status: 'ACTIVE',
    scenario:
      'ENCUMBRANCE_RISK — active mortgage, fresh 2026 sale deed, no NOC on record, outstanding tax dues, and a pending demonstration property dispute.',
  },
  {
    parcelId: 'PARC-E',
    displayId: '3301DEMO000045',
    surveyNumber: '45/2',
    subdivisionNumber: '2',
    district: 'Kanchipuram',
    taluk: 'Kanchipuram',
    block: 'Kanchipuram',
    village: 'Kanchipuram',
    localBody: 'Kanchipuram Municipality',
    localBodyType: 'ULB',
    latitude: 12.8342,
    longitude: 79.7036,
    cadastralAreaSqft: 2750,
    status: 'ACTIVE',
    scenario:
      'BUILDING_UNAPPROVED_CHANGE — a demonstration observation flags a possible building change with no matching approval record. This is a verification prompt, not a legal conclusion.',
  },
  {
    parcelId: 'PARC-F',
    displayId: '3301DEMO000046',
    surveyNumber: '46/4',
    subdivisionNumber: '4',
    district: 'Kanchipuram',
    taluk: 'Kanchipuram',
    block: 'Kanchipuram',
    village: 'Kanchipuram',
    localBody: 'Kanchipuram Municipality',
    localBodyType: 'ULB',
    latitude: 12.8359,
    longitude: 79.7051,
    cadastralAreaSqft: 1620,
    status: 'ACTIVE',
    scenario: 'NOT_LINKED — geometry and identity exist, but no RoR record is linked to the parcel.',
  },
];

export function fixtureGeometry(f: ParcelFixture) {
  const areaSqm = sqftToSqm(f.cadastralAreaSqft);
  const geom = rectangle(f.longitude, f.latitude, areaSqm);
  return {
    geometry: geom,
    centroid: centroidOf(geom.coordinates[0]),
    areaSqm: Math.round(polygonAreaSqm(geom.coordinates[0]) * 100) / 100,
  };
}

export const DEMO_NOTICE =
  'Demonstration records — not official government land records';

export const DEMO_LABEL = 'DEMO / TEST FIXTURE';
