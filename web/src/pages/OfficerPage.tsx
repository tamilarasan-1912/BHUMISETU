import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
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
  SearchBar,
  StatusBadge,
  formatDate,
  formatNumber,
  type Column,
} from '../components/ui';
import type { VerificationCase } from '../types/api';

export function OfficerPage() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'created_at' | 'due_date' | 'priority'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const debounced = useDebounced(query, 320);

  const state = useAsync((s) => api.officer(s), []);
  const serviceRequests = useAsync((s) => api.serviceRequests({ limit: 25 }, s), []);

  const cases = useMemo(() => {
    let list = state.data?.cases ?? [];
    if (statusFilter) list = list.filter((c) => c.status === statusFilter);
    if (priorityFilter) list = list.filter((c) => c.priority === priorityFilter);
    if (debounced) {
      const q = debounced.toLowerCase();
      list = list.filter(
        (c) =>
          c.case_number.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.parcel_id.toLowerCase().includes(q) ||
          (c.display_id ?? '').toLowerCase().includes(q),
      );
    }
    const order = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 } as Record<string, number>;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'priority') return (order[a.priority] - order[b.priority]) * dir;
      const av = new Date(a[sortKey] ?? 0).getTime();
      const bv = new Date(b[sortKey] ?? 0).getTime();
      return (av - bv) * dir;
    });
  }, [state.data, statusFilter, priorityFilter, debounced, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key as typeof sortKey);
      setSortDir('desc');
    }
  };

  const columns: Column<VerificationCase>[] = [
    {
      key: 'case',
      header: 'Case',
      render: (c) => (
        <div>
          <div className="mono small">{c.case_number}</div>
          <div className="tiny muted">{c.origin.replace(/_/g, ' ')}</div>
        </div>
      ),
    },
    {
      key: 'parcel',
      header: 'Parcel',
      render: (c) => (
        <div>
          <div className="mono small">{c.display_id ?? c.parcel_id}</div>
          <div className="tiny muted">
            {[c.village, c.district].filter(Boolean).join(', ')}
          </div>
        </div>
      ),
    },
    { key: 'title', header: 'Title', render: (c) => <span className="small clamp-2">{c.title}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'priority',
      header: 'Priority',
      render: (c) => (
        <span className={`badge badge-${c.priority === 'URGENT' ? 'danger' : c.priority === 'HIGH' ? 'warn' : 'neutral'}`}>
          {c.priority}
        </span>
      ),
    },
    { key: 'due_date', header: 'Due', render: (c) => <span className="tiny">{c.due_date ? formatDate(c.due_date) : '—'}</span> },
    { key: 'created_at', header: 'Created', render: (c) => <span className="tiny muted">{formatDate(c.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/cases/${c.case_id}`);
          }}
        >
          Open
        </button>
      ),
    },
  ];

  if (!user || (!user.isOfficer && !user.isAdmin)) {
    return (
      <div className="page">
        <EmptyState
          title="Officer access required"
          icon="⚑"
          body="The officer workspace is restricted to field, revenue, registration, municipal, planning and administrator roles. Sign in with an officer account to open the case queue."
          action={
            <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Officer workspace</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '88ch' }}>
            Scope: <span className="mono">{state.data?.scope ?? user.role}</span>. Cards and the queue below reflect
            only the cases your role is responsible for — an officer can complete a verification task without leaving
            this workspace.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => navigate('/cases/new')}>
            New case
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/studio/health')}>
            System health
          </button>
        </div>
      </div>

      {state.loading ? (
        <LoadingState lines={3} />
      ) : state.error ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : (
        <>
          <div className="grid grid-4">
            <MetricCard
              label="Open cases"
              value={formatNumber(state.data?.cards.openCases)}
              tone="warn"
              hint="Not yet resolved"
              onClick={() => {
                setStatusFilter('');
                setPriorityFilter('');
              }}
            />
            <MetricCard label="High risk parcels" value={formatNumber(state.data?.cards.highRiskParcels)} tone="danger" hint="Internal band" />
            <MetricCard label="Field verification" value={formatNumber(state.data?.cards.fieldVerification)} hint="Awaiting site visit" />
            <MetricCard label="Escalated" value={formatNumber(state.data?.cards.escalated)} tone="danger" />
            <MetricCard label="Due today or overdue" value={formatNumber(state.data?.cards.dueToday)} tone="warn" />
            <MetricCard label="Unlinked parcels" value={formatNumber(state.data?.cards.unlinkedParcels)} tone="info" hint="NOT_LINKED finding" />
            <MetricCard label="Ownership mismatches" value={formatNumber(state.data?.cards.ownershipMismatches)} tone="warn" />
            <MetricCard label="Area mismatches" value={formatNumber(state.data?.cards.areaMismatches)} tone="warn" />
          </div>

          <GlassCard>
            <CardHead
              title="Case queue"
              subtitle={`${cases.length} case(s) in scope${state.data?.platformCaseTotal ? ` of ${state.data.platformCaseTotal} platform-wide` : ''}`}
              actions={
                <button type="button" className="btn btn-sm" onClick={() => state.reload()}>
                  Refresh
                </button>
              }
            />
            <FilterBar>
              <div className="grow" style={{ minWidth: 220 }}>
                <SearchBar id="officer-case-search" value={query} onChange={setQuery} placeholder="Case number, parcel, title" />
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label htmlFor="officer-status">Status</label>
                <select id="officer-status" className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Any status</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="UNDER_REVIEW">Under review</option>
                  <option value="FIELD_VERIFICATION">Field verification</option>
                  <option value="ESCALATED">Escalated</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </div>
              <div className="field" style={{ minWidth: 140 }}>
                <label htmlFor="officer-priority">Priority</label>
                <select id="officer-priority" className="select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                  <option value="">Any priority</option>
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setStatusFilter('');
                  setPriorityFilter('');
                  setQuery('');
                }}
              >
                Reset
              </button>
            </FilterBar>

            <div style={{ marginTop: 12 }}>
              <DataTable
                columns={columns}
                rows={cases}
                rowKey={(c) => c.case_id}
                onRowClick={(c) => navigate(`/cases/${c.case_id}`)}
                emptyLabel="No cases in your scope match these filters"
                sortable={{ key: sortKey, onSort, active: sortKey, direction: sortDir }}
              />
            </div>
          </GlassCard>

          <div className="grid grid-2">
            <GlassPanel>
              <CardHead title="Department workload" subtitle="Cases by assigned department across the platform" />
              {state.data?.workload.length === 0 ? (
                <EmptyState title="No workload recorded" body="No case is currently assigned to a department." />
              ) : (
                <div className="table-wrap">
                  <table className="data" style={{ minWidth: 360 }}>
                    <thead>
                      <tr>
                        <th scope="col">Department</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Total
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Open
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data?.workload.map((w) => (
                        <tr key={w.department}>
                          <td className="small">{w.department}</td>
                          <td className="num">{w.n}</td>
                          <td className="num">{w.open}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassPanel>

            <GlassPanel>
              <CardHead
                title="Citizen service requests"
                subtitle="Requests awaiting acknowledgement or routing"
                actions={
                  <button type="button" className="btn btn-sm" onClick={() => navigate('/citizen')}>
                    Citizen desk
                  </button>
                }
              />
              {serviceRequests.loading ? (
                <LoadingState lines={3} />
              ) : serviceRequests.error ? (
                <ErrorState error={serviceRequests.error} onRetry={serviceRequests.reload} />
              ) : (serviceRequests.data?.items.length ?? 0) === 0 ? (
                <EmptyState
                  title="No service requests"
                  icon="▤"
                  body="No citizen has submitted a service request. Requests appear here as soon as they are raised."
                />
              ) : (
                <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                  {serviceRequests.data?.items.slice(0, 8).map((r) => (
                    <li key={r.request_id} className="glass-inset card-tight">
                      <div className="row-between">
                        <span className="mono tiny">{r.reference_number}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="small" style={{ marginTop: 3 }}>
                        {r.subject}
                      </div>
                      <div className="tiny muted">
                        {r.request_type.replace(/_/g, ' ')} · {r.parcel_id ?? 'no parcel'} · {formatDate(r.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </div>

          <div className="grid grid-2">
            {cases.slice(0, 6).map((c) => (
              <CaseCard key={c.case_id} item={c} onOpen={(id) => navigate(`/cases/${id}`)} />
            ))}
          </div>

          <ProvenanceNotice tone="demo">{state.data?.datasetNotice}</ProvenanceNotice>
        </>
      )}
    </div>
  );
}
