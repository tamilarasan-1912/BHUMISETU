import type { RuleCode, Severity } from '../types/domain.js';

export interface RuleDefinition {
  ruleCode: RuleCode;
  title: string;
  description: string;
  severity: Severity;
  /** Points removed from the internal verification-support score. */
  deduction: number;
  recommendedAction: string;
  routedAuthority: string;
  parameters: Record<string, number | string | boolean>;
}

/**
 * Deterministic rule catalogue. The engine reads these definitions, so an
 * administrator can retune severity/deduction/thresholds without a code change.
 * A rule firing is a *verification prompt*, never a legal conclusion.
 */
export const RULES: RuleDefinition[] = [
  {
    ruleCode: 'OWNERSHIP_MISMATCH',
    title: 'Ownership records require reconciliation',
    description:
      'The Record of Rights holder and the latest registered deed transferee disagree. Records require reconciliation between the revenue and registration systems.',
    severity: 'HIGH',
    deduction: 25,
    recommendedAction: 'Reconcile RoR, registration and ownership records.',
    routedAuthority: 'Revenue',
    parameters: { nameSimilarityFloor: 0.6 },
  },
  {
    ruleCode: 'AREA_MISMATCH',
    title: 'Area discrepancy detected',
    description:
      'The planar area of the cadastral geometry differs from the area asserted in the Record of Rights beyond the configured tolerance.',
    severity: 'MEDIUM',
    deduction: 12,
    recommendedAction: 'Re-measure and reconcile cadastral area against the RoR assertion.',
    routedAuthority: 'Survey/GIS',
    parameters: { toleranceSqft: 10, tolerancePercent: 1.0 },
  },
  {
    ruleCode: 'TAX_MISMATCH',
    title: 'Tax assessment owner differs from record owner',
    description:
      'The municipal tax assessment names a different owner than the Record of Rights. This is a possible discrepancy requiring reconciliation.',
    severity: 'MEDIUM',
    deduction: 8,
    recommendedAction: 'Reconcile the municipal assessment record with the revenue record.',
    routedAuthority: 'Municipal Tax',
    parameters: {},
  },
  {
    ruleCode: 'ENCUMBRANCE_RISK',
    title: 'High-risk encumbrance profile',
    description:
      'An active encumbrance is present on the parcel, together with one or more of: a recent transfer, missing no-objection certificate, or outstanding tax dues. Field verification is required before any transaction.',
    severity: 'HIGH',
    deduction: 30,
    recommendedAction: 'Field verification required before transfer; confirm NOC and encumbrance closure.',
    routedAuthority: 'Registration',
    parameters: { recentTransferMonths: 24 },
  },
  {
    ruleCode: 'BUILDING_UNAPPROVED_CHANGE',
    title: 'Possible building change detected; approval record requires verification',
    description:
      'A change observation indicates possible built-up change on the parcel, and no matching building approval record is present in the linked record set. The observation does not establish that any construction is legally unauthorised.',
    severity: 'MEDIUM',
    deduction: 18,
    recommendedAction: 'Verify the building approval record for the observed change.',
    routedAuthority: 'Planning',
    parameters: { changeConfidenceFloor: 0.7 },
  },
  {
    ruleCode: 'NOT_LINKED',
    title: 'Parcel is not linked to a Record of Rights',
    description:
      'The parcel has geometry and identity but no linked Record of Rights. Ownership cannot be asserted for this parcel from the available records.',
    severity: 'LOW',
    deduction: 20,
    recommendedAction: 'Establish the RoR linkage for this parcel.',
    routedAuthority: 'Revenue',
    parameters: {},
  },
];

export const RULE_BY_CODE = new Map(RULES.map((r) => [r.ruleCode, r]));

/** Additional score inputs that are not themselves rule findings. */
export const SCORE_ADJUSTMENTS = {
  JUDICIARY: { label: 'Pending judiciary case linked to parcel', points: 15 },
  CASE_ESCALATION: { label: 'Open escalated verification case', points: 10 },
} as const;

export const SCORE_BANDS = [
  { min: 80, max: 100, band: 'VERIFIED' as const },
  { min: 50, max: 79, band: 'REVIEW' as const },
  { min: 0, max: 49, band: 'HIGH RISK' as const },
];

export function bandFor(score: number) {
  return SCORE_BANDS.find((b) => score >= b.min && score <= b.max)?.band ?? 'HIGH RISK';
}
