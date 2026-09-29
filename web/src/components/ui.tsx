import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import type { DataStatus, Linkage, RiskBand, Severity, SourceStatus } from '../types/api';
import { useApp } from '../app/AppState';

/* ------------------------------------------------------------------ surfaces */

export function GlassCard({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div' | 'aside';
}) {
  return <Tag className={`glass card ${className}`.trim()}>{children}</Tag>;
}

export function GlassPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass-panel card ${className}`.trim()}>{children}</div>;
}

export function CardHead({
  title,
  subtitle,
  actions,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="card-head">
      <div className="grow">
        <div className="card-title" id={id}>
          {title}
        </div>
        {subtitle ? <div className="card-sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="chip-row">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- badges */

export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const tone = toneForStatus(status);
  return <span className={`badge badge-${tone}`}>{children ?? status.replace(/_/g, ' ')}</span>;
}

function toneForStatus(status: string): string {
  const s = status.toUpperCase();
  if (['RESOLVED', 'CONNECTED', 'AVAILABLE', 'ACTIVE', 'LINKED', 'ACKNOWLEDGED', 'CLOSED'].includes(s)) return 'ok';
  if (['UNDER_REVIEW', 'FIELD_VERIFICATION', 'REVIEW', 'PARTIALLY_LINKED', 'ADAPTER_READY', 'PENDING', 'SUBMITTED'].includes(s))
    return 'warn';
  if (['ESCALATED', 'HIGH RISK', 'REJECTED', 'UPSTREAM_UNAVAILABLE', 'CONFLICTING', 'FAILED'].includes(s)) return 'danger';
  if (['OPEN', 'NOT_CONFIGURED', 'UNLINKED', 'NO CASE'].includes(s)) return 'info';
  if (['DEMO_DATA', 'DEMONSTRATION'].includes(s)) return 'demo';
  if (['REQUIRES_AUTH'].includes(s)) return 'neutral';
  return 'neutral';
}

export function RiskBadge({ band, score }: { band: RiskBand; score?: number }) {
  const tone = band === 'VERIFIED' ? 'ok' : band === 'REVIEW' ? 'warn' : 'danger';
  return (
    <span className={`badge badge-${tone}`} title="Internal verification-support band — not a legal determination">
      <span className={`dot`} style={{ background: 'currentColor' }} aria-hidden="true" />
      {band}
      {typeof score === 'number' ? <span className="mono"> {score}</span> : null}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone = severity === 'HIGH' ? 'danger' : severity === 'MEDIUM' ? 'warn' : 'info';
  return <span className={`badge badge-${tone}`}>{severity}</span>;
}

export function LinkageBadge({ linkage }: { linkage: Linkage }) {
  const tone =
    linkage === 'LINKED' ? 'ok' : linkage === 'CONFLICTING' ? 'danger' : linkage === 'UNLINKED' ? 'info' : 'warn';
  return <span className={`badge badge-${tone}`}>Linked: {linkage.replace(/_/g, ' ')}</span>;
}

const SOURCE_TONE: Record<SourceStatus, string> = {
  CONNECTED: 'ok',
  AVAILABLE: 'ok',
  ADAPTER_READY: 'info',
  UPSTREAM_UNAVAILABLE: 'danger',
  REQUIRES_AUTH: 'warn',
  DEMO_DATA: 'demo',
  NOT_CONFIGURED: 'neutral',
};

export function SourceBadge({ status }: { status: SourceStatus }) {
  return (
    <span className={`badge badge-${SOURCE_TONE[status] ?? 'neutral'}`}>
      <span className="dot" style={{ background: 'currentColor' }} aria-hidden="true" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const STATUS_GLYPH: Record<DataStatus, string> = {
  REAL: '●',
  DERIVED: '◐',
  AI: '✦',
  DEMONSTRATION: '◇',
  CONTEXTUAL: '○',
};

const STATUS_TOOLTIP: Record<DataStatus, string> = {
  REAL: 'Real data retrieved from the stated authority',
  DERIVED: 'Computed by BHUMISETU from other records (not a source record)',
  AI: 'AI-generated output — review required',
  DEMONSTRATION: 'Demonstration fixture — not an official record',
  CONTEXTUAL: 'Contextual geographic information — not an authority record',
};

export function DataStatusChip({ status, short = false }: { status: DataStatus; short?: boolean }) {
  return (
    <span className={`prov-chip prov-${status}`} title={STATUS_TOOLTIP[status]}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
      {short ? status.slice(0, 4) : status}
    </span>
  );
}

/** Compact provenance block — the "where did this come from" answer. */
export function DataProvenance({
  source,
  authority,
  dataStatus,
  recordedAt,
  retrievedAt,
  confidence,
  note,
  compact = false,
}: {
  source: string;
  authority: string;
  dataStatus: DataStatus;
  recordedAt?: string | null;
  retrievedAt?: string | null;
  confidence?: number | null;
  note?: string | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className="chip-row tiny muted" style={{ gap: 6 }}>
        <DataStatusChip status={dataStatus} short />
        <span className="truncate" title={source}>
          {source}
        </span>
        {recordedAt ? <span>· {formatDate(recordedAt)}</span> : null}
        {typeof confidence === 'number' ? <span>· conf {confidence.toFixed(2)}</span> : null}
      </span>
    );
  }
  return (
    <div className="prov-block">
      <div className="chip-row">
        <DataStatusChip status={dataStatus} />
        <span className="prov-value">{source}</span>
      </div>
      <div>
        Authority: <span className="prov-value">{authority}</span>
      </div>
      {recordedAt ? (
        <div>
          Recorded: <span className="prov-value">{formatDate(recordedAt)}</span>
        </div>
      ) : null}
      {retrievedAt ? (
        <div>
          Retrieved: <span className="prov-value">{formatDate(retrievedAt)}</span>
        </div>
      ) : null}
      {typeof confidence === 'number' ? (
        <div>
          Confidence: <span className="prov-value mono">{confidence.toFixed(2)}</span>
        </div>
      ) : null}
      {note ? <div style={{ marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

/** Labelled value with its provenance, used throughout the passport. */
export function ProvenanceField({
  label,
  value,
  source,
  authority,
  dataStatus,
  recordedAt,
  confidence,
  note,
}: {
  label: string;
  value: ReactNode;
  source?: string;
  authority?: string;
  dataStatus?: DataStatus;
  recordedAt?: string | null;
  confidence?: number | null;
  note?: string | null;
}) {
  return (
    <div className="stack" style={{ gap: 5 }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
      {dataStatus && source && authority ? (
        <DataProvenance
          source={source}
          authority={authority}
          dataStatus={dataStatus}
          recordedAt={recordedAt}
          confidence={confidence}
          note={note}
          compact
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- metrics */

export function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info';
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="metric-value" style={toneStyle(tone)}>
        {value}
      </div>
      <div className="metric-label">{label}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="glass metric btn-ghost" onClick={onClick} style={{ textAlign: 'left' }}>
        {body}
      </button>
    );
  }
  return <div className="glass metric">{body}</div>;
}

function toneStyle(tone: string): { color?: string } {
  switch (tone) {
    case 'ok':
      return { color: 'var(--ok)' };
    case 'warn':
      return { color: 'var(--warn)' };
    case 'danger':
      return { color: 'var(--danger)' };
    case 'info':
      return { color: 'var(--info)' };
    default:
      return {};
  }
}

/* -------------------------------------------------------------------- states */

export function LoadingState({ lines = 4, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton ${i === 0 ? 'tall' : i % 3 === 0 ? 'w-60' : i % 2 === 0 ? 'w-80' : ''}`.trim()}
        />
      ))}
    </div>
  );
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="row small muted" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  icon = '◻',
  action,
}: {
  title: string;
  body?: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="state-title">{title}</div>
      {body ? <div className="state-body">{body}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load this view',
  error,
  onRetry,
  children,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'The request could not be completed.';
  return (
    <div className="state-block state-error" role="alert">
      <div className="state-icon" aria-hidden="true">
        ⚠
      </div>
      <div className="state-title">{title}</div>
      <div className="state-body">{children ?? message}</div>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- layout */

export function Tabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: { id: string; label: string; badge?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const baseId = useId();
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight') onChange(tabs[(idx + 1) % tabs.length].id);
    if (e.key === 'ArrowLeft') onChange(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    if (e.key === 'Home') onChange(tabs[0].id);
    if (e.key === 'End') onChange(tabs[tabs.length - 1].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${baseId}-${t.id}-tab`}
          aria-selected={t.id === active}
          aria-controls={`${baseId}-${t.id}-panel`}
          tabIndex={t.id === active ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge ? <span style={{ marginLeft: 6 }}>{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ children, id, labelledBy }: { children: ReactNode; id: string; labelledBy: string }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${labelledBy}-tab`} className="stack" style={{ paddingTop: 12 }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- tables */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function DataTable<T>({
  columns,
  rows,
  caption,
  onRowClick,
  rowKey,
  emptyLabel = 'No records',
  sortable,
}: {
  columns: Column<T>[];
  rows: T[];
  caption?: string;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  emptyLabel?: string;
  sortable?: { key: string; onSort: (key: string) => void; active: string; direction: 'asc' | 'desc' };
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyLabel} body="No rows match the current filters." icon="≡" />;
  }
  return (
    <div className="table-wrap">
      <table className="data">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                aria-sort={
                  sortable?.active === c.key ? (sortable.direction === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {sortable && c.key !== 'actions' ? (
                  <button type="button" className="link-btn" onClick={() => sortable.onSort(c.key)}>
                    {c.header}
                    {sortable.active === c.key ? (sortable.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- filters */

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="glass card-tight row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- modals */

export function GlassModal({
  open,
  title,
  onClose,
  children,
  wide = false,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 14 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function GlassDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="scrim drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <GlassModal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="small muted">{body}</div>
    </GlassModal>
  );
}

/** Focus trap, Escape handling and focus restoration for modal surfaces. */
function useDialogBehavior(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose, ref]);
}

/* -------------------------------------------------------------------- toasts */

export function ToastStack() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div className="grow">
            <div style={{ fontWeight: 620 }}>{t.title}</div>
            {t.body ? <div className="small muted">{t.body}</div> : null}
          </div>
          <button type="button" className="link-btn tiny" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- search */

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search by ULPIN / Survey / Owner / Village',
  busy = false,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  busy?: boolean;
  id?: string;
}) {
  return (
    <form
      className="searchbar"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <label className="sr-only" htmlFor={id ?? 'global-search'}>
        Search parcels
      </label>
      <span aria-hidden="true" className="muted">
        ⌕
      </span>
      <input
        id={id ?? 'global-search'}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <button type="submit" className="btn btn-sm btn-primary">
        Search
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ findings */

export function FindingCard({
  finding,
  onOpenEvidence,
  actions,
}: {
  finding: {
    findingId: string;
    ruleCode: string;
    severity: Severity;
    confidence: number;
    title: string;
    description: string;
    expectedValue: string | null;
    observedValue: string | null;
    routedAuthority: string;
    recommendedAction: string;
    status: string;
    evidence?: unknown[];
  };
  onOpenEvidence?: () => void;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`finding-card finding-${finding.severity}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
            <SeverityBadge severity={finding.severity} />
            <span className="badge badge-neutral mono">{finding.ruleCode}</span>
            <StatusBadge status={finding.status} />
            <span className="tiny muted">confidence {finding.confidence.toFixed(2)}</span>
          </div>
          <div style={{ fontWeight: 620, marginTop: 6 }}>{finding.title}</div>
        </div>
        {actions}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        {finding.description}
      </p>
      <div className="row" style={{ gap: 8, marginTop: 7 }}>
        <button type="button" className="link-btn tiny" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide detail' : 'Show detail'}
        </button>
        {onOpenEvidence && finding.evidence && finding.evidence.length > 0 ? (
          <button type="button" className="link-btn tiny" onClick={onOpenEvidence}>
            Evidence ({finding.evidence.length})
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="grid grid-2" style={{ marginTop: 9, gap: 10 }}>
          <div className="glass-inset" style={{ padding: 9 }}>
            <div className="label">Observed</div>
            <div className="small mono">{finding.observedValue ?? '—'}</div>
          </div>
          <div className="glass-inset" style={{ padding: 9 }}>
            <div className="label">Expected</div>
            <div className="small mono">{finding.expectedValue ?? '—'}</div>
          </div>
          <div className="glass-inset" style={{ padding: 9 }}>
            <div className="label">Routed authority</div>
            <div className="small">{finding.routedAuthority}</div>
          </div>
          <div className="glass-inset" style={{ padding: 9 }}>
            <div className="label">Recommended action</div>
            <div className="small">{finding.recommendedAction}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EvidenceCard({
  evidence,
  defaultOpen = false,
}: {
  evidence: {
    evidenceId: string;
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
  };
  defaultOpen?: boolean;
}) {
  return (
    <details className="evidence-card" open={defaultOpen}>
      <summary>
        <span className="mono tiny">{evidence.field}</span>
        <DataStatusChip status={evidence.dataStatus} short />
        <span className="grow truncate tiny muted">{evidence.source}</span>
      </summary>
      <div className="evidence-body">
        <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
          <div>
            <div className="label">Observed value</div>
            <div className="small mono">{evidence.observedValue ?? '—'}</div>
          </div>
          <div>
            <div className="label">Expected value</div>
            <div className="small mono">{evidence.expectedValue ?? '—'}</div>
          </div>
        </div>
        {/* The evidence chain, kept visible so provenance is never implicit. */}
        <div className="chain">
          <div className="chain-step">
            <b>Finding</b>
            <span>{evidence.field} comparison</span>
          </div>
          <div className="chain-step">
            <b>Evidence</b>
            <span className="mono tiny">{evidence.evidenceId.slice(0, 18)}…</span>
          </div>
          <div className="chain-step">
            <b>Source</b>
            <span>{evidence.source}</span>
          </div>
          <div className="chain-step">
            <b>Record</b>
            <span className="mono tiny">
              {evidence.recordTable} · {evidence.recordId.slice(0, 22)}
            </span>
          </div>
          <div className="chain-step">
            <b>Authority</b>
            <span>{evidence.sourceAuthority}</span>
          </div>
        </div>
        <div className="tiny muted">
          Observed {evidence.observedAt ? formatDate(evidence.observedAt) : 'in available dataset'}
          {typeof evidence.confidence === 'number' ? ` · confidence ${evidence.confidence.toFixed(2)}` : ''}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ timeline */

export function Timeline({
  events,
  emptyLabel = 'No timeline events recorded for this parcel yet.',
}: {
  events: {
    at: string;
    kind: string;
    title: string;
    description: string;
    source: string;
    actor: string;
    dataStatus: DataStatus;
    visibility: string;
  }[];
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return <EmptyState title="No timeline events" body={emptyLabel} icon="◷" />;
  }
  return (
    <ol className="timeline" aria-label="Parcel timeline">
      {events.map((e, i) => (
        <li key={`${e.kind}-${e.at}-${i}`} className={`timeline-item ${e.visibility === 'INTERNAL' ? 'internal' : ''}`}>
          <div className="timeline-at">{formatDateTime(e.at)}</div>
          <div className="timeline-title">{e.title}</div>
          <div className="timeline-body">{e.description}</div>
          <div className="chip-row" style={{ marginTop: 4 }}>
            <span className="badge badge-neutral">{e.kind.replace(/_/g, ' ')}</span>
            <DataStatusChip status={e.dataStatus} short />
            <span className="tiny muted">
              {e.source} · {e.actor}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------- case */

export function CaseCard({
  item,
  onOpen,
}: {
  item: {
    case_id: string;
    case_number: string;
    parcel_id: string;
    title: string;
    status: string;
    priority: string;
    assigned_department: string | null;
    assigned_role: string | null;
    created_at: string;
    due_date: string | null;
    display_id?: string;
    village?: string;
    district?: string;
  };
  onOpen: (caseId: string) => void;
}) {
  const priorityTone =
    item.priority === 'URGENT' ? 'danger' : item.priority === 'HIGH' ? 'warn' : item.priority === 'LOW' ? 'neutral' : 'info';
  return (
    <button
      type="button"
      className="glass card btn-ghost"
      onClick={() => onOpen(item.case_id)}
      style={{ textAlign: 'left', display: 'block', width: '100%' }}
    >
      <div className="row-between">
        <span className="mono tiny muted">{item.case_number}</span>
        <span className={`badge badge-${priorityTone}`}>{item.priority}</span>
      </div>
      <div style={{ fontWeight: 620, marginTop: 5 }} className="clamp-2">
        {item.title}
      </div>
      <div className="chip-row" style={{ marginTop: 7 }}>
        <StatusBadge status={item.status} />
        {item.display_id ? <span className="badge badge-neutral mono">{item.display_id}</span> : null}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {[item.village, item.district].filter(Boolean).join(', ') || item.parcel_id}
        {item.assigned_department ? ` · ${item.assigned_department}` : ' · unassigned'}
        {item.due_date ? ` · due ${formatDate(item.due_date)}` : ''}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------- helpers */

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatArea(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, 0)} sq.ft`;
}

/** Renders a value that may be masked by the role policy. */
export function MaskedValue({ value, masked }: { value: ReactNode; masked?: boolean }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span>
      {value}
      {masked ? <span className="badge badge-neutral tiny" style={{ marginLeft: 6 }}>masked</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ charts */

export function BarChart({
  data,
  tone = 'default',
  ariaLabel,
  max,
}: {
  data: { label: string; value: number; tone?: 'default' | 'warn' | 'danger' | 'ok' }[];
  tone?: 'default' | 'warn' | 'danger' | 'ok';
  ariaLabel: string;
  max?: number;
}) {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="chart" role="img" aria-label={ariaLabel}>
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="truncate muted" title={d.label}>
            {d.label.replace(/_/g, ' ')}
          </span>
          <span className="bar-track">
            <span
              className={`bar-fill ${(d.tone ?? tone) === 'default' ? '' : d.tone ?? tone}`}
              style={{ width: `${Math.max(2, (d.value / peak) * 100)}%` }}
            />
          </span>
          <span className="mono">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ColumnChart({
  data,
  ariaLabel,
}: {
  data: { label: string; value: number }[];
  ariaLabel: string;
}) {
  const peak = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="column-chart" role="img" aria-label={ariaLabel}>
      {data.map((d) => (
        <div className="column" key={d.label}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }} className="mono">
            {d.value}
          </div>
          <div className="column-bar" style={{ height: `${Math.max(2, (d.value / peak) * 84)}%` }} />
          <div className="column-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Explains why a section of data is empty — required for every empty surface. */
export function DataGapNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="notice notice-warn">
      <span aria-hidden="true">⚠</span>
      <div>
        <div style={{ fontWeight: 620, color: 'var(--text-primary)' }}>{title}</div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function ProvenanceNotice({ children, tone = 'demo' }: { children: ReactNode; tone?: 'demo' | 'context' | 'warn' }) {
  return (
    <div className={`notice notice-${tone}`}>
      <span aria-hidden="true">{tone === 'demo' ? '◇' : tone === 'context' ? '○' : '⚠'}</span>
      <div>{children}</div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    body: ReactNode;
    confirmLabel: string;
    destructive: boolean;
    resolve: ((ok: boolean) => void) | null;
  }>({ open: false, title: '', body: null, confirmLabel: 'Confirm', destructive: false, resolve: null });

  const confirm = useCallback(
    (opts: { title: string; body: ReactNode; confirmLabel?: string; destructive?: boolean }) =>
      new Promise<boolean>((resolve) =>
        setState({
          open: true,
          title: opts.title,
          body: opts.body,
          confirmLabel: opts.confirmLabel ?? 'Confirm',
          destructive: opts.destructive ?? false,
          resolve,
        }),
      ),
    [],
  );

  const dialog = useMemo(
    () => (
      <ConfirmDialog
        open={state.open}
        title={state.title}
        body={state.body}
        confirmLabel={state.confirmLabel}
        destructive={state.destructive}
        onCancel={() => {
          state.resolve?.(false);
          setState((s) => ({ ...s, open: false, resolve: null }));
        }}
        onConfirm={() => {
          state.resolve?.(true);
          setState((s) => ({ ...s, open: false, resolve: null }));
        }}
      />
    ),
    [state],
  );

  return { confirm, dialog };
}

export function FieldErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="notice notice-warn" style={{ listStyle: 'none', margin: 0, paddingLeft: 12 }} role="alert">
      {errors.map((e) => (
        <li key={e} className="small">
          {e}
        </li>
      ))}
    </ul>
  );
}

export function ActionButton({
  children,
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
