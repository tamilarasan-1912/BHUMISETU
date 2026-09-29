import type {
  DataStatus,
  DueDiligenceScore,
  FindingEvidence,
  IntegrityFinding,
  Linkage,
  RuleCode,
  ScoreDeduction,
  Severity,
} from '../types/domain.js';
import { RULE_BY_CODE, SCORE_ADJUSTMENTS, bandFor } from './rules.js';

/* -------------------------------------------------------------------------- */
/* Record-set shapes                                                          */
/* -------------------------------------------------------------------------- */

export interface ParcelRow {
  parcel_id: string;
  display_id: string;
  survey_number: string | null;
  subdivision_number: string | null;
  state: string;
  district: string;
  taluk: string | null;
  block: string | null;
  village: string;
  local_body: string | null;
  local_body_type: string | null;
  latitude: number;
  longitude: number;
  area_sqft: number | string | null;
  area_sqm: number | string | null;
  status: string;
  classification: string;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface GeometryRow {
  geometry_id: string;
  parcel_id: string;
  geometry: unknown;
  area_sqm: number | string | null;
  geometry_type: string;
  centroid: unknown;
  is_valid: boolean;
  validity_note: string;
  source_id: string | null;
  data_status: DataStatus;
}

export interface RorRow {
  ror_id: string;
  parcel_id: string;
  record_number: string | null;
  owner_name: string | null;
  asserted_area_sqft: number | string | null;
  land_classification: string | null;
  patta_number: string | null;
  issuing_office: string | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  confidence: number | string | null;
  recorded_at: string | Date;
}

export interface RevenueRow {
  revenue_record_id: string;
  parcel_id: string;
  record_type: string;
  recorded_area_sqft: number | string | null;
  classification: string | null;
  survey_number: string | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  recorded_at: string | Date;
}

export interface RegistrationRow {
  registration_id: string;
  parcel_id: string;
  document_number: string;
  registration_date: string | Date | null;
  document_type: string;
  registration_office: string | null;
  consideration_amount: number | string | null;
  stamp_duty: number | string | null;
  status: string;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  confidence: number | string | null;
  recorded_at: string | Date;
}

export interface DeedRow {
  deed_id: string;
  registration_id: string;
  parcel_id: string;
  deed_type: string;
  execution_date: string | Date | null;
  transferor_name: string | null;
  transferee_name: string | null;
  area_transferred_sqft: number | string | null;
  source_id: string | null;
  data_status: DataStatus;
}

export interface EncumbranceRow {
  encumbrance_id: string;
  parcel_id: string;
  encumbrance_type: string;
  holder_name: string | null;
  amount: number | string | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  is_active: boolean;
  noc_status: string | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  confidence: number | string | null;
  recorded_at: string | Date;
}

export interface MortgageRow {
  mortgage_id: string;
  parcel_id: string;
  lender_name: string;
  borrower_name: string | null;
  mortgage_amount: number | string | null;
  mortgage_date: string | Date | null;
  closure_date: string | Date | null;
  status: string;
  source_id: string | null;
  data_status: DataStatus;
}

export interface TaxRow {
  tax_record_id: string;
  parcel_id: string;
  authority_type: string;
  assessment_number: string | null;
  tax_period: string;
  demand_amount: number | string;
  paid_amount: number | string;
  due_amount: number | string;
  last_payment_date: string | Date | null;
  owner_name: string | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  recorded_at: string | Date;
}

export interface BuildingPermissionRow {
  building_permission_id: string;
  parcel_id: string;
  permission_number: string;
  approval_date: string | Date | null;
  building_use: string | null;
  floor_count: number | null;
  status: string;
  authority: string;
  source_id: string | null;
  data_status: DataStatus;
  recorded_at: string | Date;
}

export interface ObservationRow {
  observation_id: string;
  parcel_id: string;
  sensor: string;
  capture_date: string | Date;
  cloud_coverage: number | string | null;
  change_score: number | string | null;
  possible_change: boolean;
  confidence: number | string | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
  processing_note: string;
}

export interface JudiciaryRow {
  judiciary_case_id: string;
  parcel_id: string;
  case_number: string;
  court: string;
  case_type: string;
  status: string;
  next_hearing: string | Date | null;
  source_id: string | null;
  source_authority: string;
  data_status: DataStatus;
}

export interface ParcelRecordSet {
  parcel: ParcelRow;
  geometry: GeometryRow | null;
  rorRecords: RorRow[];
  revenueRecords: RevenueRow[];
  registrations: RegistrationRow[];
  deeds: DeedRow[];
  encumbrances: EncumbranceRow[];
  mortgages: MortgageRow[];
  taxRecords: TaxRow[];
  buildingPermissions: BuildingPermissionRow[];
  observations: ObservationRow[];
  judiciaryCases: JudiciaryRow[];
  /** Open escalated verification cases contribute to the score. */
  escalatedCases: { case_id: string; case_number: string }[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'sri', 'shri', 'smt', 'dr', 'thiru', 'selvi']);

export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
    .map((t) => (t.length === 1 ? t : t.replace(/\.$/, '')))
    .join(' ')
    .trim();
}

/**
 * Token-set comparison with single-letter initial support, so "K. Meenakshi"
 * and "Meenakshi K" match while "K. Meenakshi" and "R. Suresh" do not.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  if (ta.length !== tb.length) {
    // Allow a surname-only record to match a full name.
    const shorter = ta.length < tb.length ? ta : tb;
    const longer = ta.length < tb.length ? tb : ta;
    if (shorter.length === 1 && longer[longer.length - 1] === shorter[0]) return true;
    return false;
  }
  const remaining = [...tb];
  for (const t of ta) {
    const idx = remaining.findIndex((r) => r === t || (t.length === 1 && r.startsWith(t)));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return remaining.length === 0;
}

export function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function monthsBetween(a: Date, b: Date): number {
  return Math.abs((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

export function latestBy<T>(rows: T[], key: (r: T) => string | Date | null | undefined): T | null {
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const r of rows) {
    const raw = key(r);
    const t = raw ? new Date(raw).getTime() : -Infinity;
    if (t > bestTime) {
      bestTime = t;
      best = r;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Evidence construction                                                      */
/* -------------------------------------------------------------------------- */

interface EvidenceInput {
  parcelId: string;
  sourceId: string | null;
  sourceAuthority: string;
  recordTable: string;
  recordId: string;
  field: string;
  observedValue: string | null;
  expectedValue: string | null;
  observedAt: string | null;
  confidence: number | null;
  dataStatus: DataStatus;
  note?: string;
}

function evidence(id: string, findingId: string, input: EvidenceInput): FindingEvidence {
  return {
    evidenceId: id,
    findingId,
    parcelId: input.parcelId,
    sourceId: input.sourceId,
    source: input.sourceId ?? 'unattributed',
    sourceAuthority: input.sourceAuthority,
    recordTable: input.recordTable,
    recordId: input.recordId,
    field: input.field,
    observedValue: input.observedValue,
    expectedValue: input.expectedValue,
    observedAt: input.observedAt,
    confidence: input.confidence,
    dataStatus: input.dataStatus,
    provenance: {
      sourceId: input.sourceId,
      source: input.sourceId ?? 'unattributed',
      sourceAuthority: input.sourceAuthority,
      dataStatus: input.dataStatus,
      recordedAt: input.observedAt,
      isAuthoritative: input.dataStatus === 'REAL',
      isDerived: input.dataStatus === 'DERIVED' || input.dataStatus === 'DEMONSTRATION',
      confidence: input.confidence,
      note: input.note,
    },
  };
}

function findingIdFor(parcelId: string, ruleCode: RuleCode): string {
  return `FND-${parcelId}-${ruleCode}`;
}

/* -------------------------------------------------------------------------- */
/* Rule implementations                                                       */
/* -------------------------------------------------------------------------- */

export function deriveLinkage(rs: ParcelRecordSet): { linkage: Linkage; reason: string } {
  if (rs.rorRecords.length === 0) {
    return {
      linkage: 'UNLINKED',
      reason: 'No Record of Rights is linked to this parcel.',
    };
  }
  const rorOwner = latestBy(rs.rorRecords, (r) => r.recorded_at)?.owner_name ?? null;
  const deedOwner = latestBy(rs.deeds, (d) => d.execution_date)?.transferee_name ?? null;
  if (rorOwner && deedOwner && !namesMatch(rorOwner, deedOwner)) {
    return {
      linkage: 'CONFLICTING',
      reason: 'Linked records disagree on the holder of rights.',
    };
  }
  const linked = rs.rorRecords.length + rs.taxRecords.length + rs.registrations.length;
  if (linked >= 3) return { linkage: 'LINKED', reason: 'Revenue, registration and tax records are linked.' };
  return {
    linkage: 'PARTIALLY_LINKED',
    reason: `Only ${linked} governance record(s) are linked to this parcel.`,
  };
}

/**
 * Deterministic, explainable integrity evaluation. Findings are recomputed from
 * current records on every call; nothing here depends on previously persisted
 * findings. Persisted rows only carry lifecycle state such as acknowledgment.
 */
export function evaluateParcel(rs: ParcelRecordSet): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const { parcel } = rs;

  const latestRor = latestBy(rs.rorRecords, (r) => r.recorded_at);
  const latestDeed = latestBy(rs.deeds, (d) => d.execution_date);
  const latestTax = latestBy(rs.taxRecords, (t) => t.recorded_at);
  const cadastral = rs.revenueRecords.find((r) => r.record_type === 'CADASTRAL') ?? null;
  const geometryAreaSqft =
    toNumber(rs.geometry?.area_sqm) !== null ? sqmToSqftLocal(toNumber(rs.geometry?.area_sqm)!) : null;

  /* ---- NOT_LINKED ------------------------------------------------------- */
  if (rs.rorRecords.length === 0) {
    const rule = RULE_BY_CODE.get('NOT_LINKED')!;
    const fid = findingIdFor(parcel.parcel_id, 'NOT_LINKED');
    findings.push({
      findingId: fid,
      parcelId: parcel.parcel_id,
      ruleCode: 'NOT_LINKED',
      severity: rule.severity,
      confidence: 1,
      title: rule.title,
      description: rule.description,
      expectedValue: 'A Record of Rights linked to the parcel',
      observedValue: 'No linked RoR record',
      ruleUsed: rule.ruleCode,
      routedAuthority: rule.routedAuthority,
      recommendedAction: rule.recommendedAction,
      status: 'OPEN',
      computedAt: new Date().toISOString(),
      evidence: [
        evidence(`EV-${fid}-1`, fid, {
          parcelId: parcel.parcel_id,
          sourceId: parcel.source_id,
          sourceAuthority: parcel.source_authority,
          recordTable: 'ror_records',
          recordId: 'n/a',
          field: 'ror_records',
          observedValue: '0 rows',
          expectedValue: '>= 1 row',
          observedAt: iso(parcel_updated(parcel)),
          confidence: 1,
          dataStatus: parcel.data_status,
          note: 'Linkage assessed across revenue, registration and tax tables.',
        }),
      ],
    });
  }

  /* ---- OWNERSHIP_MISMATCH ---------------------------------------------- */
  if (latestRor?.owner_name && latestDeed?.transferee_name) {
    if (!namesMatch(latestRor.owner_name, latestDeed.transferee_name)) {
      const rule = RULE_BY_CODE.get('OWNERSHIP_MISMATCH')!;
      const fid = findingIdFor(parcel.parcel_id, 'OWNERSHIP_MISMATCH');
      // When the tax assessment agrees with the RoR, the divergence is with the
      // registration chain. When it agrees with the deed, the divergence is
      // with the revenue record. The wording states which, so the reader is not
      // left guessing which system to reconcile.
      const rorAgreesWithTax = namesMatch(latestRor.owner_name, latestTax?.owner_name);
      const deedAgreesWithTax = namesMatch(latestDeed.transferee_name, latestTax?.owner_name);
      const systems = rorAgreesWithTax
        ? 'the revenue record (RoR) and the municipal assessment record agree; the registration record differs'
        : deedAgreesWithTax
          ? 'the registration record and the municipal assessment record agree; the revenue record (RoR) differs'
          : 'the revenue, registration and municipal assessment records do not agree with one another';
      findings.push({
        findingId: fid,
        parcelId: parcel.parcel_id,
        ruleCode: 'OWNERSHIP_MISMATCH',
        severity: rule.severity,
        confidence: 0.98,
        title: rule.title,
        description: `${rule.description} In this record set ${systems}. The Record of Rights names "${latestRor.owner_name}"; the most recent registered deed transfers the parcel to "${latestDeed.transferee_name}".`,
        expectedValue: latestDeed.transferee_name,
        observedValue: latestRor.owner_name,
        ruleUsed: rule.ruleCode,
        routedAuthority: rule.routedAuthority,
        recommendedAction: rule.recommendedAction,
        status: 'OPEN',
        computedAt: new Date().toISOString(),
        evidence: [
          evidence(`EV-${fid}-1`, fid, {
            parcelId: parcel.parcel_id,
            sourceId: latestRor.source_id,
            sourceAuthority: latestRor.source_authority,
            recordTable: 'ror_records',
            recordId: latestRor.ror_id,
            field: 'owner_name',
            observedValue: latestRor.owner_name,
            expectedValue: latestDeed.transferee_name,
            observedAt: iso(latestRor.recorded_at),
            confidence: toNumber(latestRor.confidence),
            dataStatus: latestRor.data_status,
          }),
          evidence(`EV-${fid}-2`, fid, {
            parcelId: parcel.parcel_id,
            sourceId: latestDeed.source_id,
            sourceAuthority: latestRor.source_authority,
            recordTable: 'deeds',
            recordId: latestDeed.deed_id,
            field: 'transferee_name',
            observedValue: latestDeed.transferee_name,
            expectedValue: latestRor.owner_name,
            observedAt: iso(latestDeed.execution_date),
            confidence: null,
            dataStatus: latestDeed.data_status,
            note: `Deed type ${latestDeed.deed_type}; registration ${latestDeed.registration_id}.`,
          }),
        ],
      });
    }
  }

  /* ---- AREA_MISMATCH --------------------------------------------------- */
  {
    const cadastralSqft = cadastral ? toNumber(cadastral.recorded_area_sqft) : null;
    const geometrySqft = geometryAreaSqft ?? toNumber(parcel.area_sqft);
    const assertedSqft = latestRor ? toNumber(latestRor.asserted_area_sqft) : null;
    const base = cadastralSqft ?? geometrySqft;
    if (base !== null && assertedSqft !== null) {
      const rule = RULE_BY_CODE.get('AREA_MISMATCH')!;
      const toleranceSqft = Number(rule.parameters.toleranceSqft ?? 10);
      const tolerancePct = Number(rule.parameters.tolerancePercent ?? 1);
      const diff = Math.abs(assertedSqft - base);
      const pct = (diff / base) * 100;
      if (diff > toleranceSqft && pct > tolerancePct) {
        const fid = findingIdFor(parcel.parcel_id, 'AREA_MISMATCH');
        findings.push({
          findingId: fid,
          parcelId: parcel.parcel_id,
          ruleCode: 'AREA_MISMATCH',
          severity: rule.severity,
          confidence: 1,
          title: rule.title,
          description: `${rule.description} The cadastral record states ${base.toFixed(0)} sq.ft; the Record of Rights asserts ${assertedSqft.toFixed(0)} sq.ft — a difference of ${diff.toFixed(0)} sq.ft (${pct.toFixed(2)}%).`,
          expectedValue: `${base.toFixed(0)} sq.ft`,
          observedValue: `${assertedSqft.toFixed(0)} sq.ft`,
          ruleUsed: rule.ruleCode,
          routedAuthority: rule.routedAuthority,
          recommendedAction: rule.recommendedAction,
          status: 'OPEN',
          computedAt: new Date().toISOString(),
          evidence: [
            evidence(`EV-${fid}-1`, fid, {
              parcelId: parcel.parcel_id,
              sourceId: cadastral?.source_id ?? parcel.source_id,
              sourceAuthority: cadastral?.source_authority ?? parcel.source_authority,
              recordTable: 'revenue_records',
              recordId: cadastral?.revenue_record_id ?? 'geometry-derived',
              field: 'recorded_area_sqft',
              observedValue: `${base.toFixed(0)} sq.ft`,
              expectedValue: `${assertedSqft.toFixed(0)} sq.ft`,
              observedAt: iso(cadastral?.recorded_at ?? null),
              confidence: cadastral ? 1 : null,
              dataStatus: cadastral?.data_status ?? parcel.data_status,
              note: cadastral
                ? 'Cadastral area as recorded.'
                : 'Cadastral area derived from the parcel geometry.',
            }),
            evidence(`EV-${fid}-2`, fid, {
              parcelId: parcel.parcel_id,
              sourceId: latestRor?.source_id ?? null,
              sourceAuthority: latestRor?.source_authority ?? '',
              recordTable: 'ror_records',
              recordId: latestRor?.ror_id ?? 'n/a',
              field: 'asserted_area_sqft',
              observedValue: `${assertedSqft.toFixed(0)} sq.ft`,
              expectedValue: `${base.toFixed(0)} sq.ft`,
              observedAt: iso(latestRor?.recorded_at ?? null),
              confidence: toNumber(latestRor?.confidence),
              dataStatus: latestRor?.data_status ?? parcel.data_status,
              note: `Tolerance applied: > ${toleranceSqft} sq.ft and > ${tolerancePct}%.`,
            }),
          ],
        });
      }
    }
  }

  /* ---- TAX_MISMATCH ---------------------------------------------------- */
  if (latestRor?.owner_name && latestTax?.owner_name && !namesMatch(latestRor.owner_name, latestTax.owner_name)) {
    const rule = RULE_BY_CODE.get('TAX_MISMATCH')!;
    const fid = findingIdFor(parcel.parcel_id, 'TAX_MISMATCH');
    findings.push({
      findingId: fid,
      parcelId: parcel.parcel_id,
      ruleCode: 'TAX_MISMATCH',
      severity: rule.severity,
      confidence: 0.9,
      title: rule.title,
      description: `${rule.description} RoR names "${latestRor.owner_name}"; the ${latestTax.authority_type.toLowerCase()} assessment names "${latestTax.owner_name}".`,
      expectedValue: latestRor.owner_name,
      observedValue: latestTax.owner_name,
      ruleUsed: rule.ruleCode,
      routedAuthority: rule.routedAuthority,
      recommendedAction: rule.recommendedAction,
      status: 'OPEN',
      computedAt: new Date().toISOString(),
      evidence: [
        evidence(`EV-${fid}-1`, fid, {
          parcelId: parcel.parcel_id,
          sourceId: latestTax.source_id,
          sourceAuthority: latestTax.source_authority,
          recordTable: 'tax_records',
          recordId: latestTax.tax_record_id,
          field: 'owner_name',
          observedValue: latestTax.owner_name,
          expectedValue: latestRor.owner_name,
          observedAt: iso(latestTax.recorded_at),
          confidence: null,
          dataStatus: latestTax.data_status,
        }),
      ],
    });
  }

  /* ---- ENCUMBRANCE_RISK ------------------------------------------------ */
  {
    const activeEncumbrances = rs.encumbrances.filter((e) => e.is_active);
    const activeMortgages = rs.mortgages.filter((m) => m.status === 'ACTIVE');
    const rule = RULE_BY_CODE.get('ENCUMBRANCE_RISK')!;
    if (activeEncumbrances.length > 0 || activeMortgages.length > 0) {
      const recentMonths = Number(rule.parameters.recentTransferMonths ?? 24);
      const transferDate = latestDeed?.execution_date ? new Date(latestDeed.execution_date) : null;
      const recentTransfer =
        transferDate !== null && monthsBetween(transferDate, new Date()) <= recentMonths;
      const nocAbsent = rs.encumbrances.some((e) => e.noc_status === 'ABSENT');
      const dueTotal = rs.taxRecords.reduce((s, t) => s + (toNumber(t.due_amount) ?? 0), 0);
      const hasDues = dueTotal > 0;
      const pendingJudiciary = rs.judiciaryCases.filter((c) => c.status === 'PENDING').length > 0;

      const signals: string[] = [];
      if (activeEncumbrances.length > 0 || activeMortgages.length > 0) signals.push('active encumbrance');
      if (recentTransfer) signals.push('recent registered transfer');
      if (nocAbsent) signals.push('no-objection certificate absent');
      if (hasDues) signals.push('outstanding tax dues');
      if (pendingJudiciary) signals.push('pending judiciary case');

      const confidence = Math.min(0.98, 0.6 + signals.length * 0.09);
      const fid = findingIdFor(parcel.parcel_id, 'ENCUMBRANCE_RISK');
      const enc = activeEncumbrances[0];
      const mort = activeMortgages[0];
      findings.push({
        findingId: fid,
        parcelId: parcel.parcel_id,
        ruleCode: 'ENCUMBRANCE_RISK',
        severity: rule.severity,
        confidence: Math.round(confidence * 1000) / 1000,
        title: rule.title,
        description: `${rule.description} Signals present: ${signals.join(', ')}.`,
        expectedValue: 'No active encumbrance, or a cleared encumbrance with NOC',
        observedValue: signals.join(', '),
        ruleUsed: rule.ruleCode,
        routedAuthority: rule.routedAuthority,
        recommendedAction: rule.recommendedAction,
        status: 'OPEN',
        computedAt: new Date().toISOString(),
        evidence: [
          ...activeEncumbrances.map((e, i) =>
            evidence(`EV-${fid}-E${i + 1}`, fid, {
              parcelId: parcel.parcel_id,
              sourceId: e.source_id,
              sourceAuthority: e.source_authority,
              recordTable: 'encumbrances',
              recordId: e.encumbrance_id,
              field: 'is_active',
              observedValue: `${e.encumbrance_type} active${e.noc_status ? `, NOC ${e.noc_status}` : ''}`,
              expectedValue: 'Closed or NOC present',
              observedAt: iso(e.recorded_at),
              confidence: toNumber(e.confidence),
              dataStatus: e.data_status,
              note: e.holder_name ? `Holder: ${e.holder_name}` : undefined,
            }),
          ),
          ...activeMortgages.map((m, i) =>
            evidence(`EV-${fid}-M${i + 1}`, fid, {
              parcelId: parcel.parcel_id,
              sourceId: m.source_id,
              sourceAuthority: 'Demo fixture',
              recordTable: 'mortgages',
              recordId: m.mortgage_id,
              field: 'status',
              observedValue: `ACTIVE mortgage with ${m.lender_name}`,
              expectedValue: 'CLOSED',
              observedAt: iso(m.mortgage_date),
              confidence: null,
              dataStatus: m.data_status,
            }),
          ),
          ...(recentTransfer
            ? [
                evidence(`EV-${fid}-T1`, fid, {
                  parcelId: parcel.parcel_id,
                  sourceId: latestDeed?.source_id ?? null,
                  sourceAuthority: 'Demo fixture',
                  recordTable: 'deeds',
                  recordId: latestDeed?.deed_id ?? 'n/a',
                  field: 'execution_date',
                  observedValue: iso(latestDeed?.execution_date ?? null),
                  expectedValue: `Registered transfer older than ${recentMonths} months`,
                  observedAt: iso(latestDeed?.execution_date ?? null),
                  confidence: null,
                  dataStatus: latestDeed?.data_status ?? 'DEMONSTRATION',
                }),
              ]
            : []),
          ...(hasDues
            ? [
                evidence(`EV-${fid}-D1`, fid, {
                  parcelId: parcel.parcel_id,
                  sourceId: latestTax?.source_id ?? null,
                  sourceAuthority: latestTax?.source_authority ?? '',
                  recordTable: 'tax_records',
                  recordId: latestTax?.tax_record_id ?? 'n/a',
                  field: 'due_amount',
                  observedValue: `₹${dueTotal.toFixed(2)} outstanding`,
                  expectedValue: '₹0.00',
                  observedAt: iso(latestTax?.recorded_at ?? null),
                  confidence: null,
                  dataStatus: latestTax?.data_status ?? 'DEMONSTRATION',
                  note: `Tax period ${latestTax?.tax_period ?? 'n/a'}.`,
                }),
              ]
            : []),
          ...(pendingJudiciary
            ? rs.judiciaryCases
                .filter((c) => c.status === 'PENDING')
                .map((c, i) =>
                  evidence(`EV-${fid}-J${i + 1}`, fid, {
                    parcelId: parcel.parcel_id,
                    sourceId: c.source_id,
                    sourceAuthority: c.source_authority,
                    recordTable: 'judiciary_cases',
                    recordId: c.judiciary_case_id,
                    field: 'status',
                    observedValue: `PENDING — ${c.case_number} (${c.case_type})`,
                    expectedValue: 'DISPOSED',
                    observedAt: iso(c.next_hearing),
                    confidence: null,
                    dataStatus: c.data_status,
                    note: 'Demonstration judiciary record; not a live court record.',
                  }),
                )
            : []),
        ],
      });
      void enc;
      void mort;
    }
  }

  /* ---- BUILDING_UNAPPROVED_CHANGE -------------------------------------- */
  {
    const rule = RULE_BY_CODE.get('BUILDING_UNAPPROVED_CHANGE')!;
    const floor = Number(rule.parameters.changeConfidenceFloor ?? 0.7);
    const flagged = rs.observations.filter(
      (o) => o.possible_change && (toNumber(o.confidence) ?? 0) >= floor,
    );
    const approvals = rs.buildingPermissions.filter((p) => p.status === 'APPROVED');
    if (flagged.length > 0 && approvals.length === 0) {
      const obs = latestBy(flagged, (o) => o.capture_date)!;
      const fid = findingIdFor(parcel.parcel_id, 'BUILDING_UNAPPROVED_CHANGE');
      findings.push({
        findingId: fid,
        parcelId: parcel.parcel_id,
        ruleCode: 'BUILDING_UNAPPROVED_CHANGE',
        severity: rule.severity,
        confidence: toNumber(obs.confidence) ?? 0.7,
        title: rule.title,
        description: `${rule.description} Observation ${obs.observation_id} (${obs.sensor}) reports possible change with score ${toNumber(obs.change_score) ?? 'n/a'}. This is a verification prompt and does not establish that any construction is legally unauthorised.`,
        expectedValue: 'A building approval record covering the observed change',
        observedValue: `Possible change detected (confidence ${toNumber(obs.confidence) ?? 'n/a'})`,
        ruleUsed: rule.ruleCode,
        routedAuthority: rule.routedAuthority,
        recommendedAction: rule.recommendedAction,
        status: 'OPEN',
        computedAt: new Date().toISOString(),
        evidence: [
          evidence(`EV-${fid}-1`, fid, {
            parcelId: parcel.parcel_id,
            sourceId: obs.source_id,
            sourceAuthority: obs.source_authority,
            recordTable: 'satellite_observations',
            recordId: obs.observation_id,
            field: 'possible_change',
            observedValue: `true (confidence ${toNumber(obs.confidence) ?? 'n/a'}, change score ${toNumber(obs.change_score) ?? 'n/a'})`,
            expectedValue: 'false',
            observedAt: iso(obs.capture_date),
            confidence: toNumber(obs.confidence),
            dataStatus: obs.data_status,
            note: obs.processing_note,
          }),
          evidence(`EV-${fid}-2`, fid, {
            parcelId: parcel.parcel_id,
            sourceId: 'PLANNING_DEMO',
            sourceAuthority: 'Demo fixture',
            recordTable: 'building_permissions',
            recordId: 'n/a',
            field: 'status',
            observedValue: 'No building approval record linked to this parcel',
            expectedValue: 'APPROVED approval matching the observed change',
            observedAt: null,
            confidence: 1,
            dataStatus: 'DEMONSTRATION',
            note: 'Absence of a linked approval record is a data coverage gap, not proof of illegality.',
          }),
        ],
      });
    }
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function parcel_updated(p: ParcelRow): string | Date | null {
  return (p as unknown as { updated_at?: string | Date }).updated_at ?? null;
}

function severityRank(s: Severity): number {
  return s === 'HIGH' ? 0 : s === 'MEDIUM' ? 1 : 2;
}

function sqmToSqftLocal(sqm: number): number {
  return Math.round(sqm * 10.7639 * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Verification-support score                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Transparent score. Deductions are itemised so the UI can show exactly why
 * points were removed. This is an internal verification-support indicator and is
 * never presented as a legal score.
 */
export function computeScore(
  parcelId: string,
  findings: IntegrityFinding[],
  rs: ParcelRecordSet,
): DueDiligenceScore {
  const deductions: ScoreDeduction[] = [];
  const liveFindings = findings.filter((f) => f.status !== 'DISMISSED');
  const seen = new Set<string>();

  for (const f of liveFindings) {
    const rule = RULE_BY_CODE.get(f.ruleCode);
    if (!rule) continue;
    // A rule contributes at most one deduction, so duplicated findings (for
    // example the same rule evaluated twice in one pass) cannot double-penalise.
    if (seen.has(f.ruleCode)) continue;
    seen.add(f.ruleCode);
    deductions.push({
      ruleCode: f.ruleCode,
      findingId: f.findingId,
      label: rule.title,
      points: -Math.abs(rule.deduction),
      reason: `${f.ruleCode} (${f.severity}, confidence ${f.confidence})`,
    });
  }

  let score = 100 + deductions.reduce((s, d) => s + d.points, 0);

  const pendingJudiciary = rs.judiciaryCases.filter((c) => c.status === 'PENDING');
  if (pendingJudiciary.length > 0) {
    deductions.push({
      ruleCode: 'JUDICIARY',
      label: SCORE_ADJUSTMENTS.JUDICIARY.label,
      points: -Math.abs(SCORE_ADJUSTMENTS.JUDICIARY.points),
      reason: pendingJudiciary.map((c) => `${c.case_number} (${c.status})`).join(', '),
    });
    score -= SCORE_ADJUSTMENTS.JUDICIARY.points;
  }

  if (rs.escalatedCases.length > 0) {
    deductions.push({
      ruleCode: 'CASE_ESCALATION',
      label: SCORE_ADJUSTMENTS.CASE_ESCALATION.label,
      points: -Math.abs(SCORE_ADJUSTMENTS.CASE_ESCALATION.points),
      reason: rs.escalatedCases.map((c) => c.case_number).join(', '),
    });
    score -= SCORE_ADJUSTMENTS.CASE_ESCALATION.points;
  }

  // Outstanding tax dues are scored separately from the owner-name TAX_MISMATCH
  // rule so a parcel is never penalised twice for the same tax condition.
  const dueTotal = rs.taxRecords.reduce((s, t) => s + (toNumber(t.due_amount) ?? 0), 0);
  if (dueTotal > 0 && !seen.has('TAX_MISMATCH')) {
    deductions.push({
      ruleCode: 'TAX_MISMATCH',
      label: 'Outstanding property tax dues',
      points: -8,
      reason: `₹${dueTotal.toFixed(2)} outstanding`,
    });
    score -= 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const highestSeverity = liveFindings.reduce<Severity | null>((acc, f) => {
    if (!acc) return f.severity;
    return severityRank(f.severity) < severityRank(acc) ? f.severity : acc;
  }, null);

  // Band constraints: a band label is a claim about verification support, so it
  // is constrained by the findings present as well as by the numeric score.
  const constraints: string[] = [];
  let band = bandFor(score);
  if (liveFindings.length === 0) {
    if (band === 'VERIFIED') constraints.push('No open findings — VERIFIED band permitted.');
  } else {
    if (band === 'VERIFIED') {
      band = 'REVIEW';
      constraints.push(
        `${liveFindings.length} open finding(s) present — VERIFIED band withheld and capped at REVIEW.`,
      );
    }
  }
  if (highestSeverity === 'HIGH' && band === 'VERIFIED') {
    band = 'REVIEW';
    constraints.push('A HIGH severity finding is open — band capped at REVIEW.');
  }

  return {
    parcelId,
    score,
    band,
    deductions,
    basis: constraints.join(' '),
  };
}
