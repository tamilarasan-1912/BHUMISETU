import { describe, expect, it } from 'vitest';
import {
  computeScore,
  deriveLinkage,
  evaluateParcel,
  normalizeName,
  type ParcelRecordSet,
  type ParcelRow,
} from '../domain/integrity-engine.js';
import { RULES, RULE_BY_CODE, bandFor } from '../domain/rules.js';

/**
 * These tests exercise the real integrity engine against hand-built record sets.
 * Nothing is mocked: the same pure functions the API calls at read time are the
 * functions under test here.
 */

const BASE_PARCEL: ParcelRow = {
  parcel_id: 'PARC-T1',
  display_id: '3301DEMO000099',
  survey_number: '99/1',
  subdivision_number: null,
  state: 'Tamil Nadu',
  district: 'Chengalpattu',
  taluk: 'Tambaram',
  block: null,
  village: 'Test Village',
  local_body: null,
  local_body_type: null,
  latitude: 12.9,
  longitude: 80.1,
  area_sqft: 2400,
  area_sqm: 223,
  status: 'ACTIVE',
  classification: 'Patta',
  source_id: 'CADASTRE_DEMO',
  source_authority: 'BHUMISETU test fixture',
  data_status: 'DEMONSTRATION',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function recordSet(overrides: Partial<ParcelRecordSet> = {}): ParcelRecordSet {
  return {
    parcel: BASE_PARCEL,
    geometry: {
      geometry_id: 'GEO-T1',
      parcel_id: BASE_PARCEL.parcel_id,
      geometry: { type: 'Polygon', coordinates: [] },
      area_sqm: 223,
      geometry_type: 'Polygon',
      centroid: null,
      is_valid: true,
      validity_note: 'Valid polygon.',
      source_id: 'CADASTRE_DEMO',
      data_status: 'DEMONSTRATION',
    },
    rorRecords: [
      {
        ror_id: 'ROR-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        record_number: 'ROR-1',
        owner_name: 'K. Meenakshi',
        asserted_area_sqft: 2400,
        land_classification: 'Patta',
        patta_number: 'P-1',
        issuing_office: 'Taluk Office',
        source_id: 'REVENUE_DEMO',
        source_authority: 'Demo fixture',
        data_status: 'DEMONSTRATION',
        confidence: 0.98,
        recorded_at: '2026-02-01T00:00:00.000Z',
      },
    ],
    revenueRecords: [
      {
        revenue_record_id: 'REV-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        record_type: 'CADASTRAL',
        recorded_area_sqft: 2400,
        classification: 'Patta',
        survey_number: '99/1',
        source_id: 'CADASTRE_DEMO',
        source_authority: 'Demo fixture',
        data_status: 'DEMONSTRATION',
        recorded_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    registrations: [
      {
        registration_id: 'REG-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        document_number: 'DOC-1',
        registration_date: '2026-03-01T00:00:00.000Z',
        document_type: 'SALE_DEED',
        registration_office: 'SRO Tambaram',
        consideration_amount: 1000000,
        stamp_duty: 70000,
        status: 'REGISTERED',
        source_id: 'REGISTRATION_DEMO',
        source_authority: 'Demo fixture',
        data_status: 'DEMONSTRATION',
        confidence: 0.97,
        recorded_at: '2026-03-01T00:00:00.000Z',
      },
    ],
    deeds: [
      {
        deed_id: 'DEED-T1',
        registration_id: 'REG-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        deed_type: 'SALE_DEED',
        execution_date: '2026-03-01T00:00:00.000Z',
        transferor_name: 'K. Meenakshi',
        transferee_name: 'K. Meenakshi',
        area_transferred_sqft: 2400,
        source_id: 'REGISTRATION_DEMO',
        data_status: 'DEMONSTRATION',
      },
    ],
    encumbrances: [],
    mortgages: [],
    taxRecords: [
      {
        tax_record_id: 'TAX-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        authority_type: 'MUNICIPAL',
        assessment_number: 'A-1',
        tax_period: '2025-2026',
        demand_amount: 5000,
        paid_amount: 5000,
        due_amount: 0,
        last_payment_date: '2026-01-15T00:00:00.000Z',
        owner_name: 'K. Meenakshi',
        source_id: 'TAX_DEMO',
        source_authority: 'Demo fixture',
        data_status: 'DEMONSTRATION',
        recorded_at: '2026-01-15T00:00:00.000Z',
      },
    ],
    buildingPermissions: [
      {
        building_permission_id: 'BP-T1',
        parcel_id: BASE_PARCEL.parcel_id,
        permission_number: 'BP-1',
        approval_date: '2025-06-01T00:00:00.000Z',
        building_use: 'RESIDENTIAL',
        floor_count: 2,
        status: 'APPROVED',
        authority: 'Local Planning Authority',
        source_id: 'PLANNING_DEMO',
        data_status: 'DEMONSTRATION',
        recorded_at: '2025-06-01T00:00:00.000Z',
      },
    ],
    observations: [],
    judiciaryCases: [],
    escalatedCases: [],
    ...overrides,
  };
}

const ruleCodes = (rs: ParcelRecordSet) => evaluateParcel(rs).map((f) => f.ruleCode);

describe('integrity engine — clean parcel', () => {
  it('raises no findings when every compared field agrees', () => {
    expect(ruleCodes(recordSet())).toEqual([]);
  });

  it('scores a clean parcel at 100 and bands it VERIFIED', () => {
    const rs = recordSet();
    const score = computeScore(rs.parcel.parcel_id, evaluateParcel(rs), rs);
    expect(score.score).toBe(100);
    expect(score.band).toBe('VERIFIED');
    expect(score.deductions).toEqual([]);
  });

  it('derives LINKED linkage when RoR and deed agree', () => {
    expect(deriveLinkage(recordSet()).linkage).toBe('LINKED');
  });
});

describe('integrity engine — OWNERSHIP_MISMATCH', () => {
  it('fires when the RoR holder and the latest deed transferee disagree', () => {
    const rs = recordSet({
      deeds: [
        {
          deed_id: 'DEED-T2',
          registration_id: 'REG-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          deed_type: 'SALE_DEED',
          execution_date: '2026-03-01T00:00:00.000Z',
          transferor_name: 'K. Meenakshi',
          transferee_name: 'R. Suresh',
          area_transferred_sqft: 2400,
          source_id: 'REGISTRATION_DEMO',
          data_status: 'DEMONSTRATION',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'OWNERSHIP_MISMATCH');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('HIGH');
    expect(f!.confidence).toBeGreaterThan(0.9);
    expect(f!.routedAuthority).toBe('Revenue');
    expect(f!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('reports conflicting linkage and deducts 25 points', () => {
    const rs = recordSet({
      deeds: [
        {
          deed_id: 'DEED-T2',
          registration_id: 'REG-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          deed_type: 'SALE_DEED',
          execution_date: '2026-03-01T00:00:00.000Z',
          transferor_name: 'K. Meenakshi',
          transferee_name: 'R. Suresh',
          area_transferred_sqft: 2400,
          source_id: 'REGISTRATION_DEMO',
          data_status: 'DEMONSTRATION',
        },
      ],
    });
    expect(deriveLinkage(rs).linkage).toBe('CONFLICTING');
    const score = computeScore(rs.parcel.parcel_id, evaluateParcel(rs), rs);
    expect(score.score).toBe(75);
    expect(score.band).toBe('REVIEW');
    expect(score.deductions.map((d) => d.points)).toContain(-25);
  });

  it('does not fire for honorific or spacing differences in the same name', () => {
    const rs = recordSet({
      deeds: [
        {
          deed_id: 'DEED-T3',
          registration_id: 'REG-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          deed_type: 'SALE_DEED',
          execution_date: '2026-03-01T00:00:00.000Z',
          transferor_name: 'Someone Else',
          transferee_name: 'Smt. K Meenakshi',
          area_transferred_sqft: 2400,
          source_id: 'REGISTRATION_DEMO',
          data_status: 'DEMONSTRATION',
        },
      ],
    });
    expect(ruleCodes(rs)).not.toContain('OWNERSHIP_MISMATCH');
  });
});

describe('integrity engine — AREA_MISMATCH', () => {
  it('fires when cadastral area and RoR asserted area differ beyond tolerance', () => {
    const rs = recordSet({
      rorRecords: [
        {
          ror_id: 'ROR-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          record_number: 'ROR-1',
          owner_name: 'K. Meenakshi',
          asserted_area_sqft: 2435,
          land_classification: 'Patta',
          patta_number: 'P-1',
          issuing_office: 'Taluk Office',
          source_id: 'REVENUE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          confidence: 1,
          recorded_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'AREA_MISMATCH');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('MEDIUM');
    expect(f!.confidence).toBe(1);
    expect(f!.routedAuthority).toBe('Survey/GIS');
    expect(f!.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('does not fire for a difference inside the configured tolerance', () => {
    const rs = recordSet({
      rorRecords: [
        {
          ror_id: 'ROR-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          record_number: 'ROR-1',
          owner_name: 'K. Meenakshi',
          asserted_area_sqft: 2402,
          land_classification: 'Patta',
          patta_number: 'P-1',
          issuing_office: 'Taluk Office',
          source_id: 'REVENUE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          confidence: 1,
          recorded_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    expect(ruleCodes(rs)).not.toContain('AREA_MISMATCH');
  });
});

describe('integrity engine — TAX_MISMATCH', () => {
  it('fires when the assessment name differs from the RoR holder', () => {
    const rs = recordSet({
      taxRecords: [
        {
          tax_record_id: 'TAX-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          authority_type: 'MUNICIPAL',
          assessment_number: 'A-1',
          tax_period: '2025-2026',
          demand_amount: 5000,
          paid_amount: 5000,
          due_amount: 0,
          last_payment_date: '2026-01-15T00:00:00.000Z',
          owner_name: 'R. Suresh',
          source_id: 'TAX_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          recorded_at: '2026-01-15T00:00:00.000Z',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'TAX_MISMATCH');
    expect(f).toBeDefined();
    expect(f!.routedAuthority).toBe('Municipal Tax');
  });
});

describe('integrity engine — ENCUMBRANCE_RISK', () => {
  it('fires for an active mortgage plus a recent transfer with no recorded NOC', () => {
    const rs = recordSet({
      encumbrances: [
        {
          encumbrance_id: 'ENC-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          encumbrance_type: 'MORTGAGE',
          holder_name: 'Demo Bank',
          amount: 2500000,
          start_date: '2024-05-01T00:00:00.000Z',
          end_date: null,
          is_active: true,
          noc_status: null,
          source_id: 'REGISTRATION_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          confidence: 0.96,
          recorded_at: '2024-05-01T00:00:00.000Z',
        },
      ],
      deeds: [
        {
          deed_id: 'DEED-T4',
          registration_id: 'REG-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          deed_type: 'SALE_DEED',
          execution_date: '2026-04-01T00:00:00.000Z',
          transferor_name: 'K. Meenakshi',
          transferee_name: 'K. Meenakshi',
          area_transferred_sqft: 2400,
          source_id: 'REGISTRATION_DEMO',
          data_status: 'DEMONSTRATION',
        },
      ],
      taxRecords: [
        {
          tax_record_id: 'TAX-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          authority_type: 'MUNICIPAL',
          assessment_number: 'A-1',
          tax_period: '2025-2026',
          demand_amount: 5000,
          paid_amount: 1000,
          due_amount: 4000,
          last_payment_date: null,
          owner_name: 'K. Meenakshi',
          source_id: 'TAX_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          recorded_at: '2026-01-15T00:00:00.000Z',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'ENCUMBRANCE_RISK');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('HIGH');
    expect(f!.routedAuthority).toBe('Registration');
    expect(f!.description.toLowerCase()).not.toContain('fraud');
    expect(f!.description.toLowerCase()).not.toContain('illegal');
  });
});

describe('integrity engine — BUILDING_UNAPPROVED_CHANGE', () => {
  it('fires for a possible change observation with no approval record', () => {
    const rs = recordSet({
      buildingPermissions: [],
      observations: [
        {
          observation_id: 'OBS-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          sensor: 'Sentinel-2 (demonstration)',
          capture_date: '2026-05-01T00:00:00.000Z',
          cloud_coverage: 8,
          change_score: 0.78,
          possible_change: true,
          confidence: 0.91,
          source_id: 'SATELLITE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          processing_note: 'Demonstration change-detection result.',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'BUILDING_UNAPPROVED_CHANGE');
    expect(f).toBeDefined();
    expect(f!.routedAuthority).toBe('Planning');
    // The engine must never assert that construction is unlawful.
    const text = `${f!.title} ${f!.description} ${f!.recommendedAction}`.toLowerCase();
    expect(text).not.toContain('unauthorised construction');
    expect(text).not.toContain('unauthorized construction');
    expect(text).not.toContain('illegal');
    expect(text).not.toContain('demolish');
    expect(text).toMatch(/verif/);
  });

  it('does not fire when an approval record exists', () => {
    const rs = recordSet({
      observations: [
        {
          observation_id: 'OBS-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          sensor: 'Sentinel-2 (demonstration)',
          capture_date: '2026-05-01T00:00:00.000Z',
          cloud_coverage: 8,
          change_score: 0.78,
          possible_change: true,
          confidence: 0.91,
          source_id: 'SATELLITE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          processing_note: 'Demonstration change-detection result.',
        },
      ],
    });
    expect(ruleCodes(rs)).not.toContain('BUILDING_UNAPPROVED_CHANGE');
  });
});

describe('integrity engine — NOT_LINKED', () => {
  it('fires when no Record of Rights is linked', () => {
    const rs = recordSet({ rorRecords: [] });
    const findings = evaluateParcel(rs);
    const f = findings.find((x) => x.ruleCode === 'NOT_LINKED');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('LOW');
    expect(f!.routedAuthority).toBe('Revenue');
    expect(deriveLinkage(rs).linkage).toBe('UNLINKED');
  });
});

describe('integrity engine — evidence and isolation', () => {
  it('attaches evidence with a source, record and authority to every finding', () => {
    const rs = recordSet({
      rorRecords: [],
      observations: [
        {
          observation_id: 'OBS-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          sensor: 'Sentinel-2 (demonstration)',
          capture_date: '2026-05-01T00:00:00.000Z',
          cloud_coverage: 8,
          change_score: 0.78,
          possible_change: true,
          confidence: 0.91,
          source_id: 'SATELLITE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          processing_note: 'Demonstration change-detection result.',
        },
      ],
    });
    const findings = evaluateParcel(rs);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) {
        expect(e.sourceId).toBeTruthy();
        expect(e.sourceAuthority).toBeTruthy();
        expect(e.recordTable).toBeTruthy();
        expect(e.field).toBeTruthy();
        expect(e.dataStatus).toBeTruthy();
      }
    }
  });

  it('scopes every finding and its evidence to the parcel under evaluation', () => {
    const rs = recordSet({ rorRecords: [] });
    for (const f of evaluateParcel(rs)) {
      expect(f.parcelId).toBe(rs.parcel.parcel_id);
      for (const e of f.evidence) {
        expect(e.parcelId).toBe(rs.parcel.parcel_id);
      }
    }
  });

  it('uses a stable finding id derived from parcel and rule', () => {
    const rs = recordSet({ rorRecords: [] });
    const f = evaluateParcel(rs)[0];
    expect(f.findingId).toBe(`FND-${rs.parcel.parcel_id}-${f.ruleCode}`);
    // Recomputing the same record set must produce the identical identifier so
    // lifecycle state (status, assignments) survives a re-evaluation.
    const again = evaluateParcel(recordSet({ rorRecords: [] }))[0];
    expect(again.findingId).toBe(f.findingId);
  });
});

describe('due-diligence score', () => {
  it('never drops below zero and never exceeds one hundred', () => {
    const rs = recordSet({
      rorRecords: [],
      encumbrances: [
        {
          encumbrance_id: 'ENC-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          encumbrance_type: 'MORTGAGE',
          holder_name: 'Demo Bank',
          amount: 2500000,
          start_date: '2024-05-01T00:00:00.000Z',
          end_date: null,
          is_active: true,
          noc_status: null,
          source_id: 'REGISTRATION_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          confidence: 0.96,
          recorded_at: '2024-05-01T00:00:00.000Z',
        },
      ],
      observations: [
        {
          observation_id: 'OBS-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          sensor: 'Sentinel-2 (demonstration)',
          capture_date: '2026-05-01T00:00:00.000Z',
          cloud_coverage: 8,
          change_score: 0.78,
          possible_change: true,
          confidence: 0.91,
          source_id: 'SATELLITE_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
          processing_note: 'Demonstration change-detection result.',
        },
      ],
      judiciaryCases: [
        {
          judiciary_case_id: 'JUD-T1',
          parcel_id: BASE_PARCEL.parcel_id,
          case_number: 'OS-2025-114',
          court: 'Demo Civil Court',
          case_type: 'Property dispute',
          status: 'PENDING',
          next_hearing: '2026-10-12T00:00:00.000Z',
          source_id: 'ECOURTS_DEMO',
          source_authority: 'Demo fixture',
          data_status: 'DEMONSTRATION',
        },
      ],
      buildingPermissions: [],
    });
    const findings = evaluateParcel(rs);
    const score = computeScore(rs.parcel.parcel_id, findings, rs);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.band).toBe('HIGH RISK');
    // Every deduction must be explained.
    for (const d of score.deductions) {
      expect(d.label).toBeTruthy();
      expect(d.reason).toBeTruthy();
      expect(d.points).toBeLessThan(0);
    }
  });

  it('excludes dismissed findings from the score', () => {
    const rs = recordSet({ rorRecords: [] });
    const findings = evaluateParcel(rs).map((f) => ({ ...f, status: 'DISMISSED' as const }));
    const score = computeScore(rs.parcel.parcel_id, findings, rs);
    expect(score.score).toBe(100);
  });

  it('bands scores using the documented thresholds', () => {
    expect(bandFor(100)).toBe('VERIFIED');
    expect(bandFor(80)).toBe('VERIFIED');
    expect(bandFor(79)).toBe('REVIEW');
    expect(bandFor(50)).toBe('REVIEW');
    expect(bandFor(49)).toBe('HIGH RISK');
    expect(bandFor(0)).toBe('HIGH RISK');
  });

  it('takes only the first occurrence of each rule into the deduction set', () => {
    const rs = recordSet({ rorRecords: [] });
    const findings = evaluateParcel(rs);
    const duplicated = [...findings, ...findings];
    const score = computeScore(rs.parcel.parcel_id, duplicated, rs);
    const codes = score.deductions.map((d) => d.ruleCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('rule catalogue', () => {
  it('defines all six required rules with a deduction and an authority', () => {
    const required = [
      'OWNERSHIP_MISMATCH',
      'AREA_MISMATCH',
      'TAX_MISMATCH',
      'ENCUMBRANCE_RISK',
      'BUILDING_UNAPPROVED_CHANGE',
      'NOT_LINKED',
    ];
    for (const code of required) {
      const rule = RULE_BY_CODE.get(code as never);
      expect(rule, `rule ${code} must exist`).toBeDefined();
      expect(rule!.deduction).toBeGreaterThan(0);
      expect(rule!.routedAuthority).toBeTruthy();
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(rule!.severity);
    }
    expect(RULES.length).toBeGreaterThanOrEqual(6);
    expect(RULE_BY_CODE.size).toBe(RULES.length);
  });

  it('never uses accusatory language in rule descriptions or actions', () => {
    const banned = ['fraud', 'illegal', 'unlawful', 'criminal', 'fake', 'forged'];
    for (const rule of RULES) {
      const text = `${rule.title} ${rule.description} ${rule.recommendedAction}`.toLowerCase();
      for (const word of banned) {
        expect(text, `${rule.ruleCode} must not contain "${word}"`).not.toContain(word);
      }
    }
  });
});

describe('name normalisation', () => {
  it('strips honorifics, punctuation and case differences', () => {
    expect(normalizeName('Smt. K. Meenakshi')).toBe(normalizeName('k meenakshi'));
    expect(normalizeName('SRI R. SURESH')).toBe('r suresh');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});
