/**
 * BHUMISETU live API verification.
 *
 * Runs against a running server (default http://localhost:12001) and asserts the
 * documented API contract: GeoJSON shape, source provenance, unified search,
 * land passport sections, the integrity rule set, and health.
 *
 * This lives outside the vitest suite on purpose — vitest's worker pool cannot
 * reach the host loopback in every sandbox, and a silently skipped test is worse
 * than no test. Run it with `npm run verify:api`.
 */
import assert from 'node:assert/strict';

const BASE = process.env.BHUMISETU_BASE_URL ?? 'http://localhost:12001';

let passed = 0;
let failed = 0;

/**
 * Probe cases created by this harness are test fixtures, not governance acts.
 * They are removed on exit so repeated runs do not accumulate junk in the
 * demonstration dataset that officers would otherwise see in their queue.
 */
const probeCaseIds: string[] = [];

async function cleanupProbes() {
  if (probeCaseIds.length === 0) return;
  const { rawPool } = await import('../src/db/client.js');
  const ids = probeCaseIds;
  // case_id is uuid while audit entity_id is text, so the casts differ.
  for (const table of ['case_events', 'case_comments', 'case_assignments']) {
    await rawPool.query(`DELETE FROM ${table} WHERE case_id = ANY($1::uuid[])`, [ids]);
  }
  await rawPool.query('UPDATE service_requests SET linked_case_id = NULL WHERE linked_case_id = ANY($1::uuid[])', [ids]);
  await rawPool.query('DELETE FROM verification_cases WHERE case_id = ANY($1::uuid[])', [ids]);
  await rawPool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::text[])', [ids]);
  console.log(`  \x1b[90mcleaned ${ids.length} probe case(s) from the demonstration dataset\x1b[0m`);
}

function rememberCase(id: string) {
  probeCaseIds.push(id);
  return id;
}

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}`);
    console.log(`       ${(err as Error).message.split('\n').join('\n       ')}`);
  }
}

async function get(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15000) });
  return res;
}

/** Cached logins: the auth endpoint is rate limited, so log in once per account. */
const tokenCache = new Map<string, string>();
async function login(username: string, password: string): Promise<string> {
  const cached = tokenCache.get(username);
  if (cached) return cached;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(res.ok, `login as ${username} returned ${res.status}`);
  const body = (await res.json()) as { token: string };
  tokenCache.set(username, body.token);
  return body.token;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await get(path, init);
  assert.ok(res.ok, `GET ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

function assertPosition(pos: unknown) {
  assert.ok(Array.isArray(pos), 'position must be an array');
  const [lon, lat] = pos as number[];
  assert.equal(typeof lon, 'number');
  assert.equal(typeof lat, 'number');
  assert.ok(lon >= -180 && lon <= 180, `longitude out of range: ${lon}`);
  assert.ok(lat >= -90 && lat <= 90, `latitude out of range: ${lat}`);
}

function assertRing(ring: unknown) {
  assert.ok(Array.isArray(ring), 'ring must be an array');
  const r = ring as number[][];
  assert.ok(r.length >= 4, 'a polygon ring needs at least 4 positions');
  r.forEach(assertPosition);
  assert.deepEqual(r[0], r[r.length - 1], 'a polygon ring must be closed');
}

function assertPolygon(geom: { type: string; coordinates: unknown }) {
  if (geom.type === 'Polygon') {
    (geom.coordinates as unknown[]).forEach(assertRing);
  } else {
    assert.equal(geom.type, 'MultiPolygon');
    for (const poly of geom.coordinates as unknown[][]) {
      for (const ring of poly) assertRing(ring);
    }
  }
}

interface Fc {
  type: string;
  features: { type: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[];
  metadata?: Record<string, unknown>;
}

console.log(`\nBHUMISETU live API verification against ${BASE}\n`);

console.log('Health');
await check('GET /api/health reports a healthy database', async () => {
  const d = await json<{ database: { ok: boolean } }>('/api/health');
  assert.equal(d.database.ok, true, 'database must report ok');
});
await check('GET /api/meta declares the demo/real data mode', async () => {
  const d = await json<Record<string, unknown>>('/api/meta');
  assert.ok(d.dataMode, 'dataMode is required');
  assert.ok(d.datasetNotice, 'datasetNotice is required');
  assert.match(String(d.datasetNotice), /not official government land records/i);
});

console.log('\nGeoJSON');
const fc = await json<Fc>('/api/geojson');
await check('returns a FeatureCollection of parcels', () => {
  assert.equal(fc.type, 'FeatureCollection');
  assert.ok(Array.isArray(fc.features) && fc.features.length > 0, 'expected at least one feature');
});
await check('every feature has a valid closed polygon and required properties', () => {
  for (const f of fc.features) {
    assert.equal(f.type, 'Feature');
    assert.ok(f.geometry, 'geometry is required');
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type), `unexpected ${f.geometry.type}`);
    assertPolygon(f.geometry);
    const p = f.properties;
    assert.ok(p.parcelId, 'parcelId is required');
    assert.ok(p.displayId, 'displayId is required');
    assert.equal(typeof p.areaSqFt, 'number');
    assert.ok(p.risk, 'risk is required');
    assert.equal(typeof p.findingCount, 'number');
  }
});
await check('includes all six demonstration parcels exactly once', () => {
  const ids = fc.features.map((f) => f.properties.parcelId as string);
  for (const id of ['PARC-A', 'PARC-B', 'PARC-C', 'PARC-D', 'PARC-E', 'PARC-F']) {
    assert.ok(ids.includes(id), `${id} is missing from the FeatureCollection`);
  }
  assert.equal(new Set(ids).size, ids.length, 'a parcel appears more than once');
});
await check('labels demonstration geometry as demonstration data', () => {
  for (const f of fc.features) {
    assert.equal(f.properties.dataStatus, 'DEMONSTRATION', `${f.properties.parcelId} data status`);
  }
  assert.ok(fc.metadata?.datasetNotice, 'the collection must carry the demonstration notice');
});
await check('bands a parcel with no findings as VERIFIED', () => {
  for (const f of fc.features) {
    if (f.properties.findingCount === 0) assert.equal(f.properties.risk, 'VERIFIED');
  }
});
await check('a district filter narrows the result set', async () => {
  const filtered = await json<Fc>('/api/geojson?district=Chennai');
  assert.ok(filtered.features.length < fc.features.length, 'the filter did not reduce the result set');
  for (const f of filtered.features) assert.equal(f.properties.district, 'Chennai');
});
await check('rejects a malformed bbox', async () => {
  const res = await get('/api/geojson?bbox=1,2,3');
  assert.equal(res.status, 400);
});

console.log('\nSources and layers');
await check('the source catalogue publishes full provenance fields', async () => {
  const d = await json<{ items: Record<string, unknown>[] }>('/api/data-sources');
  assert.ok(d.items.length > 10, 'expected more than ten sources');
  for (const s of d.items) {
    assert.ok(s.sourceId, 'sourceId');
    assert.ok(s.authority, 'authority');
    assert.ok(s.status, 'status');
    assert.equal(typeof s.isAuthoritative, 'boolean');
    assert.equal(typeof s.isContextual, 'boolean');
    assert.equal(typeof s.isDemonstration, 'boolean');
  }
});
await check('no demonstration source is marked authoritative', async () => {
  const d = await json<{ items: Record<string, unknown>[] }>('/api/data-sources');
  for (const s of d.items) {
    if (s.isDemonstration === true) assert.equal(s.isAuthoritative, false, `${s.sourceId} claims authority`);
  }
});
await check('OpenStreetMap is contextual and not authoritative', async () => {
  const d = await json<{ items: Record<string, unknown>[] }>('/api/data-sources');
  const osm = d.items.filter((s) => /openstreetmap|overpass/i.test(String(s.sourceId)));
  assert.ok(osm.length > 0, 'no OSM-family source found');
  for (const s of osm) {
    assert.equal(s.isAuthoritative, false);
    assert.equal(s.isContextual, true);
  }
});
await check('the layer catalogue attributes every layer to a source', async () => {
  const d = await json<{ items: Record<string, unknown>[] }>('/api/layers');
  assert.ok(d.items.length > 5);
  for (const l of d.items) {
    assert.ok(l.layerId && l.name && l.sourceId && l.attribution && l.status, `incomplete layer ${l.layerId}`);
  }
});

console.log('\nUnified search');
await check('resolves a synthetic display identifier', async () => {
  const d = await json<{ hits: { parcelId: string }[] }>('/api/search?q=3301DEMO000042');
  assert.equal(d.hits[0]?.parcelId, 'PARC-B');
});
await check('resolves an internal parcel id', async () => {
  const d = await json<{ hits: { parcelId: string }[] }>('/api/search?q=PARC-C');
  assert.equal(d.hits[0]?.parcelId, 'PARC-C');
});
await check('resolves a village name', async () => {
  const d = await json<{ hits: { village: string }[] }>('/api/search?q=Perungalathur');
  assert.ok(d.hits.length > 0);
  for (const p of d.hits) assert.equal(p.village, 'Perungalathur');
});
await check('returns an empty set for an unmatched query', async () => {
  const d = await json<{ hits: unknown[] }>('/api/search?q=ZZZNOSUCHPARCEL');
  assert.deepEqual(d.hits, []);
});

console.log('\nLand passport and integrity engine');
await check('the passport exposes every documented section', async () => {
  const d = await json<Record<string, unknown>>('/api/passport/PARC-B');
  const sections = [
    'header', 'executiveSummary', 'identity', 'location', 'geometry', 'area', 'ownership',
    'ror', 'registration', 'encumbrance', 'tax', 'planning', 'building', 'landUse', 'zoning',
    'judiciary', 'documents', 'satellite', 'findings', 'evidence', 'score', 'verification',
    'timeline', 'sources', 'quality', 'linkage', 'maskingPolicy',
  ];
  for (const s of sections) assert.ok(s in d, `passport is missing "${s}"`);
});
await check('404s for an unknown parcel', async () => {
  const res = await get('/api/passport/PARC-NOPE');
  assert.equal(res.status, 404);
});
await check('each demonstration parcel reports its specified finding', async () => {
  const expected: Record<string, string | null> = {
    'PARC-A': null,
    'PARC-B': 'OWNERSHIP_MISMATCH',
    'PARC-C': 'AREA_MISMATCH',
    'PARC-D': 'ENCUMBRANCE_RISK',
    'PARC-E': 'BUILDING_UNAPPROVED_CHANGE',
    'PARC-F': 'NOT_LINKED',
  };
  for (const [parcelId, rule] of Object.entries(expected)) {
    const d = await json<{ findings: { ruleCode: string; parcelId: string }[] }>(`/api/passport/${parcelId}`);
    const codes = d.findings.map((f) => f.ruleCode);
    if (rule === null) assert.deepEqual(codes, [], `${parcelId} should have no findings`);
    else assert.ok(codes.includes(rule), `${parcelId} should report ${rule}, got [${codes.join(', ')}]`);
    for (const f of d.findings) assert.equal(f.parcelId, parcelId, `${parcelId} leaked a finding from ${f.parcelId}`);
  }
});
await check('every active finding carries evidence with a source and authority', async () => {
  for (const parcelId of ['PARC-B', 'PARC-C', 'PARC-D', 'PARC-E', 'PARC-F']) {
    const d = await json<{ findings: unknown[]; evidence: Record<string, unknown>[] }>(`/api/passport/${parcelId}`);
    assert.ok(d.findings.length > 0, `${parcelId} has no findings`);
    assert.ok(d.evidence.length > 0, `${parcelId} has findings but no evidence`);
    for (const e of d.evidence) {
      assert.ok(e.source, 'evidence source');
      assert.ok(e.sourceAuthority, 'evidence authority');
      assert.ok(e.field, 'evidence field');
      assert.ok(e.dataStatus, 'evidence data status');
      assert.equal(e.parcelId, parcelId, 'evidence must belong to the parcel');
    }
  }
});
await check('the rule catalogue contains exactly the six documented rules', async () => {
  const d = await json<{ items: { rule_code: string }[] }>('/api/rules');
  const codes = d.items.map((r) => r.rule_code).sort();
  assert.deepEqual(codes, [
    'AREA_MISMATCH', 'BUILDING_UNAPPROVED_CHANGE', 'ENCUMBRANCE_RISK',
    'NOT_LINKED', 'OWNERSHIP_MISMATCH', 'TAX_MISMATCH',
  ]);
});
await check('a clean parcel scores 100 and a conflicted parcel scores lower', async () => {
  const a = await json<{ score: { score: number; band: string } }>('/api/passport/PARC-A');
  assert.equal(a.score.score, 100);
  assert.equal(a.score.band, 'VERIFIED');
  const d = await json<{ score: { score: number; band: string } }>('/api/passport/PARC-D');
  assert.ok(d.score.score < 100, 'PARC-D must be penalised');
  assert.equal(d.score.band, 'HIGH RISK');
});

console.log('\nCitizen masking');
await check('an anonymous read masks party names and internal notes', async () => {
  const d = await json<{ maskingPolicy: { maskPartyNames: boolean; includeInternalNotes: boolean } }>('/api/passport/PARC-B');
  assert.equal(d.maskingPolicy.maskPartyNames, true);
  assert.equal(d.maskingPolicy.includeInternalNotes, false);
});

console.log('\nAuthentication and RBAC');
const citizenAuth = { Authorization: `Bearer ${await login('citizen', 'citizen@123')}` };

await check('an anonymous write is refused', async () => {
  const res = await get('/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parcelId: 'PARC-A', title: 'anon', description: 'should be refused' }),
  });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});
await check('a citizen may raise a verification case', async () => {
  const res = await get('/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...citizenAuth },
    body: JSON.stringify({ parcelId: 'PARC-C', title: 'Citizen area query', description: 'Area differs from my patta.' }),
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}`);
  const created = (await res.json()) as { case_id: string; status: string; assigned_role: string | null; assigned_department: string | null };
  rememberCase(created.case_id);
  assert.equal(created.status, 'SUBMITTED', 'a new case must start SUBMITTED');
  assert.ok(created.assigned_role, 'a new case must be routed to an officer role');
  assert.ok(created.assigned_department, 'a new case must be routed to a department');
});
await check('a citizen cannot change a case status', async () => {
  const created = (await (
    await get('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...citizenAuth },
      body: JSON.stringify({ parcelId: 'PARC-C', title: 'Citizen status probe', description: 'should not be allowed to update' }),
    })
  ).json()) as { case_id: string };
  rememberCase(created.case_id);
  const res = await get(`/api/cases/${created.case_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...citizenAuth },
    body: JSON.stringify({ status: 'RESOLVED', reason: 'Citizen attempt to close the case' }),
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});
await check('a citizen cannot read the audit trail', async () => {
  const res = await get('/api/audit?limit=5', { headers: citizenAuth });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});
await check('a citizen cannot read the administrator overview', async () => {
  const res = await get('/api/admin/overview', { headers: citizenAuth });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});
await check('an officer can read the audit trail', async () => {
  const res = await get('/api/audit?limit=5', { headers: { Authorization: `Bearer ${await login('revenue', 'officer@123')}` } });
  assert.ok(res.ok, `audit read returned ${res.status}`);
});
await check('an officer can advance a case and the change is audited', async () => {
  const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };
  const created = (await (
    await get('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...officerAuth },
      body: JSON.stringify({ parcelId: 'PARC-C', title: 'Officer workflow probe', description: 'advance through the workflow' }),
    })
  ).json()) as { case_id: string };
  rememberCase(created.case_id);
  const updated = await get(`/api/cases/${created.case_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...officerAuth },
    body: JSON.stringify({
      status: 'UNDER_REVIEW',
      comment: 'Assigned for record reconciliation.',
      reason: 'Records require reconciliation before any determination.',
    }),
  });
  assert.ok(updated.ok, `status change returned ${updated.status}`);
  const detail = await json<{ events: { event_type: string }[]; status: string }>(`/api/cases/${created.case_id}`, { headers: officerAuth });
  assert.equal(detail.status, 'UNDER_REVIEW');
  const types = detail.events.map((e) => e.event_type);
  assert.ok(types.includes('CASE_CREATED'), 'a case event must record creation');
  assert.ok(types.includes('STATUS_CHANGED'), 'a case event must record the status change');
  const audit = await json<{ items: { action: string; entity_id: string }[] }>('/api/audit?limit=200', { headers: officerAuth });
  assert.ok(
    audit.items.some((a) => a.entity_id === created.case_id && /CASE/i.test(a.action)),
    'the status change must appear in the audit trail',
  );
});
await check('an illegal workflow jump is rejected', async () => {
  const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };
  const created = (await (
    await get('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...officerAuth },
      body: JSON.stringify({ parcelId: 'PARC-C', title: 'Illegal jump probe', description: 'resolve then re-open' }),
    })
  ).json()) as { case_id: string };
  rememberCase(created.case_id);
  await get(`/api/cases/${created.case_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...officerAuth },
    body: JSON.stringify({ status: 'RESOLVED', reason: 'Resolved for the illegal-jump probe.' }),
  });
  const res = await get(`/api/cases/${created.case_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...officerAuth },
    body: JSON.stringify({ status: 'UNDER_REVIEW', reason: 'Attempt to re-open a resolved case.' }),
  });
  assert.equal(res.status, 409, `expected 409 for a terminal-state transition, got ${res.status}`);
});
await check('a deleted case never frees its number for reuse', async () => {
  // Regression: numbering used to be derived from count(*), so deleting a case
  // made the next insert collide with a live case number. The sequence must stay
  // monotonic across a delete.
  const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };
  const make = async (title: string) =>
    (await (
      await get('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...officerAuth },
        body: JSON.stringify({ parcelId: 'PARC-F', title }),
      })
    ).json()) as { case_id: string; case_number: string };

  const first = await make('Numbering probe one');
  const second = await make('Numbering probe two');

  const { rawPool } = await import('../src/db/client.js');
  await rawPool.query('DELETE FROM verification_cases WHERE case_id = $1::uuid', [first.case_id]);

  const third = await make('Numbering probe three');
  rememberCase(second.case_id);
  rememberCase(third.case_id);

  const suffix = (n: string) => Number(n.split('-').pop());
  assert.notEqual(third.case_number, first.case_number, 'a deleted case number must not be handed out again');
  assert.ok(
    suffix(third.case_number) > suffix(second.case_number),
    `case numbers must increase monotonically (${second.case_number} -> ${third.case_number})`,
  );
});

await cleanupProbes();

console.log(`\nRESULT: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
