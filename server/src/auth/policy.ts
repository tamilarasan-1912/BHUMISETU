import { permissionsForRole, ROLES } from '../data/roles.js';

/**
 * Central resource/action policy. Route guards, the officer queue filter and
 * the citizen view all consult this single table so authorization cannot drift
 * between layers.
 */
export type Resource =
  | 'parcel.public'
  | 'parcel.full'
  | 'parcel.internal'
  | 'finding'
  | 'case.own'
  | 'case.all'
  | 'service_request.own'
  | 'service_request.all'
  | 'analytics'
  | 'gateway'
  | 'source'
  | 'rule'
  | 'audit'
  | 'user'
  | 'system';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'configure';

const MATRIX: Record<Resource, Partial<Record<Action, string>>> = {
  'parcel.public': { read: 'parcel.read.public' },
  'parcel.full': { read: 'parcel.read.full' },
  'parcel.internal': { read: 'parcel.read.internal' },
  finding: { read: 'finding.read', update: 'finding.update' },
  'case.own': { read: 'case.read.own', create: 'case.create' },
  'case.all': { read: 'case.read.all', create: 'case.create', update: 'case.update', configure: 'case.assign' },
  'service_request.own': { read: 'service.request.create', create: 'service.request.create' },
  'service_request.all': { read: 'service.request.read', update: 'service.request.update' },
  analytics: { read: 'analytics.read' },
  gateway: { read: 'gateway.read' },
  source: { read: 'source.read', configure: 'source.configure' },
  rule: { read: 'rule.read', configure: 'rule.configure' },
  audit: { read: 'audit.read' },
  user: { read: 'user.manage', update: 'user.manage', create: 'user.manage' },
  system: { read: 'system.health', configure: 'source.configure' },
};

export function permissionFor(action: Action, resource: Resource): string | undefined {
  return MATRIX[resource]?.[action];
}

export function isAllowed(role: string, action: Action, resource: Resource): boolean {
  const permission = permissionFor(action, resource);
  if (!permission) return false;
  return permissionsForRole(role).includes(permission);
}

/** Departments a role may receive assignments for; SYSTEM_ADMIN spans all. */
export function departmentsForRole(role: string): string[] {
  const def = ROLES.find((r) => r.code === role);
  return def?.departments ?? [];
}

export function roleForDepartment(department: string): string | null {
  return ROLES.find((r) => r.departments.includes(department))?.code ?? null;
}

/** Fields stripped from a parcel payload for a given role. */
export interface MaskingPolicy {
  maskPartyNames: boolean;
  maskAmounts: boolean;
  maskAssessmentNumbers: boolean;
  includeInternalNotes: boolean;
  includePrivateDocuments: boolean;
}

export function maskingFor(role: string): MaskingPolicy {
  if (role === 'CITIZEN') {
    return {
      maskPartyNames: true,
      maskAmounts: true,
      maskAssessmentNumbers: true,
      includeInternalNotes: false,
      includePrivateDocuments: false,
    };
  }
  return {
    maskPartyNames: false,
    maskAmounts: false,
    maskAssessmentNumbers: false,
    includeInternalNotes: true,
    includePrivateDocuments: true,
  };
}
