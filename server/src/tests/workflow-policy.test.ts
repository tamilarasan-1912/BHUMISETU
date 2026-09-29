import { describe, expect, it } from 'vitest';
import { DEPARTMENT_FOR_SERVICE, SERVICE_TYPES, transitionTargets, isTransitionAllowed } from '../services/workflow.js';
import { maskingFor, roleForDepartment } from '../auth/policy.js';
import { PERMISSION_CODES, permissionsForRole, ROLES } from '../data/roles.js';
import { envelope, HttpError, parse, maskPersonName, maskAmount, maskAssessmentNumber } from '../helpers/http.js';
import { scrubPartyNames } from '../services/passport.js';
import { z } from 'zod';

/**
 * These tests cover the workflow, RBAC and masking contracts. They use the real
 * policy tables and helpers; only the database is absent, so they are pure.
 */

describe('case workflow', () => {
  // Mirrors the seeded VERIFICATION_CASE definition.
  const transitions: Record<string, string[]> = {
    SUBMITTED: ['UNDER_REVIEW', 'FIELD_VERIFICATION', 'ESCALATED', 'RESOLVED'],
    UNDER_REVIEW: ['FIELD_VERIFICATION', 'ESCALATED', 'RESOLVED'],
    FIELD_VERIFICATION: ['UNDER_REVIEW', 'ESCALATED', 'RESOLVED'],
    ESCALATED: ['UNDER_REVIEW', 'RESOLVED'],
    RESOLVED: [],
  };

  it('permits the documented forward transitions', () => {
    expect(isTransitionAllowed('SUBMITTED', 'UNDER_REVIEW', transitions)).toBe(true);
    expect(isTransitionAllowed('SUBMITTED', 'FIELD_VERIFICATION', transitions)).toBe(true);
    expect(isTransitionAllowed('UNDER_REVIEW', 'RESOLVED', transitions)).toBe(true);
    expect(isTransitionAllowed('ESCALATED', 'RESOLVED', transitions)).toBe(true);
  });

  it('treats RESOLVED as terminal', () => {
    expect(transitionTargets('RESOLVED', transitions)).toEqual([]);
    expect(isTransitionAllowed('RESOLVED', 'UNDER_REVIEW', transitions)).toBe(false);
  });

  it('does not permit a backwards transition to SUBMITTED', () => {
    expect(isTransitionAllowed('UNDER_REVIEW', 'SUBMITTED', transitions)).toBe(false);
    expect(isTransitionAllowed('FIELD_VERIFICATION', 'SUBMITTED', transitions)).toBe(false);
  });

  it('refuses every transition out of a terminal state', () => {
    for (const to of Object.keys(transitions)) {
      expect(isTransitionAllowed('RESOLVED', to, transitions)).toBe(false);
    }
  });

  it('returns an empty list for an unknown status rather than throwing', () => {
    expect(transitionTargets('NOT_A_STATUS', transitions)).toEqual([]);
    expect(isTransitionAllowed('NOT_A_STATUS', 'RESOLVED', transitions)).toBe(false);
  });

  it('never lists a status that the guard would reject', () => {
    // The advertised transitions and the guard must come from one source.
    for (const from of Object.keys(transitions)) {
      for (const to of transitionTargets(from, transitions)) {
        expect(isTransitionAllowed(from, to, transitions), `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it('offers every documented citizen service request type', () => {
    for (const t of [
      'OWNERSHIP_VERIFICATION',
      'PARCEL_CORRECTION',
      'AREA_CORRECTION',
      'DOCUMENT_UPDATE',
      'REGISTRATION_INQUIRY',
      'TAX_INQUIRY',
      'BUILDING_VERIFICATION',
      'OTHER',
    ]) {
      expect(SERVICE_TYPES, `${t} must be offered`).toContain(t as never);
    }
    expect(SERVICE_TYPES.length).toBe(8);
  });

  it('routes every service request type to a department', () => {
    for (const code of SERVICE_TYPES) {
      expect(DEPARTMENT_FOR_SERVICE[code], `${code} department`).toBeTruthy();
    }
  });

  it('routes ownership work to Revenue and survey work to Survey/GIS', () => {
    expect(DEPARTMENT_FOR_SERVICE.OWNERSHIP_VERIFICATION).toBe('Revenue');
    expect(DEPARTMENT_FOR_SERVICE.AREA_CORRECTION).toBe('Survey/GIS');
    expect(DEPARTMENT_FOR_SERVICE.TAX_INQUIRY).toBe('Municipal Tax');
    expect(DEPARTMENT_FOR_SERVICE.BUILDING_VERIFICATION).toBe('Planning');
  });
});

describe('role-based access control', () => {
  it('defines every documented role', () => {
    for (const role of [
      'CITIZEN',
      'FIELD_OFFICER',
      'REVENUE_OFFICER',
      'REGISTRATION_OFFICER',
      'MUNICIPAL_OFFICER',
      'PLANNING_OFFICER',
      'JUDICIARY_VIEWER',
      'GIS_ADMIN',
      'SYSTEM_ADMIN',
    ]) {
      expect(permissionsForRole(role).length, `${role} must be defined`).toBeGreaterThan(0);
    }
  });

  it('gives the citizen only public read and self-service permissions', () => {
    const perms = permissionsForRole('CITIZEN');
    expect(perms).toContain('parcel.read.public');
    expect(perms).toContain('service.request.create');
    expect(perms).toContain('case.create');
    expect(perms).not.toContain('parcel.read.full');
    expect(perms).not.toContain('parcel.read.internal');
    expect(perms).not.toContain('case.update');
    expect(perms).not.toContain('case.assign');
    expect(perms).not.toContain('case.comment.internal');
    expect(perms).not.toContain('audit.read');
    expect(perms).not.toContain('user.manage');
    expect(perms).not.toContain('source.configure');
  });

  it('never grants a citizen any internal or administrative permission', () => {
    const internal = permissionsForRole('CITIZEN').filter((p) =>
      /internal|\.all$|configure|manage|audit/.test(p),
    );
    expect(internal).toEqual([]);
  });

  it('gives the field officer case work but not system administration', () => {
    const perms = permissionsForRole('FIELD_OFFICER');
    expect(perms).toContain('case.update');
    expect(perms).toContain('case.field.verify');
    expect(perms).not.toContain('user.manage');
    expect(perms).not.toContain('source.configure');
  });

  it('reserves audit and configuration for administrators', () => {
    expect(permissionsForRole('SYSTEM_ADMIN')).toContain('audit.read');
    expect(permissionsForRole('SYSTEM_ADMIN')).toContain('user.manage');
    expect(permissionsForRole('GIS_ADMIN')).toContain('source.configure');
    expect(permissionsForRole('CITIZEN')).not.toContain('audit.read');
  });

  it('keeps the judiciary viewer read-only', () => {
    const perms = permissionsForRole('JUDICIARY_VIEWER');
    expect(perms).toContain('case.read.all');
    expect(perms).toContain('gateway.read');
    expect(perms).not.toContain('case.update');
    expect(perms).not.toContain('case.assign');
    expect(perms).not.toContain('parcel.read.internal');
    expect(perms).not.toContain('parcel.export.geojson');
  });

  it('marks officer roles consistently with their flags', () => {
    for (const r of ROLES) {
      if (r.isOfficer) expect(permissionsForRole(r.code), `${r.code}`).toContain('parcel.read.full');
      if (!r.isOfficer) expect(permissionsForRole(r.code), `${r.code}`).not.toContain('parcel.read.full');
    }
  });

  it('reserves user administration for the system administrator', () => {
    // Only the system administrator may manage users, even though the GIS
    // administrator is also flagged as an admin.
    const withUserManage = ROLES.filter((r) => permissionsForRole(r.code).includes('user.manage')).map((r) => r.code);
    expect(withUserManage).toEqual(['SYSTEM_ADMIN']);
  });

  it('gives every declared permission code to at least one role', () => {
    const granted = new Set(ROLES.flatMap((r) => permissionsForRole(r.code)));
    for (const p of PERMISSION_CODES) {
      expect(granted.has(p), `permission ${p} is defined but never granted`).toBe(true);
    }
  });

  it('never grants a permission code that is not declared', () => {
    const declared = new Set(PERMISSION_CODES);
    for (const r of ROLES) {
      for (const p of permissionsForRole(r.code)) {
        expect(declared.has(p), `${r.code} grants undeclared permission ${p}`).toBe(true);
      }
    }
  });

  it('maps each department to an officer role', () => {
    expect(roleForDepartment('Revenue')).toBe('REVENUE_OFFICER');
    expect(roleForDepartment('Registration')).toBe('REGISTRATION_OFFICER');
    expect(roleForDepartment('Municipal Tax')).toBe('MUNICIPAL_OFFICER');
    expect(roleForDepartment('Planning')).toBe('PLANNING_OFFICER');
    expect(roleForDepartment('Judiciary')).toBe('JUDICIARY_VIEWER');
    expect(roleForDepartment('Survey/GIS')).toBe('FIELD_OFFICER');
  });
});

describe('citizen masking', () => {
  it('masks party names and internal notes for a citizen', () => {
    const m = maskingFor('CITIZEN');
    expect(m.maskPartyNames).toBe(true);
    expect(m.includeInternalNotes).toBe(false);
    expect(m.includePrivateDocuments).toBe(false);
    expect(m.maskAmounts).toBe(true);
    expect(m.maskAssessmentNumbers).toBe(true);
  });

  it('does not mask for an authenticated officer', () => {
    for (const role of ['FIELD_OFFICER', 'REVENUE_OFFICER', 'SYSTEM_ADMIN']) {
      const m = maskingFor(role);
      expect(m.maskPartyNames, role).toBe(false);
      expect(m.includeInternalNotes, role).toBe(true);
      expect(m.includePrivateDocuments, role).toBe(true);
    }
  });

  it('masks surnames while leaving the initial legible', () => {
    const masked = maskPersonName('K. Meenakshi');
    expect(masked).not.toContain('Meenakshi');
    expect(masked).toMatch(/K\./);
  });

  it('never leaks a surname through masking', () => {
    // Honorifics may remain legible; the identifying family name must not.
    for (const name of ['R. Suresh', 'K. Meenakshi', 'Smt. Lakshmi Narayanan', 'Demo Bank Limited']) {
      const masked = maskPersonName(name) ?? '';
      const tokens = name
        .split(/\s+/)
        .map((t) => t.replace(/[^A-Za-z]/g, ''))
        .filter((t) => t.length > 1 && !/^(smt|shri|thiru|mr|mrs|ms|dr)$/i.test(t));
      for (const t of tokens) {
        expect(masked.toLowerCase(), `"${t}" leaked from "${name}"`).not.toContain(t.toLowerCase());
      }
      // The mask must actually replace characters, not pass the name through.
      expect(masked).toContain('•');
    }
  });

  it('masks monetary amounts and assessment numbers', () => {
    expect(maskAmount(2500000)).not.toContain('2500000');
    expect(maskAmount(2500000)).toMatch(/band|dues/i);
    expect(maskAssessmentNumber('A-123456')).not.toContain('123456');
    expect(maskAssessmentNumber('A-123456')).toContain('•');
  });

  it('scrubs party names embedded in free text anywhere in a passport payload', () => {
    // Section-level masking covers typed fields, but finding evidence and
    // timeline descriptions embed raw names inside prose. This guards the
    // recursive scrub that runs over the whole serialised passport.
    const payload = {
      findings: [
        {
          description: 'The RoR holder K. Meenakshi and the deed transferee R. Suresh disagree.',
          observedValue: 'K. Meenakshi',
          evidence: [{ expectedValue: 'K. Meenakshi' }, { observedValue: 'R. Suresh' }],
        },
      ],
      timeline: [{ description: 'Transferor K. Meenakshi → transferee R. Suresh' }],
      nested: { deep: ['Smt. Lakshmi Narayanan asserted the area'] },
    };

    const out = JSON.stringify(
      scrubPartyNames(payload, ['K. Meenakshi', 'R. Suresh', 'Smt. Lakshmi Narayanan']),
    );

    for (const leaked of ['Meenakshi', 'Suresh', 'Lakshmi', 'Narayanan']) {
      expect(out, `"${leaked}" leaked through the scrub`).not.toContain(leaked);
    }
    // Masking must replace, not delete, so the sentence stays readable.
    expect(out).toContain('•');
    expect(out).toContain('disagree');
  });
});

describe('request validation', () => {
  const schema = z.object({
    parcelId: z.string().min(1).max(64),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  it('applies defaults and coerces query strings', () => {
    const parsed = parse(schema, { parcelId: 'PARC-B', limit: '5' }, 'test');
    expect(parsed.limit).toBe(5);
    expect(parsed.parcelId).toBe('PARC-B');
    expect(parse(schema, { parcelId: 'PARC-B' }, 'test').limit).toBe(20);
  });

  it('rejects an oversized limit', () => {
    expect(() => parse(schema, { parcelId: 'PARC-B', limit: '5000' }, 'test')).toThrow(HttpError);
  });

  it('rejects a missing required field', () => {
    expect(() => parse(schema, { limit: '5' }, 'test')).toThrow(HttpError);
  });

  it('rejects an over-long identifier rather than truncating it', () => {
    expect(() => parse(schema, { parcelId: 'x'.repeat(65) }, 'test')).toThrow(HttpError);
  });

  it('names the failing field in the error message', () => {
    try {
      parse(schema, { limit: '5' }, 'parcel query');
      throw new Error('expected parse to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).message).toContain('parcel query');
    }
  });
});

describe('response envelope', () => {
  it('reports the page size, total and offset', () => {
    const body = envelope([1, 2, 3], 42, 3, 0);
    expect(body.items).toHaveLength(3);
    expect(body.total).toBe(42);
    expect(body.limit).toBe(3);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(true);
  });

  it('reports hasMore false on the final page', () => {
    expect(envelope([1], 41, 20, 40).hasMore).toBe(false);
  });

  it('handles an empty result set', () => {
    const body = envelope([], 0, 20, 0);
    expect(body.items).toEqual([]);
    expect(body.hasMore).toBe(false);
  });
});
