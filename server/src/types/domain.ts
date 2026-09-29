/**
 * Canonical domain vocabulary. These literal unions are the contract between
 * the database, the rules engine, the API schemas and the web client.
 */

/** How a piece of information came to exist. Never collapse these categories. */
export type DataStatus = 'REAL' | 'DERIVED' | 'CONTEXTUAL' | 'DEMONSTRATION' | 'AI';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type FindingStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type CaseStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'FIELD_VERIFICATION'
  | 'RESOLVED'
  | 'ESCALATED';
export type ServiceStatus =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'UNDER_REVIEW'
  | 'FIELD_VERIFICATION'
  | 'RESOLVED'
  | 'REJECTED';
export type SourceStatus =
  | 'CONNECTED'
  | 'AVAILABLE'
  | 'ADAPTER_READY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'REQUIRES_AUTH'
  | 'DEMO_DATA'
  | 'NOT_CONFIGURED';
export type Linkage = 'LINKED' | 'PARTIALLY_LINKED' | 'UNLINKED' | 'CONFLICTING';

export type RuleCode =
  | 'OWNERSHIP_MISMATCH'
  | 'AREA_MISMATCH'
  | 'TAX_MISMATCH'
  | 'ENCUMBRANCE_RISK'
  | 'BUILDING_UNAPPROVED_CHANGE'
  | 'NOT_LINKED';

export type RiskBand = 'VERIFIED' | 'REVIEW' | 'HIGH RISK';

export type RoleCode =
  | 'CITIZEN'
  | 'FIELD_OFFICER'
  | 'REVENUE_OFFICER'
  | 'REGISTRATION_OFFICER'
  | 'MUNICIPAL_OFFICER'
  | 'PLANNING_OFFICER'
  | 'JUDICIARY_VIEWER'
  | 'GIS_ADMIN'
  | 'SYSTEM_ADMIN';

export interface GeoJsonPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** Traceability envelope attached to any value surfaced in the UI. */
export interface Provenance {
  sourceId: string | null;
  source: string;
  sourceAuthority: string;
  dataStatus: DataStatus;
  recordedAt: string | null;
  retrievedAt?: string | null;
  isAuthoritative: boolean;
  isDerived?: boolean;
  confidence?: number | null;
  note?: string;
}

export interface FindingEvidence {
  evidenceId: string;
  findingId: string;
  parcelId: string;
  sourceId: string | null;
  source: string;
  sourceAuthority: string;
  recordTable: string;
  recordId: string;
  field: string;
  observedValue: string | null;
  expectedValue: string | null;
  observedAt: string | null;
  confidence: number | null;
  dataStatus: DataStatus;
  provenance: Provenance;
}

export interface IntegrityFinding {
  findingId: string;
  parcelId: string;
  ruleCode: RuleCode;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  expectedValue: string | null;
  observedValue: string | null;
  ruleUsed: string;
  routedAuthority: string;
  recommendedAction: string;
  status: FindingStatus;
  computedAt: string;
  evidence: FindingEvidence[];
}

export interface ScoreDeduction {
  ruleCode: RuleCode | 'JUDICIARY' | 'CASE_ESCALATION';
  findingId?: string;
  label: string;
  points: number;
  reason: string;
}

export interface DueDiligenceScore {
  parcelId: string;
  score: number;
  band: RiskBand;
  deductions: ScoreDeduction[];
  basis: string;
}

export interface QualityScore {
  parcelId: string | null;
  score: number;
  completeness: number;
  consistency: number;
  freshness: number;
  linkage: number;
  geometryValidity: number;
  sourceAvailability: number;
  breakdown: Record<string, string>;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  description: string;
  source: string;
  authority: string;
  actor: string;
  recordTable: string;
  recordId: string;
  dataStatus: DataStatus;
  visibility: 'PUBLIC' | 'INTERNAL';
}
