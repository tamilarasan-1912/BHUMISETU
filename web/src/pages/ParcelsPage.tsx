import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import {
  CardHead,
  DataStatusChip,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  GlassCard,
  GlassPanel,
  LinkageBadge,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  RiskBadge,
  SearchBar,
  formatArea,
  formatNumber,
  type Column,
} from '../components/ui';
import type { ParcelSummary } from '../types/api';

type SortKey = 'displayId' | 'areaSqft' | 'score' | 'findingCount' | 'village';

export function ParcelsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState(params.get('district') ?? '');
  const [risk, setRisk] = useState(params.get('risk') ?? '');
  const [linkage, setLinkage] = useState(params.get('linkage') ?? '');
  const [sortKey, setSortKey] = useState<SortKey>('displayId');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const debounced = useDebounced(query, 350);
  const debouncedDistrict = useDebounced(district, 250);

  const state = useAsync(
    (s) =>
      api.parcels(
        {
          q: debounced || undefined,
          district: debouncedDistrict || undefined,
          limit,
          offset,
        },
        s,
      ),
    [debounced, debouncedDistrict, offset],
  );

  const districts = useAsync((s) => api.districts(s), []);

  const rows = useMemo(() => {
    let list = state.data?.items ?? [];
    if (risk) list = list.filter((p) => p.riskBand === risk);
    if (linkage) list = list.filter((p) => p.linkage === linkage);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'areaSqft':
          return ((a.areaSqft ?? 0) - (b.areaSqft ?? 0)) * dir;
        case 'score':
          return (a.score - b.score) * dir;
        case 'findingCount':
          return (a.findingCount - b.findingCount) * dir;
        case 'village':
          return a.village.localeCompare(b.village) * dir;
        default:
          return a.displayId.localeCompare(b.displayId) * dir;
      }
    });
  }, [state.data, risk, linkage, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key as SortKey);
      setSortDir('asc');
    }
  };

  const columns: Column<ParcelSummary>[] = [
    {
      key: 'displayId',
      header: 'Parcel identity',
      render: (p) => (
        <div>
          <div className="mono small">{p.displayId}</div>
          <div className="tiny muted">
            {p.parcelId} · survey {p.surveyNumber ?? '—'}
            {p.subdivisionNumber ? `/${p.subdivisionNumber}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'village',
      header: 'Location',
      render: (p) => (
        <div>
          <div className="small">{p.village}</div>
          <div className="tiny muted">
            {p.taluk ? `${p.taluk}, ` : ''}
            {p.district}
          </div>
        </div>
      ),
    },
    { key: 'areaSqft', header: 'Area', align: 'right', render: (p) => <span className="num">{formatArea(p.areaSqft)}</span> },
    {
      key: 'score',
      header: 'Verification band',
      render: (p) => <RiskBadge band={p.riskBand} score={p.score} />,
    },
    {
      key: 'findingCount',
      header: 'Findings',
      render: (p) =>
        p.findingCount === 0 ? (
          <span className="badge badge-ok">none</span>
        ) : (
          <div className="chip-row">
            {p.findings.slice(0, 2).map((f) => (
              <span key={f.ruleCode} className="badge badge-neutral mono tiny">
                {f.ruleCode}
              </span>
            ))}
            {p.findingCount > 2 ? <span className="tiny muted">+{p.findingCount - 2}</span> : null}
          </div>
        ),
    },
    { key: 'linkage', header: 'Linkage', render: (p) => <LinkageBadge linkage={p.linkage} /> },
    { key: 'data', header: 'Data', render: (p) => <DataStatusChip status={p.dataStatus} short /> },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/passport/${p.parcelId}`);
            }}
          >
            Passport
          </button>
        </div>
      ),
    },
  ];

  const applyFiltersToUrl = () => {
    const next = new URLSearchParams();
    if (district) next.set('district', district);
    if (risk) next.set('risk', risk);
    if (linkage) next.set('linkage', linkage);
    setParams(next, { replace: true });
  };

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Parcel register</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>
            Every parcel is the same central object used by the map, passport, intelligence workspace, case
            workflow and analytics. Search matches parcel identifiers, survey numbers, owner names and locations.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => navigate('/intelligence')}>
            Intelligence workspace
          </button>
        </div>
      </div>

      <GlassCard>
        <FilterBar>
          <div className="grow" style={{ minWidth: 260 }}>
            <SearchBar
              id="parcel-search"
              value={query}
              onChange={setQuery}
              placeholder="Parcel ID, ULPIN-like ID, survey number, owner, village"
            />
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="district-filter">District</label>
            <select
              id="district-filter"
              className="select"
              value={district}
              onChange={(e) => {
                setDistrict(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All districts</option>
              {(districts.data?.items ?? []).map((d) => (
                <option key={d.district} value={d.district}>
                  {d.district} ({d.parcels})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="risk-filter">Band</label>
            <select id="risk-filter" className="select" value={risk} onChange={(e) => setRisk(e.target.value)}>
              <option value="">Any band</option>
              <option value="VERIFIED">Verified</option>
              <option value="REVIEW">Review</option>
              <option value="HIGH RISK">High risk</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="linkage-filter">Linkage</label>
            <select id="linkage-filter" className="select" value={linkage} onChange={(e) => setLinkage(e.target.value)}>
              <option value="">Any linkage</option>
              <option value="LINKED">Linked</option>
              <option value="PARTIALLY_LINKED">Partially linked</option>
              <option value="UNLINKED">Unlinked</option>
              <option value="CONFLICTING">Conflicting</option>
            </select>
          </div>
          <button type="button" className="btn btn-sm" onClick={applyFiltersToUrl}>
            Save filters in URL
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setQuery('');
              setDistrict('');
              setRisk('');
              setLinkage('');
              setOffset(0);
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Reset
          </button>
        </FilterBar>

        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <MetricCard label="Rows in view" value={formatNumber(rows.length)} />
          <MetricCard
            label="With findings"
            value={formatNumber(rows.filter((r) => r.findingCount > 0).length)}
            tone="warn"
          />
          <MetricCard label="High risk" value={formatNumber(rows.filter((r) => r.riskBand === 'HIGH RISK').length)} tone="danger" />
          <MetricCard label="Unlinked" value={formatNumber(rows.filter((r) => r.linkage === 'UNLINKED').length)} tone="info" />
        </div>

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
                rowKey={(p) => p.parcelId}
                onRowClick={(p) => navigate(`/intelligence/${p.parcelId}`)}
                caption="Demonstration dataset — parcel identifiers are synthetic and no record here is an official government land record."
                sortable={{ key: sortKey, onSort, active: sortKey, direction: sortDir }}
                emptyLabel="No parcels match these filters"
              />
              <div className="row-between" style={{ marginTop: 10 }}>
                <span className="small muted">
                  {state.refreshing ? 'Refreshing…' : `${rows.length} of ${state.data?.total ?? 0} parcel(s)`}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={(state.data?.hasMore ?? false) === false}
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

      <GlassPanel>
        <CardHead title="About this register" subtitle="How parcels relate to the rest of the platform" />
        <div className="grid grid-2">
          <div className="small muted">
            Each row resolves to one parcel, which is the anchor for spatial geometry, identity, ownership and
            rights, Record of Rights, registration, encumbrance, taxation, planning, land use, judiciary,
            satellite observation, integrity findings, evidence, verification cases and the audit trail.
          </div>
          <div>
            <ProvenanceNotice tone="demo">
              <strong>Demonstration records.</strong> {`Parcel identifiers like 3301DEMO000042 are synthetic
              values shaped like ULPIN for interface development. They are not official ULPIN identifiers and
              carry no legal weight.`}
            </ProvenanceNotice>
          </div>
        </div>
        {rows.length === 0 && !state.loading ? (
          <div style={{ marginTop: 12 }}>
            <EmptyState
              title="No rows to display"
              icon="≡"
              body="Either no parcel matches the filters, or the parcel register is empty. If the dataset is empty, run the seed task to create the six demonstration parcels."
            />
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}
