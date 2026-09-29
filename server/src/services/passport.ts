import { rawPool } from '../db/client.js';
import { loadRecordSets, findByAnyIdentifier } from './parcel-repository.js';
import { buildIntelligence, buildTimeline, provenanceFor } from './intelligence.js';
import { computeScore, deriveLinkage, evaluateParcel } from '../domain/integrity-engine.js';
import { maskingFor, type MaskingPolicy } from '../auth/policy.js';
import { maskAssessmentNumber, maskPersonName, maskAmount } from '../helpers/http.js';
import { SOURCE_CATALOGUE } from '../data/source-catalogue.js';
import { DEMO_NOTICE } from '../data/parcel-fixtures.js';
import { fetchOverpassContext, copernicusAdapter } from '../adapters/index.js';
import type { Provenance } from '../types/domain.js';

const SOURCE_INDEX = new Map(SOURCE_CATALOGUE.map((s) => [s.sourceId, s]));

/** Normalises a Date | string | null value from the driver into an ISO string. */
function recordedAtIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Replaces every occurrence of a party name anywhere in a serialised passport
 * with its masked form. Section-level masking covers the typed fields, but
 * finding evidence and timeline descriptions embed raw names inside free text;
 * without this a citizen view would still leak the identifier it just masked.
 */
export function scrubPartyNames<T>(value: T, names: string[]): T {
  const real = [...new Set(names.filter((n) => n && n.trim().length > 1))].sort(
    (a, b) => b.length - a.length,
  );
  if (real.length === 0) return value;

  const scrub = (node: unknown): unknown => {
    if (typeof node === 'string') {
      let out = node;
      for (const name of real) {
        const masked = maskPersonName(name);
        if (!masked) continue;
        out = out.split(name).join(masked);
      }
      return out;
    }
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = scrub(o[k]);
      return o;
    }
    return node;
  };
  return scrub(value) as T;
}

export interface PassportOptions {
  role: string;
  includeContext?: boolean;
  consentRadiusM?: number;
}

/**
 * Builds the parcel land passport. Masking is applied according to the caller's
 * role policy, and every section carries its own provenance block so a reader
 * can always tell where a value came from and whether it is real or demonstration.
 */
export async function buildPassport(parcelId: string, opts: PassportOptions) {
  const policy = maskingFor(opts.role);
  const intel = await buildIntelligence(parcelId, { sourceAvailabilityRatio: await availabilityRatio() });
  if (!intel) return null;

  const rs = intel.recordSet;
  const timeline = await buildTimeline(parcelId, { includeInternal: policy.includeInternalNotes });

  const parcelRes = await rawPool.query(`SELECT * FROM parcels WHERE parcel_id = $1`, [parcelId]);
  const parcel = parcelRes.rows[0];

  const [identifiers, documents, zoning, landUse, planning, changeDetections, judiciaryEvents, cases] =
    await Promise.all([
      rawPool.query(`SELECT * FROM parcel_identifiers WHERE parcel_id = $1 ORDER BY is_primary DESC`, [parcelId]),
      rawPool.query(`SELECT * FROM documents WHERE parcel_id = $1 ORDER BY issue_date DESC NULLS LAST`, [parcelId]),
      rawPool.query(`SELECT * FROM zoning WHERE parcel_id = $1`, [parcelId]),
      rawPool.query(`SELECT * FROM land_use WHERE parcel_id = $1`, [parcelId]),
      rawPool.query(`SELECT * FROM planning_records WHERE parcel_id = $1`, [parcelId]),
      rawPool.query(`SELECT * FROM change_detections WHERE parcel_id = $1 ORDER BY created_at DESC`, [parcelId]),
      rawPool.query(
        `SELECT je.* FROM judiciary_events je
         JOIN judiciary_cases jc ON jc.judiciary_case_id = je.judiciary_case_id
         WHERE jc.parcel_id = $1 ORDER BY je.event_date DESC`,
        [parcelId],
      ),
      rawPool.query(
        `SELECT case_id, case_number, title, status, priority, assigned_role, assigned_department,
                created_at, updated_at, due_date
         FROM verification_cases WHERE parcel_id = $1 ORDER BY created_at DESC`,
        [parcelId],
      ),
    ]);

  const partyName = (n: string | null | undefined) =>
    !n ? null : policy.maskPartyNames ? maskPersonName(n) : n;

  /* --- sections ------------------------------------------------------- */

  const identity = {
    parcelId: parcel.parcel_id,
    displayId: parcel.display_id,
    displayIdLocalisedNote:
      'Synthetic demonstration identifier in a ULPIN-compatible format. This is NOT an official ULPIN value.',
    surveyNumber: parcel.survey_number,
    subdivisionNumber: parcel.subdivision_number,
    status: parcel.status,
    classification: parcel.classification,
    identifiers: identifiers.rows.map((i) => ({
      scheme: i.scheme,
      value: i.value,
      isPrimary: i.is_primary,
      isOfficial: i.is_official,
      note: i.note,
      provenance: provenanceFor(parcel.source_id, parcel.data_status, parcel.created_at, {
        note: 'Demonstration identifier scheme.',
      }),
    })),
    provenance: provenanceFor('CADASTRE_DEMO', 'DEMONSTRATION', parcel.created_at, {
      note: DEMO_NOTICE,
    }),
  };

  const location = {
    state: parcel.state,
    district: parcel.district,
    taluk: parcel.taluk,
    block: parcel.block,
    village: parcel.village,
    localBody: parcel.local_body,
    localBodyType: parcel.local_body_type,
    latitude: Number(parcel.latitude),
    longitude: Number(parcel.longitude),
    provenance: provenanceFor('CADASTRE_DEMO', 'DEMONSTRATION', parcel.created_at),
  };

  const geometry = rs.geometry
    ? {
        geometryId: rs.geometry.geometry_id,
        geometry: rs.geometry.geometry,
        geometryType: rs.geometry.geometry_type,
        centroid: rs.geometry.centroid,
        srid: 4326,
        areaSqm: Number(rs.geometry.area_sqm),
        isValid: rs.geometry.is_valid,
        validityNote: rs.geometry.validity_note,
        provenance: provenanceFor(rs.geometry.source_id, rs.geometry.data_status, null, {
          note: 'Planar area derived from the demonstration polygon. No cadastral survey was performed.',
        }),
      }
    : null;

  const cadastral = rs.revenueRecords.find((r) => r.record_type === 'CADASTRAL');
  const ror = rs.rorRecords[0];
  const area = {
    cadastralAreaSqft: cadastral ? Number(cadastral.recorded_area_sqft) : null,
    geometryAreaSqft: rs.geometry ? Math.round(Number(rs.geometry.area_sqm) * 10.7639 * 100) / 100 : null,
    rorAssertedAreaSqft: ror ? Number(ror.asserted_area_sqft) : null,
    provenance: provenanceFor(cadastral?.source_id ?? null, cadastral?.data_status ?? 'DEMONSTRATION', recordedAtIso(cadastral?.recorded_at)),
  };

  const ownershipParties = [
    ...rs.rorRecords.map((r) => ({
      name: r.owner_name,
      role: 'Record of Rights holder',
      share: '1/1 (as asserted)',
      area: r.asserted_area_sqft === null ? null : Number(r.asserted_area_sqft),
      provenance: provenanceFor(r.source_id, r.data_status, recordedAtIso(r.recorded_at), {
        confidence: r.confidence === null ? null : Number(r.confidence),
      }),
    })),
    ...rs.deeds
      .filter((d) => d.transferee_name)
      .map((d) => ({
        name: d.transferee_name,
        role: `Transferee (${d.deed_type})`,
        share: '1/1 (as registered)',
        area: d.area_transferred_sqft === null ? null : Number(d.area_transferred_sqft),
        provenance: provenanceFor(d.source_id, d.data_status, recordedAtIso(d.execution_date), {
          note: `Registered instrument ${d.registration_id}.`,
        }),
      })),
    ...rs.taxRecords
      .filter((t) => t.owner_name)
      .map((t) => ({
        name: t.owner_name,
        role: 'Municipal assessment name',
        share: 'Not applicable',
        area: null,
        provenance: provenanceFor(t.source_id, t.data_status, t.recorded_at as string, {
          note: 'The assessment name is an administrative attribution, not a title determination.',
        }),
      })),
  ];

  const ownership = {
    parties: ownershipParties.map((o) => ({
      name: partyName(o.name),
      masked: policy.maskPartyNames,
      role: o.role,
      share: o.share,
      assertedAreaSqft: o.area,
      provenance: o.provenance,
    })),
    currentRecordedHolder: partyName(ror?.owner_name ?? null),
    latestDeedTransferee: partyName(rs.deeds[0]?.transferee_name ?? null),
    agreement: intel.findings.some((f) => f.ruleCode === 'OWNERSHIP_MISMATCH')
      ? 'Records require reconciliation — the RoR holder and the latest registered transferee differ.'
      : 'Recorded holder and registration records are consistent in the available dataset.',
  };

  const rorSection = rs.rorRecords.map((r) => ({
    rorId: r.ror_id,
    recordNumber: r.record_number,
    ownerName: partyName(r.owner_name),
    assertedAreaSqft: Number(r.asserted_area_sqft),
    landClassification: r.land_classification,
    pattaNumber: r.patta_number,
    issuingOffice: r.issuing_office,
    recordedAt: r.recorded_at,
    confidence: r.confidence === null ? null : Number(r.confidence),
    provenance: provenanceFor(r.source_id, r.data_status, recordedAtIso(r.recorded_at), {
      confidence: r.confidence === null ? null : Number(r.confidence),
    }),
  }));

  const registration = {
    transactions: rs.registrations.map((r) => {
      const deed = rs.deeds.find((d) => d.registration_id === r.registration_id);
      return {
        registrationId: r.registration_id,
        documentNumber: r.document_number,
        documentType: r.document_type,
        registrationDate: r.registration_date,
        office: r.registration_office,
        consideration: r.consideration_amount === null ? null : Number(r.consideration_amount),
        status: r.status,
        transferor: partyName(deed?.transferor_name ?? null),
        transferee: partyName(deed?.transferee_name ?? null),
        areaTransferredSqft: deed?.area_transferred_sqft === null || deed?.area_transferred_sqft === undefined
          ? null
          : Number(deed.area_transferred_sqft),
        provenance: provenanceFor(r.source_id, r.data_status, recordedAtIso(r.recorded_at)),
      };
    }),
  };

  const encumbrance = {
    items: rs.encumbrances.map((e) => ({
      encumbranceId: e.encumbrance_id,
      type: e.encumbrance_type,
      holder: partyName(e.holder_name),
      amount: policy.maskAmounts ? maskAmount(e.amount) : e.amount === null ? null : Number(e.amount),
      masked: policy.maskAmounts,
      startDate: e.start_date,
      endDate: e.end_date,
      isActive: e.is_active,
      nocStatus: e.noc_status,
      provenance: provenanceFor(e.source_id, e.data_status, recordedAtIso(e.recorded_at)),
    })),
    mortgages: rs.mortgages.map((m) => ({
      mortgageId: m.mortgage_id,
      lender: partyName(m.lender_name),
      borrower: partyName(m.borrower_name),
      amount: policy.maskAmounts ? maskAmount(m.mortgage_amount) : m.mortgage_amount === null ? null : Number(m.mortgage_amount),
      mortgageDate: m.mortgage_date,
      closureDate: m.closure_date,
      status: m.status,
      provenance: provenanceFor(m.source_id, m.data_status, null),
    })),
  };

  const tax = {
    records: rs.taxRecords.map((t) => ({
      taxRecordId: t.tax_record_id,
      authorityType: t.authority_type,
      assessmentNumber: policy.maskAssessmentNumbers ? maskAssessmentNumber(t.assessment_number) : t.assessment_number,
      taxPeriod: t.tax_period,
      demand: policy.maskAmounts ? maskAmount(t.demand_amount) : Number(t.demand_amount),
      paid: policy.maskAmounts ? maskAmount(t.paid_amount) : Number(t.paid_amount),
      due: policy.maskAmounts ? maskAmount(t.due_amount) : Number(t.due_amount),
      masked: policy.maskAmounts,
      ownerName: partyName(t.owner_name),
      lastPaymentDate: t.last_payment_date,
      provenance: provenanceFor(t.source_id, t.data_status, recordedAtIso(t.recorded_at)),
    })),
  };

  const planningSection = {
    masterPlanRefs: planning.rows,
    zoning: zoning.rows.map((z) => ({
      zoneCode: z.zone_code,
      zoneName: z.zone_name,
      permittedUse: z.permitted_use,
      farLimit: z.far_limit === null ? null : Number(z.far_limit),
      authority: z.authority,
      provenance: provenanceFor(z.source_id, z.data_status, recordedAtIso(z.recorded_at)),
    })),
    landUse: landUse.rows.map((l) => ({
      useCode: l.use_code,
      useDescription: l.use_description,
      isContextual: l.is_contextual,
      provenance: provenanceFor(l.source_id, l.data_status, recordedAtIso(l.recorded_at), {
        note: 'Land use is contextual; it is not a legal parcel attribute in this dataset.',
      }),
    })),
  };

  const building = {
    permissions: rs.buildingPermissions.map((p) => ({
      permissionId: p.building_permission_id,
      permissionNumber: p.permission_number,
      approvalDate: p.approval_date,
      buildingUse: p.building_use,
      floorCount: p.floor_count,
      status: p.status,
      authority: p.authority,
      provenance: provenanceFor(p.source_id, p.data_status, recordedAtIso(p.recorded_at)),
    })),
    coverageGapNote:
      rs.buildingPermissions.length === 0
        ? 'No building approval record is linked to this parcel in the available dataset. This is a data coverage gap and does not establish that any construction is unauthorised.'
        : null,
  };

  const judiciary = {
    cases: rs.judiciaryCases.map((c) => ({
      caseNumber: c.case_number,
      court: c.court,
      caseType: c.case_type,
      status: c.status,
      nextHearing: c.next_hearing,
      provenance: provenanceFor(c.source_id, c.data_status, null, {
        note: 'Demonstration judiciary record. This is NOT a live court record.',
      }),
    })),
    events: judiciaryEvents.rows.map((e) => ({
      eventDate: e.event_date,
      eventType: e.event_type,
      description: e.description,
    })),
    disclaimer:
      'Judiciary information in this deployment is a demonstration fixture. It is not sourced from a live court system and must not be relied on as a court record.',
  };

  const satellite = {
    observations: rs.observations.map((o) => ({
      observationId: o.observation_id,
      sensor: o.sensor,
      captureDate: o.capture_date,
      cloudCoverage: o.cloud_coverage === null ? null : Number(o.cloud_coverage),
      changeScore: o.change_score === null ? null : Number(o.change_score),
      possibleChange: o.possible_change,
      confidence: o.confidence === null ? null : Number(o.confidence),
      processingNote: o.processing_note,
      provenance: provenanceFor(o.source_id, o.data_status, recordedAtIso(o.capture_date), {
        confidence: o.confidence === null ? null : Number(o.confidence),
        note: 'Demonstration change-detection result. No satellite processing was performed for this record.',
      }),
    })),
    changeDetections: changeDetections.rows.map((c) => ({
      changeType: c.change_type,
      changeScore: c.change_score === null ? null : Number(c.change_score),
      possibleChange: c.possible_change,
      confidence: c.confidence === null ? null : Number(c.confidence),
      description: c.description,
      dataStatus: c.data_status,
    })),
    processingState: {
      model: 'Demonstration fixture (deterministic)',
      operatorReady: true,
      note: 'The service interface accepts a real Sentinel-2 based model without changing consumers.',
      copernicusConfigured: copernicusAdapter.isConfigured(),
    },
  };

  const documentsSection = documents.rows
    .filter((d) => policy.includePrivateDocuments || d.is_public)
    .map((d) => ({
      documentId: d.document_id,
      documentType: d.document_type,
      title: d.title,
      issuedBy: d.issued_by,
      issueDate: d.issue_date,
      status: d.status,
      isPublic: d.is_public,
      mimeType: d.mime_type,
      contentHash: d.content_hash,
      restricted: !d.is_public,
      provenance: provenanceFor(d.source_id, d.data_status, recordedAtIso(d.created_at), {
        note: 'Document metadata record. No file content is stored in this deployment.',
      }),
    }));

  const context = opts.includeContext
    ? await fetchOverpassContext(
        parcelId,
        Number(parcel.latitude),
        Number(parcel.longitude),
        opts.consentRadiusM ?? 600,
      )
    : null;

  const sourcesUsed = new Map<string, Provenance>();
  const addSource = (p: Provenance) => {
    if (p.sourceId) sourcesUsed.set(p.sourceId, p);
  };
  [identity.provenance, location.provenance, area.provenance, ...rorSection.map((r) => r.provenance)].forEach(addSource);
  [...registration.transactions, ...encumbrance.items, ...tax.records, ...building.permissions, ...judiciary.cases, ...satellite.observations, ...documentsSection].forEach((r) =>
    addSource(r.provenance),
  );

  const realCount = [...sourcesUsed.values()].filter((p) => p.dataStatus === 'REAL').length;
  const demoCount = [...sourcesUsed.values()].filter((p) => p.dataStatus === 'DEMONSTRATION').length;

  const passport = {
    header: {
      product: 'BHUMISETU',
      productFullName: 'BHUMISETU — Integrated GIS Land Stack & Parcel Intelligence Platform',
      tagline: 'One Parcel. One Digital Identity. Every Record. Every Change.',
      generatedAt: new Date().toISOString(),
      requestedByRole: opts.role,
      dataMode: realCount > 0 && demoCount > 0 ? 'MIXED' : demoCount > 0 ? 'DEMONSTRATION' : 'REAL DATA',
      disclaimer:
        'This report is a digital information and verification-support view. It does not by itself constitute a legal determination, title certificate, ownership certificate, or government record.',
      datasetNotice: DEMO_NOTICE,
    },
    executiveSummary: {
      parcelId: parcel.parcel_id,
      displayId: parcel.display_id,
      village: parcel.village,
      district: parcel.district,
      areaSqft: parcel.area_sqft === null ? null : Number(parcel.area_sqft),
      riskBand: intel.score.band,
      score: intel.score.score,
      findingCount: intel.findings.length,
      verificationStatus: cases.rows[0]?.status ?? 'NO CASE',
      openCases: cases.rows.filter((c) => c.status !== 'RESOLVED').length,
      linkage: intel.linkage,
      dataQualityScore: intel.quality.score,
      sourceHealth: `${[...sourcesUsed.values()].length} source(s) referenced`,
      lastUpdated: parcel.updated_at,
      maskedForRole: opts.role === 'CITIZEN',
    },
    identity,
    location,
    geometry,
    area,
    ownership,
    ror: rorSection,
    registration,
    encumbrance,
    tax,
    planning: planningSection,
    // The passport exposes land use and zoning both under `planning` (where the
    // master-plan context lives) and at the top level, because the documented
    // passport sections list them independently.
    landUse: planningSection.landUse,
    zoning: planningSection.zoning,
    building,
    judiciary,
    documents: documentsSection,
    satellite,
    findings: intel.findings,
    evidence: intel.evidence,
    score: intel.score,
    quality: intel.quality,
    linkage: { state: intel.linkage, reason: intel.linkageReason },
    verification: {
      cases: cases.rows,
      availableTransitions: await availableTransitions(cases.rows),
    },
    timeline,
    sources: [...sourcesUsed.values()],
    spatialContext: context,
    maskingPolicy: policy,
  };

  if (!policy.maskPartyNames) return passport;

  const names = [
    ...rs.rorRecords.map((r) => r.owner_name),
    ...rs.deeds.flatMap((d) => [d.transferor_name, d.transferee_name]),
    ...rs.mortgages.flatMap((m) => [m.lender_name, m.borrower_name]),
    ...rs.taxRecords.map((t) => t.owner_name),
  ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

  return scrubPartyNames(passport, names);
}

async function availableTransitions(cases: { status: string }[]) {
  const { allowedCaseTransitions } = await import('./workflow.js');
  const out: Record<string, string[]> = {};
  for (const c of cases) {
    out[c.status] = await allowedCaseTransitions(c.status as never);
  }
  return out;
}

export async function availabilityRatio(): Promise<number> {
  const res = await rawPool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('CONNECTED','AVAILABLE','ADAPTER_READY'))::int AS healthy
     FROM data_sources WHERE is_demonstration = false`,
  );
  const total = Number(res.rows[0]?.total ?? 0);
  if (total === 0) return 0;
  return Number(res.rows[0]?.healthy ?? 0) / total;
}

/* -------------------------------------------------------------------------- */
/* Unified search                                                             */
/* -------------------------------------------------------------------------- */

export interface SearchHit {
  parcelId: string;
  displayId: string;
  village: string;
  district: string;
  taluk: string | null;
  areaSqft: number | null;
  latitude: number;
  longitude: number;
  matchType: string;
  confidence: number;
  riskBand: string;
  score: number;
  findingCount: number;
  findingCodes: string[];
  linkage: string;
  dataStatus: string;
}

export interface ParsedQuery {
  freeText: string;
  district: string | null;
  village: string | null;
  owner: string | null;
  finding: string | null;
  riskBand: string | null;
}

const DISTRICTS = ['chennai', 'chengalpattu', 'kanchipuram', 'tiruvallur', 'madurai', 'coimbatore'];
const RULE_WORDS: Record<string, string> = {
  'ownership mismatch': 'OWNERSHIP_MISMATCH',
  'ownership': 'OWNERSHIP_MISMATCH',
  'ror': 'OWNERSHIP_MISMATCH',
  'area mismatch': 'AREA_MISMATCH',
  'area': 'AREA_MISMATCH',
  'tax': 'TAX_MISMATCH',
  'encumbrance': 'ENCUMBRANCE_RISK',
  'mortgage': 'ENCUMBRANCE_RISK',
  'building': 'BUILDING_UNAPPROVED_CHANGE',
  'construction': 'BUILDING_UNAPPROVED_CHANGE',
  'unlinked': 'NOT_LINKED',
  'not linked': 'NOT_LINKED',
};

export function parseQuery(raw: string): ParsedQuery {
  const lower = raw.toLowerCase().trim();
  let finding: string | null = null;
  for (const [word, code] of Object.entries(RULE_WORDS)) {
    if (lower.includes(word)) {
      finding = code;
      break;
    }
  }
  const district = DISTRICTS.find((d) => lower.includes(d)) ?? null;

  // Owner names are only extracted from an explicit marker followed by a
  // capitalised name, and never from text that is itself a rule phrase such as
  // "ownership mismatch".
  const ownerMatch = raw.match(
    /(?:owner|belonging to|holder|patta\s+(?:holder|name))\s*[:\-]?\s*((?:[A-Z]\.?\s*)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z.]+){0,3})/,
  );
  const ownerCandidate = ownerMatch?.[1]?.trim() ?? null;
  const owner =
    ownerCandidate && !/mismatch|discrepancy|records?|parcel/i.test(ownerCandidate) && ownerCandidate.length >= 2
      ? ownerCandidate
      : null;

  const riskBand = /\bhigh[\s-]*risk\b/i.test(raw)
    ? 'HIGH RISK'
    : /\bverified\b/i.test(raw)
      ? 'VERIFIED'
      : /\breview\b/i.test(raw)
        ? 'REVIEW'
        : null;

  // Strip the structured fragments so free text keeps only identifiers.
  let freeText = raw
    .replace(/\b(show|find|list|get|display|parcels?|in|with|having|where|for|me|all)\b/gi, ' ')
    .replace(/\bhigh[\s-]*risk\b|\bverified\b|\breview\b/gi, ' ');
  if (district) freeText = freeText.replace(new RegExp(district, 'gi'), ' ');
  if (finding) {
    for (const w of Object.keys(RULE_WORDS)) freeText = freeText.replace(new RegExp(w, 'gi'), ' ');
  }
  if (ownerMatch) freeText = freeText.replace(ownerMatch[0], ' ');
  freeText = freeText.replace(/[^\w/.\-]+/g, ' ').trim();

  return {
    freeText,
    district: district ? district.charAt(0).toUpperCase() + district.slice(1) : null,
    village: null,
    owner,
    finding,
    riskBand,
  };
}

export async function unifiedSearch(
  query: string,
  opts: { limit: number; role: string },
): Promise<{ parsed: ParsedQuery; hits: SearchHit[]; fallbackUsed: boolean; note: string }> {
  const parsed = parseQuery(query);
  const candidateIds = new Set<string>();

  if (parsed.freeText) {
    for (const id of await findByAnyIdentifier(parsed.freeText)) candidateIds.add(id);
  }

  const like = `%${(parsed.freeText || query).toLowerCase()}%`;
  const fuzzy = await rawPool.query<{ parcel_id: string }>(
    `SELECT p.parcel_id FROM parcels p WHERE
       lower(p.parcel_id) LIKE $1 OR lower(p.display_id) LIKE $1 OR
       lower(coalesce(p.survey_number,'')) LIKE $1 OR lower(p.village) LIKE $1 OR
       lower(p.district) LIKE $1 OR lower(coalesce(p.taluk,'')) LIKE $1
     UNION
     SELECT r.parcel_id FROM ror_records r WHERE lower(coalesce(r.owner_name,'')) LIKE $1
     UNION
     SELECT t.parcel_id FROM tax_records t WHERE lower(coalesce(t.owner_name,'')) LIKE $1
     UNION
     SELECT d.parcel_id FROM deeds d WHERE lower(coalesce(d.transferee_name,'')) LIKE $1
       OR lower(coalesce(d.transferor_name,'')) LIKE $1
     UNION
     SELECT p.parcel_id FROM parcels p WHERE lower(p.local_body) LIKE $1
     LIMIT 100`,
    [like],
  );
  for (const r of fuzzy.rows) candidateIds.add(String(r.parcel_id));

  let ids = [...candidateIds];

  // Only a structured-only query (a district/owner/finding/risk filter with no
  // free text) may fall back to the full set. An unmatched free-text query must
  // return nothing: silently returning every parcel would present unrelated
  // parcels as if they had matched the term.
  const structuredOnly =
    !parsed.freeText && Boolean(parsed.district || parsed.owner || parsed.finding || parsed.riskBand);
  if (ids.length === 0 && structuredOnly) {
    ids = (
      await rawPool.query<{ parcel_id: string }>(`SELECT parcel_id FROM parcels LIMIT 100`)
    ).rows.map((r) => String(r.parcel_id));
  }

  const sets = await loadRecordSets(ids);
  const hits: SearchHit[] = [];

  for (const rs of sets) {
    if (parsed.district && rs.parcel.district.toLowerCase() !== parsed.district.toLowerCase()) continue;
    const findings = evaluateParcel(rs);
    const score = computeScore(rs.parcel.parcel_id, findings, rs);
    if (parsed.finding && !findings.some((f) => f.ruleCode === parsed.finding)) continue;
    if (parsed.riskBand && score.band !== parsed.riskBand) continue;

    if (parsed.owner) {
      const ownerLower = parsed.owner.toLowerCase();
      const matchesOwner =
        rs.rorRecords.some((r) => (r.owner_name ?? '').toLowerCase().includes(ownerLower)) ||
        rs.deeds.some(
          (d) =>
            (d.transferee_name ?? '').toLowerCase().includes(ownerLower) ||
            (d.transferor_name ?? '').toLowerCase().includes(ownerLower),
        );
      if (!matchesOwner) continue;
    }

    const term = (parsed.freeText || '').toLowerCase();
    if (term && !structuredOnly) {
      const identity = [
        rs.parcel.parcel_id,
        rs.parcel.display_id,
        rs.parcel.survey_number ?? '',
        rs.parcel.subdivision_number ?? '',
        rs.parcel.village,
        rs.parcel.district,
        rs.parcel.taluk ?? '',
        rs.parcel.local_body ?? '',
        ...rs.rorRecords.map((r) => r.owner_name ?? ''),
        ...rs.taxRecords.map((t) => t.owner_name ?? ''),
        ...rs.deeds.flatMap((d) => [d.transferee_name ?? '', d.transferor_name ?? '']),
      ]
        .join(' ')
        .toLowerCase();
      if (!identity.includes(term)) continue;
    }

    let matchType = 'structured-filter';
    let confidence = 0.6;
    if (term && rs.parcel.display_id.toLowerCase() === term) {
      matchType = 'displayId-exact';
      confidence = 1;
    } else if (term && rs.parcel.parcel_id.toLowerCase() === term) {
      matchType = 'parcelId-exact';
      confidence = 1;
    } else if (term && (rs.parcel.survey_number ?? '').toLowerCase() === term) {
      matchType = 'survey-exact';
      confidence = 0.98;
    } else if (parsed.owner && rs.rorRecords.some((r) => (r.owner_name ?? '').toLowerCase().includes(parsed.owner!.toLowerCase()))) {
      matchType = 'owner-match';
      confidence = 0.9;
    } else if (parsed.finding) {
      matchType = 'finding-filter';
      confidence = 0.95;
    } else if (parsed.district) {
      matchType = 'district-filter';
      confidence = 0.8;
    }

    const linkage = deriveLinkage(rs).linkage;
    hits.push({
      parcelId: rs.parcel.parcel_id,
      displayId: rs.parcel.display_id,
      village: rs.parcel.village,
      district: rs.parcel.district,
      taluk: rs.parcel.taluk,
      areaSqft: rs.parcel.area_sqft === null ? null : Number(rs.parcel.area_sqft),
      latitude: Number(rs.parcel.latitude),
      longitude: Number(rs.parcel.longitude),
      matchType,
      confidence,
      riskBand: score.band,
      score: score.score,
      findingCount: findings.length,
      findingCodes: findings.map((f) => f.ruleCode),
      linkage,
      dataStatus: rs.parcel.data_status,
    });
  }

  hits.sort((a, b) => b.confidence - a.confidence || b.findingCount - a.findingCount);
  const limited = hits.slice(0, opts.limit);

  return {
    parsed,
    hits: limited,
    fallbackUsed: true,
    note:
      'Structured search fallback in use. Results are resolved from indexed database columns and the deterministic integrity engine; no language model is required for search to function.',
  };
}
