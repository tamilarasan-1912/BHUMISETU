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
export type RiskBand = 'VERIFIED' | 'REVIEW' | 'HIGH RISK';
export type Linkage = 'LINKED' | 'PARTIALLY_LINKED' | 'UNLINKED' | 'CONFLICTING';

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
  ruleCode: string;
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
  ruleCode: string;
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

export interface ParcelSummary {
  parcelId: string;
  displayId: string;
  displayIdIsOfficial: boolean;
  surveyNumber: string | null;
  subdivisionNumber: string | null;
  district: string;
  taluk: string | null;
  village: string;
  localBody: string | null;
  areaSqft: number | null;
  areaSqm: number | null;
  latitude: number;
  longitude: number;
  status: string;
  riskBand: RiskBand;
  score: number;
  findingCount: number;
  findings: { ruleCode: string; severity: Severity; title: string }[];
  linkage: Linkage;
  linkageReason: string;
  dataStatus: DataStatus;
  provenance: Provenance;
}

export interface ParcelDetail {
  parcel: {
    parcelId: string;
    displayId: string;
    displayIdNote: string;
    surveyNumber: string | null;
    subdivisionNumber: string | null;
    state: string;
    district: string;
    taluk: string | null;
    block: string | null;
    village: string;
    localBody: string | null;
    localBodyType: string | null;
    latitude: number;
    longitude: number;
    areaSqft: number | null;
    areaSqm: number | null;
    status: string;
    classification: string;
    dataStatus: DataStatus;
    provenance: Provenance;
  };
  geometry: {
    geometry: unknown;
    centroid: unknown;
    areaSqm: number;
    areaSqft: number;
    isValid: boolean;
    validityNote: string;
  } | null;
  ownership: {
    rorHolder: string | null;
    latestTransferee: string | null;
    taxAssessmentName: string | null;
    masked: boolean;
  };
  findings: IntegrityFinding[];
  evidence: FindingEvidence[];
  score: DueDiligenceScore;
  quality: QualityScore;
  linkage: { state: Linkage; reason: string };
  records: Record<string, unknown[]>;
  maskedForRole: boolean;
  maskingPolicy: {
    maskPartyNames: boolean;
    maskAmounts: boolean;
    maskAssessmentNumbers: boolean;
    includeInternalNotes: boolean;
    includePrivateDocuments: boolean;
  };
}

export interface PassportSectionParty {
  name: string | null;
  masked: boolean;
  role: string;
  share: string;
  assertedAreaSqft: number | null;
  provenance: Provenance;
}

export interface LandPassport {
  header: {
    product: string;
    productFullName: string;
    tagline: string;
    generatedAt: string;
    requestedByRole: string;
    dataMode: 'REAL DATA' | 'DEMONSTRATION' | 'MIXED';
    disclaimer: string;
    datasetNotice: string;
  };
  executiveSummary: {
    parcelId: string;
    displayId: string;
    village: string;
    district: string;
    areaSqft: number | null;
    riskBand: RiskBand;
    score: number;
    findingCount: number;
    verificationStatus: string;
    openCases: number;
    linkage: Linkage;
    dataQualityScore: number;
    sourceHealth: string;
    lastUpdated: string;
    maskedForRole: boolean;
  };
  identity: {
    parcelId: string;
    displayId: string;
    displayIdLocalisedNote: string;
    surveyNumber: string | null;
    subdivisionNumber: string | null;
    status: string;
    classification: string;
    identifiers: { scheme: string; value: string; isPrimary: boolean; isOfficial: boolean; note: string; provenance: Provenance }[];
    provenance: Provenance;
  };
  location: Record<string, unknown>;
  geometry: {
    geometryId: string;
    geometry: unknown;
    geometryType: string;
    centroid: unknown;
    srid: number;
    areaSqm: number;
    isValid: boolean;
    validityNote: string;
    provenance: Provenance;
  } | null;
  area: {
    cadastralAreaSqft: number | null;
    geometryAreaSqft: number | null;
    rorAssertedAreaSqft: number | null;
    provenance: Provenance;
  };
  ownership: {
    parties: PassportSectionParty[];
    currentRecordedHolder: string | null;
    latestDeedTransferee: string | null;
    maskedForRole?: boolean;
    agreement: string;
  };
  ror: {
    rorId: string;
    recordNumber: string | null;
    ownerName: string | null;
    assertedAreaSqft: number;
    landClassification: string | null;
    pattaNumber: string | null;
    issuingOffice: string | null;
    recordedAt: string;
    confidence: number | null;
    provenance: Provenance;
  }[];
  registration: {
    transactions: {
      registrationId: string;
      documentNumber: string;
      documentType: string;
      registrationDate: string | null;
      office: string | null;
      consideration: number | null;
      status: string;
      transferor: string | null;
      transferee: string | null;
      areaTransferredSqft: number | null;
      provenance: Provenance;
    }[];
  };
  encumbrance: {
    items: {
      encumbranceId: string;
      type: string;
      holder: string | null;
      amount: number | string | null;
      masked: boolean;
      startDate: string | null;
      endDate: string | null;
      isActive: boolean;
      nocStatus: string | null;
      provenance: Provenance;
    }[];
    mortgages: {
      mortgageId: string;
      lender: string | null;
      borrower: string | null;
      amount: number | string | null;
      mortgageDate: string | null;
      closureDate: string | null;
      status: string;
      provenance: Provenance;
    }[];
  };
  tax: {
    records: {
      taxRecordId: string;
      authorityType: string;
      assessmentNumber: string | null;
      taxPeriod: string;
      demand: number | string;
      paid: number | string;
      due: number | string;
      masked: boolean;
      ownerName: string | null;
      lastPaymentDate: string | null;
      provenance: Provenance;
    }[];
  };
  planning: {
    masterPlanRefs: Record<string, unknown>[];
    zoning: {
      zoneCode: string;
      zoneName: string;
      permittedUse: string | null;
      farLimit: number | null;
      authority: string;
      provenance: Provenance;
    }[];
    landUse: {
      useCode: string;
      useDescription: string;
      isContextual: boolean;
      provenance: Provenance;
    }[];
  };
  building: {
    permissions: {
      permissionId: string;
      permissionNumber: string;
      approvalDate: string | null;
      buildingUse: string | null;
      floorCount: number | null;
      status: string;
      authority: string;
      provenance: Provenance;
    }[];
    coverageGapNote: string | null;
  };
  judiciary: {
    cases: {
      caseNumber: string;
      court: string;
      caseType: string;
      status: string;
      nextHearing: string | null;
      provenance: Provenance;
    }[];
    events: { eventDate: string; eventType: string; description: string }[];
    disclaimer: string;
  };
  documents: {
    documentId: string;
    documentType: string;
    title: string;
    issuedBy: string;
    issueDate: string | null;
    status: string;
    isPublic: boolean;
    mimeType: string;
    contentHash: string;
    restricted: boolean;
    provenance: Provenance;
  }[];
  satellite: {
    observations: {
      observationId: string;
      sensor: string;
      captureDate: string;
      cloudCoverage: number | null;
      changeScore: number | null;
      possibleChange: boolean;
      confidence: number | null;
      processingNote: string;
      provenance: Provenance;
    }[];
    changeDetections: {
      changeType: string;
      changeScore: number | null;
      possibleChange: boolean;
      confidence: number | null;
      description: string;
      dataStatus: DataStatus;
    }[];
    processingState: { model: string; operatorReady: boolean; note: string; copernicusConfigured: boolean };
  };
  findings: IntegrityFinding[];
  evidence: FindingEvidence[];
  score: DueDiligenceScore;
  quality: QualityScore;
  linkage: { state: Linkage; reason: string };
  verification: {
    cases: {
      case_id: string;
      case_number: string;
      title: string;
      status: CaseStatus;
      priority: string;
      assigned_role: string | null;
      assigned_department: string | null;
      created_at: string;
      updated_at: string;
      due_date: string | null;
    }[];
    availableTransitions: Record<string, string[]>;
  };
  timeline: TimelineEvent[];
  sources: Provenance[];
  spatialContext: SpatialContext | null;
  maskingPolicy: {
    maskPartyNames: boolean;
    maskAmounts: boolean;
    maskAssessmentNumbers: boolean;
    includeInternalNotes: boolean;
    includePrivateDocuments: boolean;
  };
}

export interface SpatialContext {
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
  label?: string;
  disclaimer?: string;
  attribution?: string;
}

export interface VerificationCase {
  case_id: string;
  case_number: string;
  parcel_id: string;
  title: string;
  description: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: CaseStatus;
  origin: string;
  finding_refs: string[];
  assigned_officer: string | null;
  assigned_role: string | null;
  assigned_department: string | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  closed_at: string | null;
  resolution_note: string | null;
  display_id?: string;
  district?: string;
  village?: string;
  officer_name?: string | null;
  finding_count?: number;
}

export interface CaseDetail extends VerificationCase {
  events: {
    case_event_id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    description: string;
    actor: string;
    actor_role: string;
    visibility: string;
    created_at: string;
  }[];
  comments: {
    comment_id: string;
    body: string;
    visibility: string;
    author_name: string;
    author_role: string;
    created_at: string;
  }[];
  assignments: {
    assignment_id: string;
    assigned_role: string | null;
    department: string | null;
    assignee_name: string | null;
    note: string;
    is_current: boolean;
    created_at: string;
  }[];
  findings: {
    finding_id: string;
    rule_code: string;
    severity: Severity;
    title: string;
    status: FindingStatus;
  }[];
  availableTransitions: CaseStatus[];
  maskingApplied: boolean;
}

export interface OfficerDashboard {
  scope: string;
  cards: {
    openCases: number;
    highRiskParcels: number;
    fieldVerification: number;
    escalated: number;
    dueToday: number;
    unlinkedParcels: number;
    ownershipMismatches: number;
    areaMismatches: number;
    totalParcels: number;
  };
  cases: VerificationCase[];
  caseTotal: number;
  platformCaseTotal: number;
  workload: { department: string; n: number; open: number }[];
  datasetNotice: string;
}

export interface Analytics {
  datasetLabel: string;
  datasetNotice: string;
  datasetSize: number;
  kpis: {
    totalParcels: number;
    linkedParcels: number;
    partiallyLinkedParcels: number;
    unlinkedParcels: number;
    conflictingParcels: number;
    openCases: number;
    highRiskParcels: number;
    parcelsWithFindings: number;
    integrityFindings: number;
    verificationCompletionPct: number;
    sourceHealthPct: number;
    dataFreshnessDays: number | null;
    averageQualityScore: number;
  };
  distributions: {
    findingsByRule: { ruleCode: string; count: number }[];
    riskByBand: { band: string; count: number }[];
    casesByStatus: { status: string; count: number }[];
    casesByDepartment: { department: string; count: number }[];
    coverageByDistrict: { district: string; parcels: number; villages: number }[];
    findingsBySeverity: { severity: string; count: number }[];
  };
  trend: { month: string; parcels: number; registrations: number; cases: number }[];
  sources: {
    sourceId: string;
    name: string;
    organization: string;
    status: string;
    category: string;
    isAuthoritative: boolean;
    isDemonstration: boolean;
    lastSuccessAt: string | null;
    latencyMs: number | null;
  }[];
  quality: QualityScore & { sampleSize: number };
  computedAt: string;
}

export interface DataSourceEntry {
  sourceId: string;
  name: string;
  organization: string;
  category: string;
  url: string;
  authority: string;
  status: SourceStatus;
  capability: string[];
  coverage: string;
  licenceNote: string;
  isAuthoritative: boolean;
  isContextual: boolean;
  isDerived: boolean;
  isDemonstration: boolean;
  isEnabled: boolean;
  dataStatus: DataStatus;
  freshnessNote: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  endpoint: string | null;
}

export interface AdapterHealth {
  sourceId: string;
  status: SourceStatus;
  reachable: boolean;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  requiresAuth: boolean;
  configured: boolean;
}

export interface GatewayDepartment {
  department: string;
  adapter: {
    sourceId: string;
    status: SourceStatus;
    detail: string;
    latencyMs: number | null;
    configured: boolean;
    requiresAuth: boolean;
  };
  lastSync: string | null;
  syncOperations: number;
  syncFailures: number;
  recordsAvailable: number;
  openCases: number;
  serviceRequests: number;
  covereageNote: string;
}

export interface GeojsonFeature {
  type: 'Feature';
  id?: string;
  properties: {
    parcelId: string;
    displayId: string;
    displayIdIsOfficial?: boolean;
    surveyNumber: string | null;
    village?: string;
    district?: string;
    areaSqft: number | null;
    risk: RiskBand;
    status?: string;
    findingCount: number;
    findingCodes?: string[];
    dataStatus: DataStatus;
    isDemonstration?: boolean;
  };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface GeojsonCollection {
  type: 'FeatureCollection';
  features: GeojsonFeature[];
  metadata: Record<string, unknown>;
}

export interface LayerEntry {
  layerId: string;
  name: string;
  category: string;
  sourceId: string;
  authority: string;
  serviceType: 'GEOJSON' | 'WMS' | 'WFS' | 'XYZ';
  serviceUrl: string | null;
  attribution: string;
  defaultOpacity: number;
  defaultVisible: boolean;
  dataStatus: DataStatus;
  status: SourceStatus;
  description: string;
  timestamp?: string;
}

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
  riskBand: RiskBand;
  score: number;
  findingCount: number;
  findingCodes: string[];
  linkage: Linkage;
  dataStatus: DataStatus;
}

export interface SearchResponse {
  query: string;
  parsed: {
    freeText: string;
    district: string | null;
    village: string | null;
    owner: string | null;
    finding: string | null;
    riskBand: string | null;
  };
  hits: SearchHit[];
  fallbackUsed: boolean;
  note: string;
  datasets: { parcels: string; context: string; notice: string };
}

export interface SessionUser {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  roleLabel: string;
  isOfficer: boolean;
  isAdmin: boolean;
  permissions: string[];
  district: string | null;
  department: string | null;
  sessionId: string;
}

export interface Capability {
  role: string;
  label: string;
  description: string;
  isOfficer: boolean;
  isAdmin: boolean;
  departments: string[];
  permissions: { code: string; label: string }[];
}

export interface RuleDefinitionRow {
  rule_code: string;
  title: string;
  description: string;
  severity: Severity;
  deduction: number;
  recommended_action: string;
  routed_authority: string;
  is_enabled: boolean;
  parameters: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export interface AuditEntry {
  audit_id: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_value: unknown;
  after_value: unknown;
  source: string;
  reason: string;
  request_id: string | null;
  parcel_id: string | null;
}

export interface ServiceRequest {
  request_id: string;
  reference_number: string;
  parcel_id: string | null;
  request_type: string;
  subject: string;
  description: string;
  status: ServiceStatus;
  channel: string;
  requester_name_masked: string | null;
  assigned_department: string | null;
  linked_case_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  notification_id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AppMeta {
  product: string;
  productFullName: string;
  tagline: string;
  version: string;
  dataMode: 'MIXED';
  datasetNotice: string;
  algorithm: { id: string; label: string; official: boolean; note: string };
}

export interface Envelope<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
