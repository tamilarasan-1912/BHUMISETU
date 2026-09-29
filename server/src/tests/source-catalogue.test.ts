import { describe, expect, it } from 'vitest';
import { LAYER_CATALOGUE, SOURCE_CATALOGUE } from '../data/source-catalogue.js';
import { DEMO_LABEL, DEMO_NOTICE, PARCEL_FIXTURES, fixtureGeometry, sqftToSqm } from '../data/parcel-fixtures.js';

/**
 * The source catalogue is the platform's honesty contract: every entry must
 * declare its authority, licence and nature. These tests fail the build if a
 * source claims authority it cannot support or omits its provenance fields.
 */

const VALID_STATUS = [
  'CONNECTED',
  'AVAILABLE',
  'ADAPTER_READY',
  'UPSTREAM_UNAVAILABLE',
  'REQUIRES_AUTH',
  'DEMO_DATA',
  'NOT_CONFIGURED',
];

const VALID_DATA_STATUS = ['REAL', 'DERIVED', 'CONTEXTUAL', 'DEMONSTRATION', 'AI'];

describe('source catalogue', () => {
  it('registers every source with the required provenance fields', () => {
    expect(SOURCE_CATALOGUE.length).toBeGreaterThan(10);
    for (const s of SOURCE_CATALOGUE) {
      expect(s.sourceId, 'sourceId').toBeTruthy();
      expect(s.name, `${s.sourceId} name`).toBeTruthy();
      expect(s.organization, `${s.sourceId} organization`).toBeTruthy();
      expect(s.authority, `${s.sourceId} authority`).toBeTruthy();
      expect(s.category, `${s.sourceId} category`).toBeTruthy();
      expect(s.coverage, `${s.sourceId} coverage`).toBeTruthy();
      expect(s.licenceNote, `${s.sourceId} licence note`).toBeTruthy();
      expect(s.freshnessNote, `${s.sourceId} freshness note`).toBeTruthy();
      expect(s.capability.length, `${s.sourceId} capabilities`).toBeGreaterThan(0);
      expect(VALID_STATUS).toContain(s.status);
      expect(VALID_DATA_STATUS).toContain(s.dataStatus);
      // A demonstration fixture has no upstream to point at; every other source
      // must publish the URL an operator can inspect.
      if (!s.isDemonstration) expect(s.url, `${s.sourceId} url`).toMatch(/^https:\/\//);
    }
  });

  it('uses unique source identifiers', () => {
    const ids = SOURCE_CATALOGUE.map((s) => s.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never marks a source CONNECTED without a probe strategy', () => {
    for (const s of SOURCE_CATALOGUE) {
      if (s.status === 'CONNECTED' || s.status === 'AVAILABLE') {
        // A live status must be backed by an endpoint the probe can actually hit.
        expect(s.endpoint, `${s.sourceId} claims ${s.status} but has no endpoint`).toBeTruthy();
        expect(s.probe, `${s.sourceId} claims ${s.status} but has no probe strategy`).toBeTruthy();
      }
    }
  });

  it('never claims OpenStreetMap is an authoritative cadastral or ownership source', () => {
    const osm = SOURCE_CATALOGUE.filter((s) => /openstreetmap|overpass/i.test(s.sourceId) || /OpenStreetMap/i.test(s.name));
    expect(osm.length).toBeGreaterThan(0);
    for (const s of osm) {
      expect(s.isAuthoritative, `${s.sourceId} must not be authoritative`).toBe(false);
      expect(s.isContextual, `${s.sourceId} must be contextual`).toBe(true);
      const text = `${s.authority} ${s.coverage} ${s.licenceNote} ${s.capability.join(' ')}`.toLowerCase();
      // The catalogue must state the limitation explicitly, not merely avoid
      // claiming authority by omission.
      expect(text).toMatch(/not a cadastral|not cadastral|contextual/);
      expect(text).not.toMatch(/is a cadastral authority|is the ownership authority/);
    }
  });

  it('never claims Bhuvan LULC is a legal land use authority', () => {
    const bhuvan = SOURCE_CATALOGUE.filter((s) => /bhuvan/i.test(s.sourceId));
    expect(bhuvan.length).toBeGreaterThan(0);
    for (const s of bhuvan) {
      expect(s.isAuthoritative).toBe(false);
      expect(s.isContextual).toBe(true);
    }
  });

  it('marks every demonstration fixture explicitly', () => {
    const demos = SOURCE_CATALOGUE.filter((s) => s.status === 'DEMO_DATA');
    expect(demos.length).toBeGreaterThan(0);
    for (const s of demos) {
      expect(s.isDemonstration, `${s.sourceId} must be flagged demonstration`).toBe(true);
      expect(s.dataStatus).toBe('DEMONSTRATION');
      const text = `${s.authority} ${s.licenceNote}`.toLowerCase();
      expect(text).toMatch(/demonstration|fixture|not official/);
    }
  });

  it('does not label any demonstration source as authoritative', () => {
    for (const s of SOURCE_CATALOGUE.filter((x) => x.isDemonstration)) {
      expect(s.isAuthoritative, `${s.sourceId} is a fixture and cannot be authoritative`).toBe(false);
    }
  });

  it('covers the required external data-fabric sources', () => {
    const ids = SOURCE_CATALOGUE.map((s) => s.sourceId).join(' ');
    for (const expected of ['TNGIS', 'BHUVAN', 'OSM', 'OVERPASS', 'GEOFABRIK', 'COPERNICUS', 'SOI', 'DATA_GOV', 'SOIL', 'DATAMEET']) {
      expect(ids, `expected a source matching ${expected}`).toMatch(new RegExp(expected, 'i'));
    }
  });

  it('never uses unqualified "live government integration" language', () => {
    for (const s of SOURCE_CATALOGUE) {
      const text = `${s.freshnessNote} ${s.licenceNote} ${s.coverage}`.toLowerCase();
      expect(text, `${s.sourceId} overstates integration`).not.toContain('live government integration');
      expect(text, `${s.sourceId} overstates integration`).not.toContain('official government record');
    }
  });
});

describe('layer catalogue', () => {
  it('registers every layer with source, authority and rendering metadata', () => {
    expect(LAYER_CATALOGUE.length).toBeGreaterThan(5);
    for (const l of LAYER_CATALOGUE) {
      expect(l.layerId).toBeTruthy();
      expect(l.name).toBeTruthy();
      expect(l.category).toBeTruthy();
      expect(l.sourceId).toBeTruthy();
      expect(l.attribution).toBeTruthy();
      expect(l.description).toBeTruthy();
      expect(l.defaultOpacity).toBeGreaterThan(0);
      expect(l.defaultOpacity).toBeLessThanOrEqual(1);
      expect(['WMS', 'XYZ', 'GEOJSON', 'NONE']).toContain(l.serviceType);
      expect(VALID_STATUS).toContain(l.status);
      expect(VALID_DATA_STATUS).toContain(l.dataStatus);
    }
  });

  it('points every layer at a registered source', () => {
    const ids = new Set(SOURCE_CATALOGUE.map((s) => s.sourceId));
    for (const l of LAYER_CATALOGUE) {
      expect(ids.has(l.sourceId), `layer ${l.layerId} references unknown source ${l.sourceId}`).toBe(true);
    }
  });

  it('uses unique layer identifiers', () => {
    const ids = LAYER_CATALOGUE.map((l) => l.layerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never exposes a WMS or XYZ layer without a service URL', () => {
    for (const l of LAYER_CATALOGUE) {
      if (l.serviceType === 'WMS' || l.serviceType === 'XYZ') {
        expect(l.serviceUrl, `${l.layerId} needs a service URL`).toBeTruthy();
      }
    }
  });
});

describe('demonstration fixtures', () => {
  it('creates exactly six demonstration parcels', () => {
    expect(PARCEL_FIXTURES.length).toBe(6);
    expect(PARCEL_FIXTURES.map((p) => p.parcelId)).toEqual([
      'PARC-A',
      'PARC-B',
      'PARC-C',
      'PARC-D',
      'PARC-E',
      'PARC-F',
    ]);
  });

  it('gives every parcel a synthetic ULPIN-shaped display identifier', () => {
    for (const p of PARCEL_FIXTURES) {
      expect(p.displayId, p.parcelId).toMatch(/^\d{4}DEMO\d{6}$/);
    }
    // Display identifiers must be unique across the dataset.
    expect(new Set(PARCEL_FIXTURES.map((p) => p.displayId)).size).toBe(6);
  });

  it('states the demonstration notice in plain language', () => {
    expect(DEMO_NOTICE.toLowerCase()).toContain('demonstration');
    expect(DEMO_NOTICE.toLowerCase()).toContain('not official');
    expect(DEMO_LABEL).toMatch(/DEMO/);
  });

  it('declares the intended integrity scenario for every parcel', () => {
    const byId = new Map(PARCEL_FIXTURES.map((p) => [p.parcelId, p]));
    expect(byId.get('PARC-A')!.scenario).toMatch(/CLEAN/);
    expect(byId.get('PARC-B')!.scenario).toMatch(/OWNERSHIP_MISMATCH/);
    expect(byId.get('PARC-C')!.scenario).toMatch(/AREA_MISMATCH/);
    expect(byId.get('PARC-D')!.scenario).toMatch(/ENCUMBRANCE_RISK/);
    expect(byId.get('PARC-E')!.scenario).toMatch(/BUILDING_UNAPPROVED_CHANGE/);
    expect(byId.get('PARC-F')!.scenario).toMatch(/NOT_LINKED/);
  });

  it('records the PARC-B ownership disagreement exactly as specified', () => {
    const b = PARCEL_FIXTURES.find((p) => p.parcelId === 'PARC-B')!;
    expect(b.scenario).toContain('K. Meenakshi');
    expect(b.scenario).toContain('R. Suresh');
    expect(b.scenario).toMatch(/reconcil/i);
  });

  it('records the PARC-C area discrepancy exactly as specified', () => {
    const c = PARCEL_FIXTURES.find((p) => p.parcelId === 'PARC-C')!;
    expect(c.cadastralAreaSqft).toBe(2365);
    expect(c.scenario).toContain('2400');
    expect(2400 - c.cadastralAreaSqft).toBe(35);
  });

  it('labels the PARC-D judiciary record as a demonstration record', () => {
    const d = PARCEL_FIXTURES.find((p) => p.parcelId === 'PARC-D')!;
    expect(d.scenario).toMatch(/mortgage/i);
    expect(d.scenario).toMatch(/demonstration/i);
  });

  it('describes the PARC-E change as a possible change requiring verification', () => {
    const e = PARCEL_FIXTURES.find((p) => p.parcelId === 'PARC-E')!;
    expect(e.scenario).toMatch(/possible building change/i);
    expect(e.scenario).toMatch(/not a legal conclusion/i);
    expect(e.scenario).not.toMatch(/unauthoris|illegal/i);
  });

  it('anchors every parcel inside a real Tamil Nadu locality', () => {
    for (const p of PARCEL_FIXTURES) {
      expect(p.latitude).toBeGreaterThan(8);
      expect(p.latitude).toBeLessThan(14);
      expect(p.longitude).toBeGreaterThan(76);
      expect(p.longitude).toBeLessThan(81);
      expect(p.village).toBeTruthy();
      expect(p.district).toBeTruthy();
      expect(p.taluk).toBeTruthy();
      expect(p.surveyNumber).toBeTruthy();
      expect(p.cadastralAreaSqft).toBeGreaterThan(0);
    }
  });

  it('produces valid, closed GeoJSON polygons for every parcel', () => {
    for (const p of PARCEL_FIXTURES) {
      const g = fixtureGeometry(p);
      expect(g.geometry.type).toBe('Polygon');
      const ring = g.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(g.areaSqm).toBeGreaterThan(0);
      // The derived geometry area must track the declared cadastral area.
      const declaredSqm = sqftToSqm(p.cadastralAreaSqft);
      expect(Math.abs(g.areaSqm - declaredSqm) / declaredSqm).toBeLessThan(0.02);
    }
  });
});
