import type {
  Analytics,
  AppMeta,
  AuditEntry,
  Capability,
  CaseDetail,
  DataSourceEntry,
  AdapterHealth,
  Envelope,
  GatewayDepartment,
  GeojsonCollection,
  LandPassport,
  LayerEntry,
  Notification,
  OfficerDashboard,
  ParcelDetail,
  ParcelSummary,
  RuleDefinitionRow,
  SearchResponse,
  ServiceRequest,
  SessionUser,
  SpatialContext,
  TimelineEvent,
  VerificationCase,
} from '../types/api';

/**
 * Typed API client. Every request carries an AbortSignal, surfaces structured
 * errors, and never lets a failing external source take down a page: callers
 * receive either data or an ApiError they can render as an error state.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId: string | null;
  retryable: boolean;
  unavailable: boolean;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
    unavailable?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
    this.retryable = init.status >= 500 || init.status === 429;
    this.unavailable = Boolean(init.unavailable);
  }
}

const TOKEN_KEY = 'bhumisetu.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session stays in memory only */
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = `/api${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_UNAVAILABLE',
      message:
        'The BHUMISETU API is unreachable. Check that the server is running and that you are online, then retry.',
    });
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const envelope = payload as
      | { error?: { code?: string; message?: string; details?: unknown; requestId?: string }; reason?: string; unavailable?: boolean }
      | null;
    throw new ApiError({
      status: res.status,
      code: envelope?.error?.code ?? (res.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED'),
      message:
        envelope?.error?.message ??
        envelope?.reason ??
        `Request failed with status ${res.status}`,
      details: envelope?.error?.details,
      requestId: envelope?.error?.requestId,
      unavailable: Boolean(envelope?.unavailable),
    });
  }

  return payload as T;
}

/* ------------------------------------------------------------------ endpoints */

export const api = {
  meta: (signal?: AbortSignal) => request<AppMeta>('/meta', { signal }),

  health: (signal?: AbortSignal) =>
    request<{
      ok: boolean;
      version: string;
      database: { ok: boolean; latencyMs: number; poolTotal?: number; serverVersion?: string; postgis: boolean };
      api: { latencyMs: number };
      sources: (AdapterHealth | null)[];
      checkedAt: string;
    }>('/health', { signal }),

  stats: (signal?: AbortSignal) =>
    request<{
      parcels: number;
      findings: number;
      cases: number;
      sources: number;
      highRisk: number;
      review: number;
      unlinked: number;
      verified: number;
      datasetLabel: string;
      datasetNotice: string;
    }>('/stats', { signal }),

  login: (username: string, password: string) =>
    request<{ token: string; user: SessionUser; expiresAt: string }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    }),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: (signal?: AbortSignal) =>
    request<{
      user: SessionUser;
      masking: ParcelDetail['maskingPolicy'];
      capabilities: Capability | null;
    }>('/auth/me', { signal }),

  capabilities: (signal?: AbortSignal) => request<{ roles: Capability[] }>('/auth/capabilities', { signal }),

  parcels: (
    query: {
      district?: string;
      village?: string;
      taluk?: string;
      q?: string;
      risk?: string;
      linkage?: string;
      limit?: number;
      offset?: number;
    },
    signal?: AbortSignal,
  ) => request<Envelope<ParcelSummary>>('/parcels', { query, signal }),

  parcel: (parcelId: string, signal?: AbortSignal) =>
    request<ParcelDetail>(`/parcels/${encodeURIComponent(parcelId)}`, { signal }),

  passport: (
    parcelId: string,
    opts: { context?: boolean; radius?: number } = {},
    signal?: AbortSignal,
  ) =>
    request<LandPassport>(`/passport/${encodeURIComponent(parcelId)}`, {
      query: { context: opts.context ? 'true' : undefined, radius: opts.radius },
      signal,
    }),

  timeline: (parcelId: string, signal?: AbortSignal) =>
    request<{ items: TimelineEvent[]; total: number; maskedForRole: boolean }>(
      `/parcels/${encodeURIComponent(parcelId)}/timeline`,
      { signal },
    ),

  geojson: (query: { district?: string; village?: string; bbox?: string; limit?: number } = {}, signal?: AbortSignal) =>
    request<GeojsonCollection>('/geojson', { query, signal }),

  layers: (signal?: AbortSignal) => request<{ items: LayerEntry[]; catalogue: unknown[] }>('/layers', { signal }),

  layerFeatures: (layerId: string, signal?: AbortSignal) =>
    request<GeojsonCollection>(`/layers/${encodeURIComponent(layerId)}/features`, { signal }),

  osmContext: (
    query: { parcelId?: string; lat?: number; lon?: number; radius?: number },
    signal?: AbortSignal,
  ) => request<SpatialContext>('/osm-context', { query, signal }),

  satellite: (parcelId: string | undefined, signal?: AbortSignal) =>
    request<{
      observations: unknown[];
      changeDetections: unknown[];
      processing: { mode: string; notice: string; replaceableBy: string; copernicus: { configured: boolean; requiresAuth: boolean } };
    }>('/satellite/observations', { query: { parcelId }, signal }),

  findings: (
    query: { parcelId?: string; ruleCode?: string; severity?: string; status?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ) => request<Envelope<Record<string, unknown>>>('/findings', { query, signal }),

  rules: (signal?: AbortSignal) => request<{ items: RuleDefinitionRow[]; canonical: unknown[] }>('/rules', { signal }),

  updateRule: (
    ruleCode: string,
    body: { severity?: string; deduction?: number; isEnabled?: boolean; reason: string },
  ) => request<RuleDefinitionRow>(`/rules/${encodeURIComponent(ruleCode)}`, { method: 'PATCH', body }),

  updateFinding: (findingId: string, body: { status: string; reason: string }) =>
    request<Record<string, unknown>>(`/findings/${encodeURIComponent(findingId)}`, { method: 'PATCH', body }),

  search: (query: string, limit = 20, signal?: AbortSignal) =>
    request<SearchResponse>('/search', { method: 'POST', body: { query, limit }, signal }),

  cases: (
    query: {
      status?: string;
      priority?: string;
      assignedRole?: string;
      district?: string;
      village?: string;
      parcelId?: string;
      q?: string;
      limit?: number;
      offset?: number;
    },
    signal?: AbortSignal,
  ) => request<Envelope<VerificationCase>>('/cases', { query, signal }),

  case: (caseId: string, signal?: AbortSignal) => request<CaseDetail>(`/cases/${encodeURIComponent(caseId)}`, { signal }),

  createCase: (body: {
    parcelId: string;
    title: string;
    description: string;
    priority: string;
    findingRefs: string[];
    assignedDepartment?: string | null;
    dueDate?: string | null;
  }) => request<VerificationCase>('/cases', { method: 'POST', body }),

  updateCase: (
    caseId: string,
    body: {
      status?: string;
      priority?: string;
      assignedOfficer?: string | null;
      assignedRole?: string | null;
      assignedDepartment?: string | null;
      dueDate?: string | null;
      resolutionNote?: string | null;
      comment?: string | null;
      commentVisibility?: string;
      reason: string;
    },
  ) => request<VerificationCase>(`/cases/${encodeURIComponent(caseId)}/update`, { method: 'POST', body }),

  officer: (signal?: AbortSignal) => request<OfficerDashboard>('/officer', { signal }),

  officers: (signal?: AbortSignal) =>
    request<{
      items: { user_id: string; full_name: string; username: string; role_code: string; department: string | null; district: string | null; role_label: string }[];
    }>('/officers', { signal }),

  analytics: (signal?: AbortSignal) => request<Analytics>('/analytics', { signal }),

  gateway: (signal?: AbortSignal) => request<{ departments: GatewayDepartment[] }>('/gateway', { signal }),

  dataSources: (
    opts: { probe?: boolean } = {},
    signal?: AbortSignal,
  ) => request<{ items: DataSourceEntry[]; health?: AdapterHealth[]; catalogue?: unknown[] }>('/data-sources', {
    query: { probe: opts.probe ? 'true' : undefined },
    signal,
  }),

  dataSource: (sourceId: string, signal?: AbortSignal) =>
    request<{
      definition: DataSourceEntry | null;
      metadata: unknown;
      health: AdapterHealth | null;
      runs: Record<string, unknown>[];
      ingestion: Record<string, unknown>[];
      pipeline: string[];
    }>(`/data-sources/${encodeURIComponent(sourceId)}`, { signal }),

  toggleSource: (sourceId: string, isEnabled: boolean, reason: string) =>
    request<DataSourceEntry>(`/data-sources/${encodeURIComponent(sourceId)}/toggle`, {
      method: 'POST',
      body: { isEnabled, reason },
    }),

  adminOverview: (signal?: AbortSignal) =>
    request<{
      users: {
        user_id: string;
        username: string;
        full_name: string;
        role_code: string;
        district: string | null;
        department: string | null;
        active: boolean;
        last_login_at: string | null;
      }[];
      roles: { code: string; label: string; is_officer: boolean; is_admin: boolean; permission_count: number }[];
      auditCount: number;
      sources: { total: number; degraded: number };
      openCases: number;
      capabilityMatrix: Capability[];
      workflows: Record<string, unknown>[];
      limitations: { demoNotice: string; externalIntegrations: string[] };
    }>('/admin/overview', { signal }),

  audit: (
    query: { entityType?: string; entityId?: string; parcelId?: string; action?: string; actor?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ) => request<Envelope<AuditEntry>>('/audit', { query, signal }),

  ingestion: (signal?: AbortSignal) =>
    request<{
      pipeline: string[];
      ingestionRuns: Record<string, unknown>[];
      adapterRuns: Record<string, unknown>[];
      qualityMetrics: Record<string, unknown>[];
      note: string;
    }>('/admin/ingestion', { signal }),

  districts: (signal?: AbortSignal) =>
    request<{ items: { district: string; parcels: number; villages: number }[] }>('/districts', { signal }),

  createServiceRequest: (body: {
    parcelId?: string | null;
    requestType: string;
    subject: string;
    description: string;
    contactMasked?: string | null;
  }) => request<ServiceRequest>('/service-requests', { method: 'POST', body }),

  serviceRequests: (
    query: { status?: string; department?: string; parcelId?: string; limit?: number; offset?: number },
    signal?: AbortSignal,
  ) => request<Envelope<ServiceRequest>>('/service-requests', { query, signal }),

  updateServiceRequest: (
    requestId: string,
    body: { status: string; note: string; linkCaseId?: string | null },
  ) => request<ServiceRequest>(`/service-requests/${encodeURIComponent(requestId)}/update`, { method: 'POST', body }),

  notifications: (signal?: AbortSignal) =>
    request<{ items: Notification[]; unread: number }>('/notifications', { signal }),

  markNotificationRead: (id: string) =>
    request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),

  reportParcel: (parcelId: string, signal?: AbortSignal) =>
    request<Record<string, unknown>>(`/reports/parcel/${encodeURIComponent(parcelId)}`, { signal }),

  unavailable: (feature: string) => request<never>(`/unavailable/${encodeURIComponent(feature)}`),
};

/** Download helper for CSV/GeoJSON exports that must bypass the JSON client. */
export async function downloadExport(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    throw new ApiError({ status: res.status, code: 'EXPORT_FAILED', message: 'Export failed' });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvExportUrl(parcelId: string): string {
  return `/api/reports/parcel/${encodeURIComponent(parcelId)}?format=csv`;
}

export function geojsonExportUrl(): string {
  return '/api/geojson';
}
