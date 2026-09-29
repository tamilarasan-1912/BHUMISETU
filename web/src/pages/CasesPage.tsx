import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import {
  CardHead,
  CaseCard,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  RiskBadge,
  SearchBar,
  StatusBadge,
  formatDateTime,
  formatNumber,
  type Column,
} from '../components/ui';
import type { VerificationCase } from '../types/api';

export function CasesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const debounced = useDebounced(query, 350);

  const state = useAsync(
    (s) =>
      api.cases(
        {
          status: status || undefined,
          priority: priority || undefined,
          district: district || undefined,
          q: debounced || undefined,
          limit,
          offset,
        },
        s,
      ),
    [status, priority, district, debounced, offset],
  );

  const districts = useAsync((s) => api.districts(s), []);
  const rows = state.data?.items ?? [];

  const columns: Column<VerificationCase>[] = [
    {
      key: 'case',
      header: 'Case',
      render: (c) => (
        <div>
          <div className="mono small">{c.case_number}</div>
          <div className="tiny muted">{formatDateTime(c.created_at)}</div>
        </div>
      ),
    },
    {
      key: 'parcel',
      header: 'Parcel',
      render: (c) => (
        <div>
          <div className="mono small">{c.display_id ?? c.parcel_id}</div>
          <div className="tiny muted">{c.parcel_id}</div>
        </div>
      ),
    },
    { key: 'title', header: 'Title', render: (c) => <span className="small clamp-2">{c.title}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'priority', header: 'Priority', render: (c) => <span className="badge badge-neutral">{c.priority}</span> },
    {
      key: 'routed',
      header: 'Routed to',
      render: (c) => <span className="small muted">{c.assigned_department ?? c.assigned_role ?? 'Unassigned'}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      render: (c) => <span className="tiny">{c.due_date ? formatDateTime(c.due_date) : '—'}</span>,
    },
  ];

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Verification cases</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '86ch' }}>
            A case is the auditable unit of verification work. Every status change writes a case event and an audit
            record inside one transaction, so the history can never silently diverge from the current state.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/cases/new')}>
          New case
        </button>
      </div>

      <div className="grid grid-4">
        <MetricCard label="Cases in view" value={formatNumber(state.data?.total)} />
        <MetricCard label="Awaiting review" value={formatNumber(rows.filter((c) => c.status === 'UNDER_REVIEW').length)} tone="warn" />
        <MetricCard label="Escalated" value={formatNumber(rows.filter((c) => c.status === 'ESCALATED').length)} tone="danger" />
        <MetricCard label="Resolved" value={formatNumber(rows.filter((c) => c.status === 'RESOLVED').length)} tone="ok" />
      </div>

      <GlassCard>
        <FilterBar>
          <div className="grow" style={{ minWidth: 240 }}>
            <SearchBar id="case-search" value={query} onChange={setQuery} placeholder="Case number, parcel, title" />
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label htmlFor="case-status">Status</label>
            <select id="case-status" className="select" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
              <option value="">Any status</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="FIELD_VERIFICATION">Field verification</option>
              <option value="ESCALATED">Escalated</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="case-priority">Priority</label>
            <select id="case-priority" className="select" value={priority} onChange={(e) => { setPriority(e.target.value); setOffset(0); }}>
              <option value="">Any priority</option>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label htmlFor="case-district">District</label>
            <select id="case-district" className="select" value={district} onChange={(e) => { setDistrict(e.target.value); setOffset(0); }}>
              <option value="">All districts</option>
              {(districts.data?.items ?? []).map((d) => (
                <option key={d.district} value={d.district}>
                  {d.district}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setStatus('');
              setPriority('');
              setDistrict('');
              setQuery('');
              setOffset(0);
            }}
          >
            Reset
          </button>
        </FilterBar>

        <div style={{ marginTop: 12 }}>
          {state.loading ? (
            <LoadingState lines={5} />
          ) : state.error ? (
            <ErrorState error={state.error} onRetry={state.reload} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(c) => c.case_id}
                onRowClick={(c) => navigate(`/cases/${c.case_id}`)}
                emptyLabel="No cases match these filters"
                caption="Case records are demonstration workflow items created against demonstration parcels."
              />
              <div className="row-between" style={{ marginTop: 10 }}>
                <span className="small muted">
                  {state.refreshing ? 'Refreshing…' : `${rows.length} of ${state.data?.total ?? 0} case(s)`}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!(state.data?.hasMore ?? false)}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </GlassCard>

      <div className="grid grid-2">
        {rows.slice(0, 6).map((c) => (
          <CaseCard key={c.case_id} item={c} onOpen={(id) => navigate(`/cases/${id}`)} />
        ))}
      </div>

      {rows.length === 0 && !state.loading ? (
        <GlassPanel>
          <EmptyState
            title="No cases yet"
            icon="⚑"
            body="No verification case exists in the current filter. Create one from a parcel's integrity finding so the discrepancy is routed to the responsible authority with an auditable trail."
            action={
              <button type="button" className="btn btn-primary" onClick={() => navigate('/cases/new')}>
                Create the first case
              </button>
            }
          />
        </GlassPanel>
      ) : null}

      <ProvenanceNotice tone="demo">
        Cases operate on demonstration parcels. No case, status change or comment in this deployment is an official
        government record.
      </ProvenanceNotice>

      {rows.some((c) => c.origin === 'CITIZEN_REQUEST') ? (
        <GlassPanel>
          <CardHead title="Citizen-originated cases" subtitle="Raised through the citizen service request workflow" />
          <ul className="pill-list" style={{ flexDirection: 'column', gap: 6 }}>
            {rows
              .filter((c) => c.origin === 'CITIZEN_REQUEST')
              .map((c) => (
                <li key={c.case_id} className="row-between" style={{ width: '100%' }}>
                  <span className="small">
                    {c.case_number} · <RiskBadge band={c.priority === 'URGENT' ? 'HIGH RISK' : 'REVIEW'} />
                  </span>
                  <button type="button" className="link-btn small" onClick={() => navigate(`/cases/${c.case_id}`)}>
                    Open
                  </button>
                </li>
              ))}
          </ul>
        </GlassPanel>
      ) : null}
    </div>
  );
}
