import { Router } from 'express';
import { z } from 'zod';
import { rawPool } from '../db/client.js';
import { attachUser, login, logout, requireAuth, requirePermission, capabilityMatrix } from '../auth/session.js';
import { maskingFor } from '../auth/policy.js';
import { asyncHandler, badRequest, envelope, notFound, parse, rateLimit, unauthorized, HttpError } from '../helpers/http.js';
import { writeAudit } from '../services/audit.js';
import { listParcels, loadRecordSets, districtsWithCounts } from '../services/parcel-repository.js';
import { buildIntelligence, buildTimeline, evidenceForFindings, provenanceFor, reconcileAllFindings } from '../services/intelligence.js';
import { buildPassport, unifiedSearch, availabilityRatio } from '../services/passport.js';
import { evaluateParcel, computeScore, deriveLinkage } from '../domain/integrity-engine.js';
import { RULES } from '../domain/rules.js';
import { buildAnalytics, sourceHealth, departmentGateway } from '../services/analytics.js';
import {
  createCase, updateCase, listCases, getCase, createServiceRequest,
  listServiceRequests, updateServiceRequest, notificationsFor, markNotificationRead,
  allowedCaseTransitions, SERVICE_TYPES,
} from '../services/workflow.js';
import { listAudit } from '../services/audit.js';
import { ADAPTERS, adapterFor, fetchOverpassContext, copernicusAdapter } from '../adapters/index.js';
import { healthCacheStats } from '../adapters/base.js';
import { SOURCE_CATALOGUE, LAYER_CATALOGUE } from '../data/source-catalogue.js';
import { maskPersonName, maskAmount, maskAssessmentNumber } from '../helpers/http.js';
import { hasPostgis, pingDatabase } from '../db/client.js';
import { config } from '../config.js';
import type { CaseStatus, ServiceStatus } from '../types/domain.js';
import { DEMO_NOTICE } from '../data/parcel-fixtures.js';

export const api = Router();

api.use(attachUser);

/* -------------------------------------------------------------------------- */
/* Meta                                                                       */
/* -------------------------------------------------------------------------- */

api.get('/meta', (_req, res) => {
  res.json({
    product: 'BHUMISETU',
    productFullName: 'BHUMISETU — Integrated GIS Land Stack & Parcel Intelligence Platform',
    tagline: 'One Parcel. One Digital Identity. Every Record. Every Change.',
    version: config.appVersion,
    dataMode: config.dataMode,
    datasetNotice: DEMO_NOTICE,
    algorithm: {
      id: 'ULPIN_DEMO',
      label: 'ULPIN-compatible display identifier (demonstration)',
      official: false,
      note: 'Display identifiers follow a ULPIN-compatible shape for interface development. They are synthetic values and are NOT official ULPIN identifiers.',
    },
  });
});

/**
 * Liveness and dependency report. Must stay fast: it is polled by the PWA and
 * by container health checks. Adapter statuses come from the snapshot cache, so
 * an unreachable upstream can never stall this response.
 */
api.get('/health', asyncHandler(async (_req, res) => {
  const started = Date.now();
  const [db, postgis] = await Promise.all([
    pingDatabase().catch(() => ({ ok: false, version: null })),
    hasPostgis().catch(() => false),
  ]);
  const sources = ADAPTERS.map((a) => healthSnapshotFor(a.sourceId));
  res.json({
    ok: db.ok,
    version: config.appVersion,
    database: { ...db, postgis },
    api: { latencyMs: Date.now() - started },
    sources,
    cache: healthCacheStats(),
    checkedAt: new Date().toISOString(),
  });
}));

/** Synchronous adapter status read; never triggers an upstream probe. */
function healthSnapshotFor(sourceId: string) {
  return ADAPTERS.find((a) => a.sourceId === sourceId)?.cachedHealth?.() ?? null;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

api.post(
  '/auth/login',
  rateLimit({ windowMs: 60_000, max: 12, key: 'login' }),
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }), req.body, 'login payload');
    try {
      const result = await login(body.username, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
      await writeAudit({
        actor: result.user.username,
        actorUserId: result.user.userId,
        role: result.user.role,
        action: 'LOGIN',
        entityType: 'session',
        entityId: result.user.sessionId,
        after: { username: result.user.username, role: result.user.role },
        ip: req.ip,
        requestId: req.requestId ?? null,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        await writeAudit({
          actor: body.username,
          role: 'unknown',
          action: 'LOGIN_FAILED',
          entityType: 'session',
          entityId: body.username,
          reason: 'Invalid credentials',
          ip: req.ip,
        });
      }
      throw err;
    }
  }),
);

api.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await logout(req.user!.sessionId);
  await writeAudit({
    actor: req.user!.username,
    actorUserId: req.user!.userId,
    role: req.user!.role,
    action: 'LOGOUT',
    entityType: 'session',
    entityId: req.user!.sessionId,
    ip: req.ip,
  });
  res.json({ ok: true });
}));

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    masking: maskingFor(req.user!.role),
    capabilities: capabilityMatrix().find((c) => c.role === req.user!.role) ?? null,
  });
});

api.get('/auth/capabilities', (_req, res) => {
  res.json({ roles: capabilityMatrix() });
});

/* -------------------------------------------------------------------------- */
/* Parcels                                                                    */
/* -------------------------------------------------------------------------- */

const listQuery = z.object({
  district: z.string().max(80).optional(),
  village: z.string().max(120).optional(),
  taluk: z.string().max(120).optional(),
  q: z.string().max(120).optional(),
  risk: z.enum(['VERIFIED', 'REVIEW', 'HIGH RISK']).optional(),
  linkage: z.enum(['LINKED', 'PARTIALLY_LINKED', 'UNLINKED', 'CONFLICTING']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

api.get(
  '/parcels',
  asyncHandler(async (req, res) => {
    const filters = parse(listQuery, req.query, 'query parameters');
    const { rows, total } = await listParcels(filters);
    const sets = await loadRecordSets(rows.map((r) => String(r.parcel_id)));
    const ratio = await availabilityRatio();

    const items = sets.map((rs) => {
      const findings = evaluateParcel(rs);
      const score = computeScore(rs.parcel.parcel_id, findings, rs);
      const linkage = deriveLinkage(rs);
      const p = rs.parcel;
      return {
        parcelId: p.parcel_id,
        displayId: p.display_id,
        displayIdIsOfficial: false,
        surveyNumber: p.survey_number,
        subdivisionNumber: p.subdivision_number,
        district: p.district,
        taluk: p.taluk,
        village: p.village,
        localBody: p.local_body,
        areaSqft: p.area_sqft === null ? null : Number(p.area_sqft),
        areaSqm: p.area_sqm === null ? null : Number(p.area_sqm),
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        status: p.status,
        riskBand: score.band,
        score: score.score,
        findingCount: findings.length,
        findings: findings.map((f) => ({ ruleCode: f.ruleCode, severity: f.severity, title: f.title })),
        linkage: linkage.linkage,
        linkageReason: linkage.reason,
        dataStatus: p.data_status,
        provenance: provenanceFor(p.source_id, p.data_status, null),
      };
    });

    const filtered = items.filter((i) => (!filters.risk || i.riskBand === filters.risk) && (!filters.linkage || i.linkage === filters.linkage));
    void ratio;
    res.json(envelope(filtered, filters.risk || filters.linkage ? filtered.length : total, filters.limit, filters.offset));
  }),
);

api.get(
  '/parcels/:parcelId',
  asyncHandler(async (req, res) => {
    const id = req.params.parcelId;
    const intel = await buildIntelligence(id, {
      sourceAvailabilityRatio: await availabilityRatio(),
    });
    if (!intel) throw notFound(`Parcel ${id} not found`);

    const policy = maskingFor(req.user?.role ?? 'CITIZEN');
    const p = intel.parcel;
    const name = (n: string | null) => (!n ? null : policy.maskPartyNames ? maskPersonName(n) : n);

    const canReadFull = Boolean(req.user?.permissions.includes('parcel.read.full'));
    const full = canReadFull;

    const body = {
      parcel: {
        parcelId: p.parcel_id,
        displayId: p.display_id,
        displayIdNote: 'Synthetic demonstration identifier in a ULPIN-compatible format. Not an official ULPIN.',
        surveyNumber: p.survey_number,
        subdivisionNumber: p.subdivision_number,
        state: p.state,
        district: p.district,
        taluk: p.taluk,
        block: p.block,
        village: p.village,
        localBody: p.local_body,
        localBodyType: p.local_body_type,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        areaSqft: p.area_sqft === null ? null : Number(p.area_sqft),
        areaSqm: p.area_sqm === null ? null : Number(p.area_sqm),
        status: p.status,
        classification: p.classification,
        dataStatus: p.data_status,
        provenance: provenanceFor(p.source_id, p.data_status, null),
      },
      geometry: intel.recordSet.geometry
        ? {
            geometry: intel.recordSet.geometry.geometry,
            centroid: intel.recordSet.geometry.centroid,
            areaSqm: Number(intel.recordSet.geometry.area_sqm),
            areaSqft: Math.round(Number(intel.recordSet.geometry.area_sqm) * 10.7639 * 100) / 100,
            isValid: intel.recordSet.geometry.is_valid,
            validityNote: intel.recordSet.geometry.validity_note,
          }
        : null,
      ownership: {
        rorHolder: name(intel.recordSet.rorRecords[0]?.owner_name ?? null),
        latestTransferee: name(intel.recordSet.deeds[0]?.transferee_name ?? null),
        taxAssessmentName: name(intel.recordSet.taxRecords[0]?.owner_name ?? null),
        masked: policy.maskPartyNames,
      },
      findings: intel.findings,
      evidence: intel.evidence,
      score: intel.score,
      quality: intel.quality,
      linkage: { state: intel.linkage, reason: intel.linkageReason },
      records: full
        ? {
            ror: intel.recordSet.rorRecords,
            revenue: intel.recordSet.revenueRecords,
            registrations: intel.recordSet.registrations,
            deeds: intel.recordSet.deeds,
            encumbrances: intel.recordSet.encumbrances.map((e) => ({
              ...e,
              amount: policy.maskAmounts ? maskAmount(e.amount) : e.amount,
            })),
            mortgages: intel.recordSet.mortgages,
            tax: intel.recordSet.taxRecords.map((t) => ({
              ...t,
              due_amount: policy.maskAmounts ? maskAmount(t.due_amount) : t.due_amount,
              assessment_number: policy.maskAssessmentNumbers ? maskAssessmentNumber(t.assessment_number) : t.assessment_number,
            })),
            buildingPermissions: intel.recordSet.buildingPermissions,
            observations: intel.recordSet.observations,
            judiciary: intel.recordSet.judiciaryCases,
          }
        : {
            ror: intel.recordSet.rorRecords.map((r) => ({
              ...r,
              owner_name: name(r.owner_name),
              patta_number: policy.maskAssessmentNumbers ? maskAssessmentNumber(r.patta_number) : r.patta_number,
            })),
            revenue: intel.recordSet.revenueRecords,
            registrations: intel.recordSet.registrations.map((r) => ({ ...r, consideration_amount: null })),
            deeds: intel.recordSet.deeds.map((d) => ({
              ...d,
              transferor_name: name(d.transferor_name),
              transferee_name: name(d.transferee_name),
            })),
            encumbrances: intel.recordSet.encumbrances.map((e) => ({ ...e, amount: maskAmount(e.amount), holder_name: name(e.holder_name) })),
            mortgages: intel.recordSet.mortgages.map((m) => ({ ...m, mortgage_amount: null, borrower_name: name(m.borrower_name), lender_name: m.lender_name })),
            tax: intel.recordSet.taxRecords.map((t) => ({
              ...t,
              due_amount: maskAmount(t.due_amount),
              demand_amount: maskAmount(t.demand_amount),
              paid_amount: maskAmount(t.paid_amount),
              assessment_number: maskAssessmentNumber(t.assessment_number),
              owner_name: name(t.owner_name),
            })),
            buildingPermissions: intel.recordSet.buildingPermissions,
            observations: intel.recordSet.observations,
            judiciary: intel.recordSet.judiciaryCases,
          },
      maskedForRole: !full,
      maskingPolicy: policy,
    };
    res.json(body);
  }),
);

api.get(
  '/passport/:parcelId',
  asyncHandler(async (req, res) => {
    const passport = await buildPassport(req.params.parcelId, {
      role: req.user?.role ?? 'CITIZEN',
      includeContext: req.query.context === 'true',
      consentRadiusM: req.query.radius ? Number(req.query.radius) : undefined,
    });
    if (!passport) throw notFound(`Parcel ${req.params.parcelId} not found`);
    await writeAudit({
      actor: req.user?.username ?? 'anonymous',
      actorUserId: req.user?.userId ?? null,
      role: req.user?.role ?? 'GUEST',
      action: 'PASSPORT_VIEWED',
      entityType: 'parcel',
      entityId: req.params.parcelId,
      parcelId: req.params.parcelId,
      ip: req.ip,
    });
    res.json(passport);
  }),
);

api.get(
  '/parcels/:parcelId/timeline',
  asyncHandler(async (req, res) => {
    const parcel = await rawPool.query(`SELECT parcel_id FROM parcels WHERE parcel_id = $1`, [req.params.parcelId]);
    if (parcel.rowCount === 0) throw notFound('Parcel not found');
    const policy = maskingFor(req.user?.role ?? 'CITIZEN');
    const events = await buildTimeline(req.params.parcelId, { includeInternal: policy.includeInternalNotes });
    res.json({ items: events, total: events.length, maskedForRole: !policy.includeInternalNotes });
  }),
);

/* -------------------------------------------------------------------------- */
/* GeoJSON                                                                    */
/* -------------------------------------------------------------------------- */

api.get(
  '/geojson',
  asyncHandler(async (req, res) => {
    const params = parse(
      z.object({
        district: z.string().max(80).optional(),
        village: z.string().max(120).optional(),
        bbox: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      req.query,
      'geojson query',
    );

    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (params.district) {
      args.push(params.district);
      where.push(`p.district = $${args.length}`);
    }
    if (params.village) {
      args.push(params.village);
      where.push(`p.village = $${args.length}`);
    }
    if (params.bbox) {
      const parts = params.bbox.split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw badRequest('bbox must be "minLon,minLat,maxLon,maxLat"');
      }
      args.push(...parts);
      where.push(
        `p.longitude BETWEEN $${args.length - 3} AND $${args.length - 1} AND p.latitude BETWEEN $${args.length - 2} AND $${args.length}`,
      );
    }
    args.push(params.limit);

    const rows = await rawPool.query(
      `SELECT p.parcel_id, p.display_id, p.survey_number, p.village, p.district, p.area_sqft, p.area_sqm, p.data_status,
              g.geometry, g.centroid,
              (SELECT count(*) FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') AS finding_count,
              (SELECT string_agg(f.rule_code, ',') FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') AS finding_codes
       FROM parcels p JOIN parcel_geometries g ON g.parcel_id = p.parcel_id
       WHERE ${where.join(' AND ')} ORDER BY p.parcel_id LIMIT $${args.length}`,
      args,
    );

    const features = rows.rows.map((r) => {
      const findingCount = Number(r.finding_count ?? 0);
      const codes = String(r.finding_codes ?? '').split(',').filter(Boolean);
      const band =
        findingCount === 0
          ? 'VERIFIED'
          : codes.includes('OWNERSHIP_MISMATCH') || codes.includes('ENCUMBRANCE_RISK')
            ? 'HIGH RISK'
            : 'REVIEW';
      return {
        type: 'Feature' as const,
        id: r.parcel_id,
        properties: {
          parcelId: r.parcel_id,
          displayId: r.display_id,
          displayIdIsOfficial: false,
          surveyNumber: r.survey_number,
          village: r.village,
          district: r.district,
          areaSqFt: r.area_sqft === null ? null : Number(r.area_sqft),
          areaSqM: r.area_sqm === null || r.area_sqm === undefined ? null : Number(r.area_sqm),
          area: r.area_sqft === null ? null : Number(r.area_sqft),
          risk: band,
          status: 'ACTIVE',
          findingCount,
          findingCodes: codes,
          dataStatus: r.data_status,
          isDemonstration: true,
        },
        geometry: r.geometry,
      };
    });

    res.json({
      type: 'FeatureCollection',
      features,
      metadata: {
        datasetNotice: DEMO_NOTICE,
        layer: 'cadastral-parcels',
        source: 'CADASTRE_DEMO',
        authority: 'Demo fixture',
        dataStatus: 'DEMONSTRATION',
        generatedAt: new Date().toISOString(),
        count: features.length,
      },
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Layers                                                                     */
/* -------------------------------------------------------------------------- */

api.get('/layers', asyncHandler(async (_req, res) => {
  const res2 = await rawPool.query(`SELECT * FROM gis_layers ORDER BY category, name`);
  res.json({
    items: res2.rows.map((l) => ({
      layerId: l.layer_id,
      name: l.name,
      category: l.category,
      sourceId: l.source_id,
      authority: l.authority,
      serviceType: l.service_type,
      serviceUrl: l.service_url,
      attribution: l.attribution,
      defaultOpacity: Number(l.default_opacity),
      defaultVisible: l.default_visible,
      dataStatus: l.data_status,
      status: l.status,
      description: l.description,
      timestamp: l.updated_at,
    })),
    catalogue: LAYER_CATALOGUE,
  });
}));

api.get('/layers/:layerId/features', asyncHandler(async (req, res) => {
  const layerId = req.params.layerId;
  if (layerId === 'cadastral-parcels') {
    // Reuse the GeoJSON handler's shape so clients see one contract.
    const rows = await rawPool.query(
      `SELECT p.parcel_id, p.display_id, p.survey_number, p.village, p.district, p.area_sqft,
              g.geometry,
              (SELECT count(*) FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') AS finding_count
       FROM parcels p JOIN parcel_geometries g ON g.parcel_id = p.parcel_id ORDER BY p.parcel_id`,
    );
    res.json({
      type: 'FeatureCollection',
      features: rows.rows.map((r) => ({
        type: 'Feature',
        id: r.parcel_id,
        properties: {
          parcelId: r.parcel_id,
          displayId: r.display_id,
          surveyNumber: r.survey_number,
          village: r.village,
          district: r.district,
          areaSqft: r.area_sqft === null ? null : Number(r.area_sqft),
          findingCount: Number(r.finding_count ?? 0),
        },
        geometry: r.geometry,
      })),
      metadata: { layer: layerId, source: 'CADASTRE_DEMO', dataStatus: 'DEMONSTRATION', datasetNotice: DEMO_NOTICE },
    });
    return;
  }

  const layer = await rawPool.query(`SELECT * FROM gis_layers WHERE layer_id = $1`, [layerId]);
  if (layer.rowCount === 0) throw notFound(`Layer ${layerId} not found`);
  const features = await rawPool.query(`SELECT * FROM gis_features WHERE layer_id = $1 LIMIT 500`, [layerId]);
  if (features.rowCount === 0) {
    res.json({
      type: 'FeatureCollection',
      features: [],
      metadata: {
        layer: layerId,
        source: layer.rows[0].source_id,
        dataStatus: layer.rows[0].data_status,
        status: layer.rows[0].status,
        emptyReason:
          layer.rows[0].status === 'ADAPTER_READY'
            ? 'No live service is configured for this layer in this deployment. The adapter interface exists; no features are fabricated.'
            : 'This layer has no stored features for the current filters.',
      },
    });
    return;
  }
  res.json({
    type: 'FeatureCollection',
    features: features.rows.map((f) => ({
      type: 'Feature',
      id: f.feature_id,
      properties: f.properties,
      geometry: f.geometry,
    })),
    metadata: { layer: layerId, source: layer.rows[0].source_id, dataStatus: layer.rows[0].data_status },
  });
}));

/* -------------------------------------------------------------------------- */
/* Spatial context (OSM / Overpass)                                           */
/* -------------------------------------------------------------------------- */

api.get(
  '/osm-context',
  rateLimit({ windowMs: 60_000, max: 90, key: 'osm-context' }),
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        parcelId: z.string().max(64).optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
        radius: z.coerce.number().int().min(50).max(config.overpassRadiusLimitM).default(500),
      }),
      req.query,
      'osm-context query',
    );

    let lat = q.lat;
    let lon = q.lon;
    if (q.parcelId) {
      const p = await rawPool.query(`SELECT latitude, longitude FROM parcels WHERE parcel_id = $1`, [q.parcelId]);
      if (p.rowCount === 0) throw notFound('Parcel not found');
      lat = Number(p.rows[0].latitude);
      lon = Number(p.rows[0].longitude);
    }
    if (lat === undefined || lon === undefined) throw badRequest('Provide parcelId or lat/lon');

    const context = await fetchOverpassContext(q.parcelId ?? `point:${lat},${lon}`, lat, lon, q.radius);
    res.json({
      ...context,
      label: 'CONTEXTUAL GIS INFORMATION',
      disclaimer:
        'Contextual geographic information derived from OpenStreetMap. It is not cadastral, ownership or legal information.',
      attribution: '© OpenStreetMap contributors, ODbL 1.0',
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Satellite / change detection                                               */
/* -------------------------------------------------------------------------- */

api.get('/satellite/observations', asyncHandler(async (req, res) => {
  const q = parse(z.object({ parcelId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query, 'satellite query');
  const where = q.parcelId ? 'WHERE parcel_id = $1' : '';
  const args = q.parcelId ? [q.parcelId] : [];
  const rows = await rawPool.query(
    `SELECT * FROM satellite_observations ${where} ORDER BY capture_date DESC LIMIT ${q.limit}`,
    args,
  );
  const detections = await rawPool.query(
    `SELECT * FROM change_detections ${q.parcelId ? 'WHERE parcel_id = $1' : ''} ORDER BY created_at DESC LIMIT ${q.limit}`,
    args,
  );
  res.json({
    observations: rows.rows,
    changeDetections: detections.rows,
    processing: {
      mode: 'DEMONSTRATION_FIXTURE',
      notice: 'Demonstration change-detection result. No satellite processing was performed for these records.',
      replaceableBy: 'A Sentinel-2 based change-detection model behind the same adapter interface.',
      copernicus: { configured: copernicusAdapter.isConfigured(), requiresAuth: !copernicusAdapter.isConfigured() },
    },
  });
}));

api.post(
  '/satellite/catalogue',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        parcelId: z.string().max(64),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      req.body,
      'catalogue request',
    );
    const p = await rawPool.query(`SELECT latitude, longitude FROM parcels WHERE parcel_id = $1`, [body.parcelId]);
    if (p.rowCount === 0) throw notFound('Parcel not found');
    const lat = Number(p.rows[0].latitude);
    const lon = Number(p.rows[0].longitude);
    const d = 0.05;
    const result = await copernicusAdapter.searchObservations({
      bbox: [lon - d, lat - d, lon + d, lat + d],
      from: body.from,
      to: body.to,
    });
    res.json(result);
  }),
);

/* -------------------------------------------------------------------------- */
/* Findings                                                                   */
/* -------------------------------------------------------------------------- */

api.get('/findings', asyncHandler(async (req, res) => {
  await reconcileAllFindings();
  const q = parse(
    z.object({
      ruleCode: z.string().max(64).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']).optional(),
      parcelId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(10_000).default(0),
    }),
    req.query,
    'findings query',
  );
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (q.ruleCode) {
    params.push(q.ruleCode);
    where.push(`rule_code = $${params.length}`);
  }
  if (q.severity) {
    params.push(q.severity);
    where.push(`severity = $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`status = $${params.length}`);
  }
  if (q.parcelId) {
    params.push(q.parcelId);
    where.push(`parcel_id = $${params.length}`);
  }
  const countRes = await rawPool.query(`SELECT count(*)::text AS total FROM integrity_findings WHERE ${where.join(' AND ')}`, params);
  params.push(q.limit, q.offset);
  const rows = await rawPool.query(
    `SELECT * FROM integrity_findings WHERE ${where.join(' AND ')} ORDER BY parcel_id, severity LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const evidence = await evidenceForFindings(rows.rows.map((r) => String(r.finding_id)));
  res.json({ ...envelope(rows.rows, Number(countRes.rows[0]?.total ?? 0), q.limit, q.offset), evidence });
}));

api.get('/rules', asyncHandler(async (_req, res) => {
  const rows = await rawPool.query(`SELECT * FROM rule_definitions ORDER BY rule_code`);
  res.json({ items: rows.rows, canonical: RULES });
}));

api.patch(
  '/rules/:ruleCode',
  requirePermission('rule.configure'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
        deduction: z.number().int().min(0).max(100).optional(),
        isEnabled: z.boolean().optional(),
        parameters: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
        reason: z.string().min(3).max(400),
      }),
      req.body,
      'rule update',
    );
    const before = await rawPool.query(`SELECT * FROM rule_definitions WHERE rule_code = $1`, [req.params.ruleCode]);
    if (before.rowCount === 0) throw notFound('Rule not found');
    const updated = await rawPool.query(
      `UPDATE rule_definitions SET
         severity = coalesce($2, severity),
         deduction = coalesce($3, deduction),
         is_enabled = coalesce($4, is_enabled),
         parameters = coalesce($5::jsonb, parameters),
         version = version + 1, updated_at = now()
       WHERE rule_code = $1 RETURNING *`,
      [
        req.params.ruleCode,
        body.severity ?? null,
        body.deduction ?? null,
        body.isEnabled ?? null,
        body.parameters ? JSON.stringify(body.parameters) : null,
      ],
    );
    await writeAudit({
      actor: req.user!.username,
      actorUserId: req.user!.userId,
      role: req.user!.role,
      action: 'RULE_UPDATED',
      entityType: 'rule_definition',
      entityId: req.params.ruleCode,
      before: before.rows[0],
      after: updated.rows[0],
      reason: body.reason,
      requestId: req.requestId ?? null,
      ip: req.ip,
    });
    res.json(updated.rows[0]);
  }),
);

api.patch(
  '/findings/:findingId',
  requirePermission('finding.update'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']), reason: z.string().min(3).max(400) }),
      req.body,
      'finding update',
    );
    const before = await rawPool.query(`SELECT * FROM integrity_findings WHERE finding_id = $1::uuid`, [req.params.findingId]);
    if (before.rowCount === 0) throw notFound('Finding not found');
    const updated = await rawPool.query(
      `UPDATE integrity_findings SET status = $2, updated_at = now() WHERE finding_id = $1::uuid RETURNING *`,
      [req.params.findingId, body.status],
    );
    await writeAudit({
      actor: req.user!.username,
      actorUserId: req.user!.userId,
      role: req.user!.role,
      action: 'FINDING_STATUS_CHANGED',
      entityType: 'integrity_finding',
      entityId: req.params.findingId,
      before: { status: before.rows[0].status },
      after: { status: body.status },
      reason: body.reason,
      parcelId: String(before.rows[0].parcel_id),
      ip: req.ip,
    });
    res.json(updated.rows[0]);
  }),
);

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

const searchHandler = asyncHandler(async (req, res) => {
  const raw = req.method === 'GET' ? req.query : req.body;
  // `q` is the documented shorthand for GET queries; `query` is the canonical
  // field used by the JSON request body.
  const normalised = { ...(raw as Record<string, unknown>) };
  if (normalised.q !== undefined && normalised.query === undefined) normalised.query = normalised.q;
  const body = parse(
    z.object({ query: z.string().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(20) }),
    normalised,
    'search query',
  );
  const result = await unifiedSearch(body.query, { limit: body.limit, role: req.user?.role ?? 'CITIZEN' });
  res.json({
    query: body.query,
    ...result,
    datasets: {
      parcels: 'DEMONSTRATION',
      context: 'CONTEXTUAL (OpenStreetMap when reachable)',
      notice: DEMO_NOTICE,
    },
  });
});

api.post('/search', rateLimit({ windowMs: 60_000, max: 120, key: 'search' }), searchHandler);
api.get('/search', rateLimit({ windowMs: 60_000, max: 120, key: 'search-get' }), searchHandler);

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

api.get(
  '/cases',
  requireAuth,
  asyncHandler(async (req, res) => {
    const canAll = req.user!.permissions.includes('case.read.all');
    const q = parse(
      z.object({
        status: z.string().max(200).optional(),
        priority: z.string().max(100).optional(),
        assignedRole: z.string().max(64).optional(),
        assignedOfficer: z.string().max(64).optional(),
        district: z.string().max(80).optional(),
        village: z.string().max(120).optional(),
        parcelId: z.string().max(64).optional(),
        q: z.string().max(120).optional(),
        dueBefore: z.string().max(30).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
      req.query,
      'case query',
    );
    const { rows, total } = await listCases({
      status: q.status ? (q.status.split(',') as CaseStatus[]) : undefined,
      priority: q.priority ? q.priority.split(',') : undefined,
      assignedRole: q.assignedRole,
      assignedOfficer: q.assignedOfficer,
      district: q.district,
      village: q.village,
      parcelId: q.parcelId,
      q: q.q,
      dueBefore: q.dueBefore,
      createdBy: canAll ? undefined : req.user!.userId,
      limit: q.limit,
      offset: q.offset,
    });
    res.json(envelope(rows, total, q.limit, q.offset));
  }),
);

api.get(
  '/cases/:caseId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await getCase(req.params.caseId);
    if (!row) throw notFound('Case not found');
    const canAll = req.user!.permissions.includes('case.read.all');
    if (!canAll && String(row.created_by) !== req.user!.userId) {
      throw notFound('Case not found');
    }
    const includeInternal = req.user!.permissions.includes('parcel.read.internal');
    const transitions = await allowedCaseTransitions(row.status as CaseStatus);
    res.json({
      ...row,
      comments: includeInternal ? row.comments : row.comments.filter((c: { visibility: string }) => c.visibility === 'PUBLIC'),
      events: includeInternal ? row.events : row.events.filter((e: { visibility: string }) => e.visibility === 'PUBLIC'),
      availableTransitions: transitions,
      maskingApplied: !includeInternal,
    });
  }),
);

api.post(
  '/cases',
  requireAuth,
  requirePermission('case.create'),
  rateLimit({ windowMs: 60_000, max: 30, key: 'case-create' }),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        parcelId: z.string().min(1).max(64),
        title: z.string().min(4).max(200),
        description: z.string().max(4000).default(''),
        priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
        findingRefs: z.array(z.string().max(120)).max(20).default([]),
        assignedDepartment: z.string().max(80).nullable().optional(),
        assignedRole: z.string().max(64).nullable().optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      req.body,
      'case payload',
    );
    const row = await createCase({
      ...body,
      assignedDepartment: body.assignedDepartment ?? null,
      assignedRole: body.assignedRole ?? null,
      dueDate: body.dueDate ?? null,
      actor: {
        userId: req.user!.userId,
        name: req.user!.fullName,
        role: req.user!.role,
        isOfficer: req.user!.isOfficer,
      },
      ip: req.ip,
      requestId: req.requestId ?? null,
    });
    res.status(201).json(row);
  }),
);

api.post(
  '/cases/:caseId/update',
  requireAuth,
  requirePermission('case.update'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'FIELD_VERIFICATION', 'RESOLVED', 'ESCALATED']).optional(),
        priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
        assignedOfficer: z.string().uuid().nullable().optional(),
        assignedRole: z.string().max(64).nullable().optional(),
        assignedDepartment: z.string().max(80).nullable().optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        resolutionNote: z.string().max(2000).nullable().optional(),
        comment: z.string().max(4000).nullable().optional(),
        commentVisibility: z.enum(['INTERNAL', 'PUBLIC']).default('INTERNAL'),
        reason: z.string().min(3).max(400),
      }),
      req.body,
      'case update payload',
    );
    const row = await updateCase(req.params.caseId, {
      ...body,
      actor: {
        userId: req.user!.userId,
        name: req.user!.fullName,
        role: req.user!.role,
        isOfficer: req.user!.isOfficer,
      },
      ip: req.ip,
      requestId: req.requestId ?? null,
    });
    res.json(row);
  }),
);

api.get('/cases-workflow/definition', asyncHandler(async (_req, res) => {
  const rows = await rawPool.query(`SELECT * FROM workflow_definitions ORDER BY workflow_code`);
  res.json({ items: rows.rows });
}));

/* -------------------------------------------------------------------------- */
/* Officer dashboard                                                          */
/* -------------------------------------------------------------------------- */

api.get(
  '/officer',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user!.isOfficer && !req.user!.isAdmin) {
      throw new HttpError(403, 'FORBIDDEN', 'Officer role required');
    }
    await reconcileAllFindings();
    const scoped = !req.user!.isAdmin;
    const scopeRole = scoped ? req.user!.role : null;

    const [openCases, highRisk, fieldVerification, escalated, dueToday, unlinked, ownership, area, parcels] =
      await Promise.all([
        rawPool.query(`SELECT count(*)::int n FROM verification_cases WHERE status <> 'RESOLVED' ${scopeRole ? 'AND assigned_role = $1' : ''}`, scopeRole ? [scopeRole] : []),
        rawPool.query(`SELECT count(*)::int n FROM (SELECT p.parcel_id, (SELECT max(CASE f.severity WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END) FROM integrity_findings f WHERE f.parcel_id = p.parcel_id AND f.status <> 'DISMISSED') sev FROM parcels p) t WHERE t.sev = 3`),
        rawPool.query(`SELECT count(*)::int n FROM verification_cases WHERE status = 'FIELD_VERIFICATION' ${scopeRole ? 'AND assigned_role = $1' : ''}`, scopeRole ? [scopeRole] : []),
        rawPool.query(`SELECT count(*)::int n FROM verification_cases WHERE status = 'ESCALATED' ${scopeRole ? 'AND assigned_role = $1' : ''}`, scopeRole ? [scopeRole] : []),
        rawPool.query(`SELECT count(*)::int n FROM verification_cases WHERE due_date <= current_date AND status <> 'RESOLVED' ${scopeRole ? 'AND assigned_role = $1' : ''}`, scopeRole ? [scopeRole] : []),
        rawPool.query(`SELECT count(*)::int n FROM integrity_findings WHERE rule_code = 'NOT_LINKED' AND status <> 'DISMISSED'`),
        rawPool.query(`SELECT count(*)::int n FROM integrity_findings WHERE rule_code = 'OWNERSHIP_MISMATCH' AND status <> 'DISMISSED'`),
        rawPool.query(`SELECT count(*)::int n FROM integrity_findings WHERE rule_code = 'AREA_MISMATCH' AND status <> 'DISMISSED'`),
        rawPool.query(`SELECT count(*)::int n FROM parcels`),
      ]);

    const caseRows = await listCases({
      assignedRole: scopeRole ?? undefined,
      limit: 50,
      offset: 0,
    });
    // The workspace is role-scoped, but the header reports the platform-wide case
    // count too so an officer can see how much of the total workload is theirs.
    const platformCaseTotal = scoped
      ? Number((await rawPool.query(`SELECT count(*)::int n FROM verification_cases`)).rows[0]?.n ?? 0)
      : caseRows.total;

    const workload = await rawPool.query(
      `SELECT coalesce(assigned_department,'UNASSIGNED') department, count(*)::int n,
              count(*) FILTER (WHERE status <> 'RESOLVED')::int open
       FROM verification_cases GROUP BY 1 ORDER BY n DESC`,
    );

    res.json({
      scope: scoped ? `role:${scopeRole}` : 'platform',
      cards: {
        openCases: Number(openCases.rows[0]?.n ?? 0),
        highRiskParcels: Number(highRisk.rows[0]?.n ?? 0),
        fieldVerification: Number(fieldVerification.rows[0]?.n ?? 0),
        escalated: Number(escalated.rows[0]?.n ?? 0),
        dueToday: Number(dueToday.rows[0]?.n ?? 0),
        unlinkedParcels: Number(unlinked.rows[0]?.n ?? 0),
        ownershipMismatches: Number(ownership.rows[0]?.n ?? 0),
        areaMismatches: Number(area.rows[0]?.n ?? 0),
        totalParcels: Number(parcels.rows[0]?.n ?? 0),
      },
      cases: caseRows.rows,
      caseTotal: caseRows.total,
      platformCaseTotal,
      workload: workload.rows,
      datasetNotice: DEMO_NOTICE,
    });
  }),
);

api.get('/officers', requireAuth, requirePermission('case.assign'), asyncHandler(async (_req, res) => {
  const rows = await rawPool.query(
    `SELECT u.user_id, u.full_name, u.username, u.role_code, u.department, u.district, r.label AS role_label
     FROM users u JOIN roles r ON r.code = u.role_code WHERE r.is_officer = true ORDER BY u.full_name`,
  );
  res.json({ items: rows.rows });
}));

/* -------------------------------------------------------------------------- */
/* Service requests (citizen)                                                 */
/* -------------------------------------------------------------------------- */

api.post(
  '/service-requests',
  requireAuth,
  requirePermission('service.request.create'),
  rateLimit({ windowMs: 60_000, max: 20, key: 'service-create' }),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        parcelId: z.string().max(64).nullable().optional(),
        requestType: z.enum(SERVICE_TYPES),
        subject: z.string().min(4).max(200),
        description: z.string().max(4000).default(''),
        contactMasked: z.string().max(40).nullable().optional(),
      }),
      req.body,
      'service request payload',
    );
    const row = await createServiceRequest({
      parcelId: body.parcelId ?? null,
      requestType: body.requestType,
      subject: body.subject,
      description: body.description,
      requesterNameMasked: maskPersonName(req.user!.fullName) ?? 'Citizen',
      contactMasked: body.contactMasked ?? null,
      actor: { userId: req.user!.userId, name: req.user!.fullName, role: req.user!.role },
      ip: req.ip,
      requestId: req.requestId ?? null,
    });
    res.status(201).json(row);
  }),
);

api.get(
  '/service-requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const canAll = req.user!.permissions.includes('service.request.read');
    const q = parse(
      z.object({
        status: z.string().max(200).optional(),
        department: z.string().max(80).optional(),
        parcelId: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
      req.query,
      'service request query',
    );
    const { rows, total } = await listServiceRequests({
      status: q.status ? (q.status.split(',') as ServiceStatus[]) : undefined,
      department: q.department,
      parcelId: q.parcelId,
      requesterUserId: canAll ? undefined : req.user!.userId,
      limit: q.limit,
      offset: q.offset,
    });
    res.json(envelope(rows, total, q.limit, q.offset));
  }),
);

api.post(
  '/service-requests/:requestId/update',
  requireAuth,
  requirePermission('service.request.update'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        status: z.enum(['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'FIELD_VERIFICATION', 'RESOLVED', 'REJECTED']),
        note: z.string().min(3).max(1000),
        linkCaseId: z.string().uuid().nullable().optional(),
      }),
      req.body,
      'service request update',
    );
    const row = await updateServiceRequest({
      requestId: req.params.requestId,
      status: body.status,
      note: body.note,
      linkCaseId: body.linkCaseId ?? null,
      actor: { userId: req.user!.userId, name: req.user!.fullName, role: req.user!.role },
      ip: req.ip,
      requestIdHeader: req.requestId ?? null,
    });
    res.json(row);
  }),
);

api.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const items = await notificationsFor({ userId: req.user!.userId, role: req.user!.role }, 40);
  res.json({ items, unread: items.filter((n) => !n.read_at).length });
}));

api.post('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const row = await markNotificationRead(req.params.id, req.user!.userId);
  if (!row) throw notFound('Notification not found');
  res.json(row);
}));

/* -------------------------------------------------------------------------- */
/* Analytics / gateway / sources / admin                                      */
/* -------------------------------------------------------------------------- */

api.get('/analytics', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.json(await buildAnalytics());
}));

api.get('/gateway', requirePermission('gateway.read'), asyncHandler(async (_req, res) => {
  res.json({ departments: await departmentGateway() });
}));

api.get('/data-sources', asyncHandler(async (req, res) => {
  const probe = req.query.probe === 'true';
  if (!probe) {
    const rows = await rawPool.query(`SELECT * FROM data_sources ORDER BY category, source_id`);
    res.json({
      items: rows.rows.map((r) => ({
        sourceId: r.source_id, name: r.name, organization: r.organization, category: r.category,
        url: r.url, authority: r.authority, status: r.status, capability: r.capability,
        coverage: r.coverage, licenceNote: r.licence_note, isAuthoritative: r.is_authoritative,
        isContextual: r.is_contextual, isDerived: r.is_derived, isDemonstration: r.is_demonstration,
        isEnabled: r.is_enabled, dataStatus: r.data_status, freshnessNote: r.freshness_note,
        lastCheckedAt: r.last_checked_at, lastSuccessAt: r.last_success_at, lastErrorAt: r.last_error_at,
        lastError: r.last_error, latencyMs: r.latency_ms, endpoint: r.endpoint,
      })),
      catalogue: SOURCE_CATALOGUE.map((s) => ({ sourceId: s.sourceId, probe: s.probe, status: s.status })),
    });
    return;
  }
  const { health, catalogue } = await sourceHealth();
  res.json({ items: catalogue, health });
}));

api.get('/data-sources/:sourceId', asyncHandler(async (req, res) => {
  const a = adapterFor(req.params.sourceId);
  const row = await rawPool.query(`SELECT * FROM data_sources WHERE source_id = $1`, [req.params.sourceId]);
  if (!a && row.rowCount === 0) throw notFound('Source not found');
  const health = a ? await a.health() : null;
  const runs = await rawPool.query(
    `SELECT * FROM source_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT 20`,
    [req.params.sourceId],
  );
  const ingestion = await rawPool.query(
    `SELECT * FROM ingestion_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT 20`,
    [req.params.sourceId],
  );
  res.json({
    definition: row.rows[0] ?? null,
    metadata: a?.sourceMetadata() ?? null,
    health,
    runs: runs.rows,
    ingestion: ingestion.rows,
    pipeline: ['SOURCE', 'FETCH', 'VALIDATE', 'NORMALIZE', 'MAP', 'PROVENANCE', 'STORE', 'INDEX', 'ANALYZE', 'DISPLAY'],
  });
}));

api.post(
  '/data-sources/:sourceId/toggle',
  requirePermission('source.configure'),
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ isEnabled: z.boolean(), reason: z.string().min(3).max(400) }), req.body, 'toggle payload');
    const before = await rawPool.query(`SELECT * FROM data_sources WHERE source_id = $1`, [req.params.sourceId]);
    if (before.rowCount === 0) throw notFound('Source not found');
    const after = await rawPool.query(
      `UPDATE data_sources SET is_enabled = $2, updated_at = now(), status = CASE WHEN $2 THEN status ELSE 'NOT_CONFIGURED'::source_status_t END
       WHERE source_id = $1 RETURNING *`,
      [req.params.sourceId, body.isEnabled],
    );
    await writeAudit({
      actor: req.user!.username,
      actorUserId: req.user!.userId,
      role: req.user!.role,
      action: 'SOURCE_TOGGLED',
      entityType: 'data_source',
      entityId: req.params.sourceId,
      before: { isEnabled: before.rows[0].is_enabled, status: before.rows[0].status },
      after: { isEnabled: after.rows[0].is_enabled, status: after.rows[0].status },
      reason: body.reason,
      ip: req.ip,
    });
    res.json(after.rows[0]);
  }),
);

api.get('/admin/overview', requirePermission('user.manage'), asyncHandler(async (_req, res) => {
  const [users, roles, audits, sources, cases] = await Promise.all([
    rawPool.query(`SELECT u.user_id, u.username, u.full_name, u.role_code, u.district, u.department, u.active, u.last_login_at FROM users u ORDER BY u.username`),
    rawPool.query(`SELECT r.code, r.label, r.is_officer, r.is_admin, count(rp.permission_code)::int AS permission_count
                   FROM roles r LEFT JOIN role_permissions rp ON rp.role_code = r.code GROUP BY r.code ORDER BY r.code`),
    rawPool.query(`SELECT count(*)::int AS n FROM audit_logs`),
    rawPool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('UPSTREAM_UNAVAILABLE','NOT_CONFIGURED'))::int AS degraded FROM data_sources`),
    rawPool.query(`SELECT count(*)::int AS open FROM verification_cases WHERE status <> 'RESOLVED'`),
  ]);
  res.json({
    users: users.rows,
    roles: roles.rows,
    auditCount: Number(audits.rows[0]?.n ?? 0),
    sources: {
      total: Number(sources.rows[0]?.total ?? 0),
      degraded: Number(sources.rows[0]?.degraded ?? 0),
    },
    openCases: Number(cases.rows[0]?.open ?? 0),
    capabilityMatrix: capabilityMatrix(),
    workflows: (await rawPool.query(`SELECT * FROM workflow_definitions ORDER BY workflow_code`)).rows,
    limitations: {
      demoNotice: DEMO_NOTICE,
      externalIntegrations: [
        'TNGIS — adapter interface only; no authorised service endpoint configured.',
        'Bhuvan WMS — probed live; used as contextual LULC only.',
        'OpenStreetMap / Overpass — live contextual queries, cached and rate limited.',
        'Copernicus — adapter implemented, OAuth credentials required.',
        'Survey of India, data.gov.in, NBSS&LUP, DataMeet, Geofabrik — adapter architecture declared.',
        'Judiciary (eCourts) — demonstration fixture only; no live court data is claimed.',
      ],
    },
  });
}));

api.get('/audit', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const q = parse(
    z.object({
      entityType: z.string().max(64).optional(),
      entityId: z.string().max(120).optional(),
      parcelId: z.string().max(64).optional(),
      action: z.string().max(64).optional(),
      actor: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(10_000).default(0),
    }),
    req.query,
    'audit query',
  );
  const { rows, total } = await listAudit(q);
  res.json(envelope(rows, total, q.limit, q.offset));
}));

api.get('/admin/ingestion', requirePermission('source.configure'), asyncHandler(async (_req, res) => {
  const rows = await rawPool.query(
    `SELECT ir.*, ds.name AS source_name FROM ingestion_runs ir
     JOIN data_sources ds ON ds.source_id = ir.source_id ORDER BY ir.started_at DESC LIMIT 100`,
  );
  const runs = await rawPool.query(
    `SELECT sr.*, ds.name AS source_name FROM source_runs sr
     JOIN data_sources ds ON ds.source_id = sr.source_id ORDER BY sr.started_at DESC LIMIT 100`,
  );
  const quality = await rawPool.query(
    `SELECT * FROM quality_metrics ORDER BY computed_at DESC LIMIT 50`,
  );
  res.json({
    pipeline: ['SOURCE', 'FETCH', 'VALIDATE', 'NORMALIZE', 'MAP', 'PROVENANCE', 'STORE', 'INDEX', 'ANALYZE', 'DISPLAY'],
    ingestionRuns: rows.rows,
    adapterRuns: runs.rows,
    qualityMetrics: quality.rows,
    note: 'Ingestion architecture: external feeds enter through SOURCE → FETCH → VALIDATE → NORMALIZE → MAP → PROVENANCE → STORE → INDEX → ANALYZE → DISPLAY. Adapter probes above are recorded as runs.',
  });
}));

/**
 * Bitemporal record versions. Every workflow action and record change writes a
 * version row, so the platform can answer "what did this look like then, and
 * when did we learn it" rather than only "what is it now".
 */
api.get('/temporal', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const q = parse(
    z.object({
      entityType: z.string().max(64).optional(),
      entityId: z.string().max(120).optional(),
      parcelId: z.string().max(64).optional(),
      changeType: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(10_000).default(0),
    }),
    req.query,
    'temporal query',
  );
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.entityType) {
    params.push(q.entityType);
    where.push(`tv.entity_type = $${params.length}`);
  }
  if (q.entityId) {
    params.push(q.entityId);
    where.push(`tv.entity_id = $${params.length}`);
  }
  if (q.parcelId) {
    params.push(q.parcelId);
    where.push(`tv.parcel_id = $${params.length}`);
  }
  if (q.changeType) {
    params.push(q.changeType);
    where.push(`tv.change_type = $${params.length}`);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await rawPool.query<{ n: string }>(`SELECT count(*)::int AS n FROM temporal_versions tv ${clause}`, params);
  const rows = await rawPool.query(
    `SELECT tv.version_id, tv.entity_type, tv.entity_id, tv.parcel_id, tv.change_type,
            tv.actor, tv.before_value, tv.after_value, tv.reason, tv.source_id,
            tv.valid_from, tv.valid_to, tv.recorded_at
     FROM temporal_versions tv ${clause}
     ORDER BY tv.recorded_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, q.offset],
  );
  res.json(envelope(rows.rows, Number(totalRes.rows[0]?.n ?? 0), q.limit, q.offset));
}));

api.get('/districts', asyncHandler(async (_req, res) => {
  res.json({ items: await districtsWithCounts() });
}));

api.get('/stats', asyncHandler(async (_req, res) => {
  await reconcileAllFindings();
  const [parcels, findings, cases, sources] = await Promise.all([
    rawPool.query(`SELECT count(*)::int n FROM parcels`),
    rawPool.query(`SELECT count(*)::int n FROM integrity_findings WHERE status <> 'DISMISSED'`),
    rawPool.query(`SELECT count(*)::int n FROM verification_cases`),
    rawPool.query(`SELECT count(*)::int n FROM data_sources`),
  ]);
  const unlinked = await rawPool.query(`SELECT count(*)::int n FROM integrity_findings WHERE rule_code = 'NOT_LINKED' AND status <> 'DISMISSED'`);
  const bands = await riskBandCounts();
  const demoParcels = Number(parcels.rows[0]?.n ?? 0);
  res.json({
    parcels: demoParcels,
    findings: Number(findings.rows[0]?.n ?? 0),
    cases: Number(cases.rows[0]?.n ?? 0),
    sources: Number(sources.rows[0]?.n ?? 0),
    highRisk: bands['HIGH RISK'] ?? 0,
    review: bands.REVIEW ?? 0,
    unlinked: Number(unlinked.rows[0]?.n ?? 0),
    verified: bands.VERIFIED ?? 0,
    datasetLabel: demoParcels <= 50 ? 'Demo dataset' : 'Production dataset',
    datasetNotice: DEMO_NOTICE,
  });
}));

/**
 * Risk bands are derived from the same verification-support score the parcel
 * view shows, so the header counters and the parcel panel cannot disagree.
 */
async function riskBandCounts(): Promise<Record<string, number>> {
  const rows = await rawPool.query(`SELECT parcel_id FROM parcels`);
  const sets = await loadRecordSets(rows.rows.map((r) => String(r.parcel_id)));
  const bands: Record<string, number> = { VERIFIED: 0, REVIEW: 0, 'HIGH RISK': 0 };
  for (const rs of sets) {
    const findings = evaluateParcel(rs);
    const band = computeScore(rs.parcel.parcel_id, findings, rs).band;
    bands[band] += 1;
  }
  return bands;
}

/* -------------------------------------------------------------------------- */
/* Reports / exports                                                          */
/* -------------------------------------------------------------------------- */

api.get('/reports/parcel/:parcelId', asyncHandler(async (req, res) => {
  const passport = await buildPassport(req.params.parcelId, { role: req.user?.role ?? 'CITIZEN' });
  if (!passport) throw notFound('Parcel not found');
  const format = String(req.query.format ?? 'json');
  if (format === 'csv') {
    const rows: string[][] = [];
    rows.push(['Section', 'Field', 'Value', 'Source', 'Authority', 'Data status']);
    const add = (section: string, field: string, value: unknown, prov?: { source: string; sourceAuthority: string; dataStatus: string }) => {
      rows.push([section, field, value === null || value === undefined ? '' : String(value), prov?.source ?? '', prov?.sourceAuthority ?? '', prov?.dataStatus ?? '']);
    };
    add('Header', 'Product', passport.header.product, undefined);
    add('Header', 'Generated', passport.header.generatedAt);
    add('Header', 'Dataset notice', passport.header.datasetNotice);
    add('Executive', 'Parcel ID', passport.executiveSummary.parcelId);
    add('Executive', 'Display ID', passport.executiveSummary.displayId);
    add('Executive', 'Risk band', passport.executiveSummary.riskBand);
    add('Executive', 'Score', passport.executiveSummary.score);
    add('Executive', 'Village', passport.executiveSummary.village);
    add('Executive', 'District', passport.executiveSummary.district);
    for (const f of passport.findings) {
      add('Findings', f.ruleCode, `${f.severity} — ${f.title}`);
    }
    for (const p of passport.ownership.parties) {
      add('Ownership', p.role, p.name, p.provenance);
    }
    for (const r of passport.ror) {
      add('RoR', 'Record', r.ownerName, r.provenance);
    }
    add('Disclaimer', 'Notice', passport.header.disclaimer);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="bhumisetu-${req.params.parcelId}.csv"`);
    res.send(csv);
    return;
  }
  res.json({
    reportType: 'PARCEL_LAND_PASSPORT',
    generatedAt: new Date().toISOString(),
    generatedBy: req.user?.username ?? 'anonymous',
    header: passport.header,
    executiveSummary: passport.executiveSummary,
    findings: passport.findings,
    ownership: passport.ownership,
    geometry: passport.geometry,
    sources: passport.sources,
    timeline: passport.timeline.slice(0, 50),
    disclaimer: passport.header.disclaimer,
    note: 'PDF export is not enabled in this deployment; CSV and JSON exports are available and carry the same header, provenance and disclaimer.',
  });
}));

api.get('/reports/case/:caseId', requireAuth, asyncHandler(async (req, res) => {
  const row = await getCase(req.params.caseId);
  if (!row) throw notFound('Case not found');
  res.json({
    reportType: 'VERIFICATION_CASE_REPORT',
    generatedAt: new Date().toISOString(),
    generatedBy: req.user!.username,
    header: {
      product: 'BHUMISETU',
      disclaimer:
        'This report is a digital information and verification-support view. It does not by itself constitute a legal determination, title certificate, ownership certificate, or government record.',
      datasetNotice: DEMO_NOTICE,
    },
    case: row,
  });
}));

api.get('/reports/geojson', asyncHandler(async (req, res) => {
  res.redirect(307, '/api/geojson');
}));

api.get('/reports/audit', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const { rows } = await listAudit({ limit: 200, offset: 0 });
  res.json({
    reportType: 'AUDIT_REPORT',
    generatedAt: new Date().toISOString(),
    generatedBy: req.user!.username,
    header: { product: 'BHUMISETU', disclaimer: 'Audit records are append-only and are not modified by application code.' },
    entries: rows,
  });
}));

/* -------------------------------------------------------------------------- */
/* Explicit unavailability (no fake buttons anywhere in the client)           */
/* -------------------------------------------------------------------------- */

api.all('/unavailable/:feature', (req, res) => {
  const feature = req.params.feature;
  const reasons: Record<string, string> = {
    'ai-assistant':
      'The AI assistant is an AI-ready architecture. Deterministic functionality (search, integrity engine, workflow) works without it. Configure AI_PROVIDER and AI_API_KEY to enable an optional provider; AI output would be labelled AI-generated with confidence and source evidence, and would not provide legal advice.',
    'document-upload':
      'Document records exist as metadata. File upload is not enabled because no object store is configured in this deployment.',
    pdf: 'PDF generation is not enabled in this deployment. CSV and JSON exports are available.',
    ocr: 'Document OCR is an architecture stub. No OCR provider is configured.',
    'wms-proxy': 'No OGC WMS proxy is configured. Bhuvan is consumed directly as a contextual layer by the client.',
  };
  res.status(501).json({
    unavailable: true,
    feature,
    reason: reasons[feature] ?? 'This capability is not enabled in this deployment.',
    configurationDependent: true,
  });
});
