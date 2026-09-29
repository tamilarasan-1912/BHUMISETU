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
const probeRequestIds: string[] = [];

async function cleanupProbes() {
  if (probeCaseIds.length === 0 && probeRequestIds.length === 0) return;
  const { rawPool } = await import('../src/db/client.js');
  const ids = probeCaseIds;
  const requestIds = probeRequestIds;

  if (requestIds.length > 0) {
    await rawPool.query('DELETE FROM service_request_events WHERE request_id = ANY($1::uuid[])', [requestIds]);
    await rawPool.query('DELETE FROM service_requests WHERE request_id = ANY($1::uuid[])', [requestIds]);
  }
  // case_id is uuid while audit entity_id is text, so the casts differ.
  for (const table of ['case_events', 'case_comments', 'case_assignments']) {
    await rawPool.query(`DELETE FROM ${table} WHERE case_id = ANY($1::uuid[])`, [ids]);
  }
  await rawPool.query('UPDATE service_requests SET linked_case_id = NULL WHERE linked_case_id = ANY($1::uuid[])', [ids]);
  await rawPool.query('DELETE FROM verification_cases WHERE case_id = ANY($1::uuid[])', [ids]);
  await rawPool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::text[])', [[...ids, ...requestIds]]);
  console.log(
    `  \x1b[90mcleaned ${ids.length} probe case(s) and ${requestIds.length} probe service request(s) from the demonstration dataset\x1b[0m`,
  );
}

function rememberCase(id: string) {
  probeCaseIds.push(id);
  return id;
}

function rememberRequest(id: string) {
  probeRequestIds.push(id);
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
await check('a case can be addressed by its display number, not only its uuid', async () => {
  // Regression: the interface shows the case number as the case's identity, but
  // every route queried case_id (uuid). A case number therefore produced a 500
  // from a Postgres uuid cast, and the identifier the user actually sees was not
  // dereferenceable. Both forms must resolve to the same case.
  const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };
  const created = (await (
    await get('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...officerAuth },
      body: JSON.stringify({ parcelId: 'PARC-B', title: 'Case number lookup probe', description: 'address the case by its number' }),
    })
  ).json()) as { case_id: string; case_number: string };
  rememberCase(created.case_id);

  const byNumber = await get(`/api/cases/${encodeURIComponent(created.case_number)}`, { headers: officerAuth });
  assert.equal(byNumber.status, 200, `reading by case number returned ${byNumber.status}`);
  const detail = (await byNumber.json()) as { case_id: string; events: unknown[] };
  assert.equal(detail.case_id, created.case_id, 'the case number must resolve to the same case');
  assert.ok(detail.events.length > 0, 'the resolved case must carry its events');

  const report = await get(`/api/reports/case/${encodeURIComponent(created.case_number)}`, { headers: officerAuth });
  assert.equal(report.status, 200, `case report by number returned ${report.status}`);

  // A write by number must land on the same case, with its event and audit record.
  const updated = await get(`/api/cases/${encodeURIComponent(created.case_number)}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...officerAuth },
    body: JSON.stringify({ status: 'UNDER_REVIEW', reason: 'Advancing a case addressed by its number.' }),
  });
  assert.equal(updated.status, 200, `updating by case number returned ${updated.status}`);
  const after = await json<{ case_id: string; status: string; events: { event_type: string }[] }>(
    `/api/cases/${created.case_id}`,
    { headers: officerAuth },
  );
  assert.equal(after.case_id, created.case_id, 'a write by number must not create a second case');
  assert.equal(after.status, 'UNDER_REVIEW', 'the status change must land on the addressed case');
  assert.ok(
    after.events.some((e) => e.event_type === 'STATUS_CHANGED'),
    'a status change by case number must still write a case event',
  );
});
await check('an unaddressable identifier is refused, never a server error', async () => {
  // A malformed identifier must be a clean not-found. It previously reached
  // Postgres and surfaced as a 500 with the driver message attached.
  const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };
  const adminAuth = { Authorization: `Bearer ${await login('admin', 'admin@123')}` };
  const probes: [string, RequestInit | undefined, Record<string, string>][] = [
    ['/api/cases/not-a-uuid', undefined, officerAuth],
    ['/api/reports/case/not-a-uuid', undefined, officerAuth],
    ['/api/notifications/not-a-uuid/read', { method: 'POST' }, officerAuth],
    ['/api/findings/not-a-uuid', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RESOLVED', reason: 'probe' }) }, adminAuth],
  ];
  for (const [path, init, auth] of probes) {
    const res = await get(path, { ...init, headers: { ...auth, ...(init?.headers as Record<string, string> | undefined) } });
    assert.ok(res.status < 500, `${path} returned ${res.status}; an unaddressable id must not be a server error`);
  }
  // A genuinely absent but well-formed identifier stays a not-found.
  const absent = await get('/api/cases/00000000-0000-0000-0000-000000000000', { headers: officerAuth });
  assert.equal(absent.status, 404, `an absent case must be 404, got ${absent.status}`);
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

console.log('\nCitizen service requests');
const officerAuth = { Authorization: `Bearer ${await login('revenue', 'officer@123')}` };

const srCreateRes = await get('/api/service-requests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...citizenAuth },
  body: JSON.stringify({
    parcelId: 'PARC-F',
    requestType: 'OWNERSHIP_VERIFICATION',
    subject: 'Ownership record needs verification',
    description: 'The Record of Rights does not appear against this parcel in the citizen view.',
  }),
});
const createdRequest = (await srCreateRes.json()) as {
  request_id: string;
  reference_number: string;
  status: string;
  assigned_department: string;
};
rememberRequest(createdRequest.request_id);

await check('a citizen can raise a service request', () => {
  assert.equal(srCreateRes.status, 201, `expected 201, got ${srCreateRes.status}`);
  assert.equal(createdRequest.status, 'SUBMITTED');
  assert.match(createdRequest.reference_number, /^SR-\d{4}-\d{5}$/, `unexpected reference ${createdRequest.reference_number}`);
});
await check('the request is routed to the department that owns the record', () => {
  // OWNERSHIP_VERIFICATION belongs to Revenue; a routing regression would send
  // it to the wrong department and the workload board would be wrong.
  assert.equal(createdRequest.assigned_department, 'Revenue');
});
await check('a citizen sees only their own service requests', async () => {
  const body = await json<{ items: { request_id: string }[] }>('/api/service-requests', { headers: citizenAuth });
  assert.ok(
    body.items.some((r) => r.request_id === createdRequest.request_id),
    'the citizen must be able to read the request they raised',
  );
});
await check('a citizen cannot acknowledge their own request', async () => {
  // service.request.update is an officer permission; self-approval must be refused.
  const res = await get(`/api/service-requests/${createdRequest.request_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...citizenAuth },
    body: JSON.stringify({ status: 'RESOLVED', note: 'Resolving my own request.' }),
  });
  assert.equal(res.status, 403, `expected 403 for a citizen transition, got ${res.status}`);
});
await check('an officer can acknowledge a service request', async () => {
  const res = await get(`/api/service-requests/${createdRequest.request_id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...officerAuth },
    body: JSON.stringify({ status: 'ACKNOWLEDGED', note: 'Acknowledged and routed for field review.' }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const updated = (await res.json()) as { status: string };
  assert.equal(updated.status, 'ACKNOWLEDGED');
});
await check('the service request transition is recorded in the audit trail', async () => {
  const { rawPool } = await import('../src/db/client.js');
  const res = await rawPool.query(
    `SELECT action FROM audit_logs WHERE entity_id = $1 AND entity_type = 'service_request'`,
    [createdRequest.request_id],
  );
  const actions = res.rows.map((r: { action: string }) => r.action);
  assert.ok(actions.includes('SERVICE_REQUEST_CREATED'), `expected a creation audit entry, saw ${actions.join(', ')}`);
  assert.ok(actions.includes('SERVICE_REQUEST_UPDATED'), `expected a status-change audit entry, saw ${actions.join(', ')}`);
});

console.log('\nStatus surfaces stay off the network');
await check('the gateway answers without waiting on an upstream probe', async () => {
  // Regression: this endpoint used to await every adapter health() probe, so
  // Overpass and Bhuvan timeouts pushed it past 20s and the page rendered an
  // empty department list. It must now read the cached snapshot and return fast.
  const started = Date.now();
  const d = await json<{ departments: unknown[] }>('/api/gateway', { headers: officerAuth });
  const elapsed = Date.now() - started;
  assert.ok(Array.isArray(d.departments) && d.departments.length > 0, 'gateway must report departments');
  assert.ok(elapsed < 5000, `gateway took ${elapsed}ms; it must not block on live probes`);
});
await check('a repeated gateway read starts no new source runs', async () => {
  const { rawPool } = await import('../src/db/client.js');
  const count = async () => Number((await rawPool.query('SELECT count(*)::int AS n FROM source_runs')).rows[0].n);
  await json('/api/gateway', { headers: officerAuth });
  const before = await count();
  await json('/api/gateway', { headers: officerAuth });
  await json('/api/analytics', { headers: officerAuth });
  const after = await count();
  assert.equal(after, before, `status reads must not trigger probes (source_runs ${before} -> ${after})`);
});

console.log('\nIntegrity rules and evidence');
await check('the six canonical rules are defined and recomputable', async () => {
  const d = await json<{ canonical: { ruleCode: string }[] }>('/api/rules');
  const codes = d.canonical.map((r) => r.ruleCode).sort();
  assert.deepEqual(
    codes,
    ['AREA_MISMATCH', 'BUILDING_UNAPPROVED_CHANGE', 'ENCUMBRANCE_RISK', 'NOT_LINKED', 'OWNERSHIP_MISMATCH', 'TAX_MISMATCH'],
    `unexpected canonical rule set: ${codes.join(', ')}`,
  );
});
await check('every finding carries evidence that resolves to a source and authority', async () => {
  // The evidence chain is the product's core claim: finding -> evidence -> source
  // -> record -> authority. Assert it end to end rather than trusting the UI.
  const parcels = ['PARC-B', 'PARC-C', 'PARC-D', 'PARC-E', 'PARC-F'];
  let checked = 0;
  for (const parcelId of parcels) {
    const p = await json<{ findings: { ruleCode: string; evidence: Record<string, unknown>[] }[] }>(`/api/passport/${parcelId}`);
    for (const f of p.findings) {
      assert.ok(Array.isArray(f.evidence) && f.evidence.length > 0, `${parcelId}/${f.ruleCode} has no evidence`);
      for (const e of f.evidence) {
        for (const field of ['sourceId', 'sourceAuthority', 'dataStatus', 'provenance']) {
          assert.ok(e[field], `${parcelId}/${f.ruleCode} evidence is missing "${field}"`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 5, `expected evidence for the demonstration findings, checked ${checked}`);
});
await check('the demonstration dataset matches the specified rule per parcel', async () => {
  // The acceptance criteria name one expected rule per parcel. A cross-parcel
  // leak would show up here as the wrong code on the wrong parcel.
  const expected: Record<string, string> = {
    'PARC-B': 'OWNERSHIP_MISMATCH',
    'PARC-C': 'AREA_MISMATCH',
    'PARC-D': 'ENCUMBRANCE_RISK',
    'PARC-E': 'BUILDING_UNAPPROVED_CHANGE',
    'PARC-F': 'NOT_LINKED',
  };
  for (const [parcelId, ruleCode] of Object.entries(expected)) {
    const p = await json<{ findings: { ruleCode: string }[] }>(`/api/passport/${parcelId}`);
    const codes = p.findings.map((f) => f.ruleCode);
    assert.ok(codes.includes(ruleCode), `${parcelId} must raise ${ruleCode}, saw ${codes.join(', ') || 'none'}`);
  }
});
await check('the clean parcel raises no findings', async () => {
  const p = await json<{ findings: unknown[] }>('/api/passport/PARC-A');
  assert.equal(p.findings.length, 0, 'PARC-A must be clean');
});

console.log('\nTemporal records, reports and honest unavailability');
await check('temporal versions are exposed to an authorised reader', async () => {
  const d = await json<{ items: unknown[] }>('/api/temporal', { headers: officerAuth });
  assert.ok(Array.isArray(d.items), 'temporal records must be returned as a list');
});
await check('the parcel CSV report states provenance per row', async () => {
  const res = await get('/api/reports/parcel/PARC-B?format=csv');
  assert.ok(res.ok, `CSV report returned ${res.status}`);
  const text = await res.text();
  assert.match(text, /^"Section","Field","Value","Source","Authority","Data status"/m, 'CSV must lead with the provenance columns');
  assert.match(text, /not official government land records/i, 'the report must carry the dataset notice');
});
await check('an unconfigured feature reports 501 rather than pretending', async () => {
  const res = await get('/api/unavailable/pdf');
  assert.equal(res.status, 501, `expected 501, got ${res.status}`);
  const body = (await res.json()) as { unavailable: boolean };
  assert.equal(body.unavailable, true);
});

await cleanupProbes();

console.log(`\nRESULT: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
