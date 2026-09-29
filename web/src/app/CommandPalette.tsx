import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from './AppState';
import { api } from '../services/api';
import { useDebounced } from '../hooks/useAsync';
import type { SearchHit } from '../types/api';
import { RiskBadge } from '../components/ui';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/**
 * Keyboard command palette. Commands are the real navigation and workflow
 * actions; parcel search results navigate to the parcel intelligence workspace.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 300);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'map', label: 'Open map', hint: 'G H', run: () => navigate('/') },
      { id: 'parcels', label: 'Browse parcels', hint: 'G P', run: () => navigate('/parcels') },
      { id: 'intel', label: 'Open parcel intelligence', hint: 'G I', run: () => navigate('/intelligence') },
      { id: 'officer', label: 'Open officer dashboard', hint: 'G O', run: () => navigate('/officer') },
      { id: 'cases', label: 'Open case queue', hint: 'G C', run: () => navigate('/cases') },
      { id: 'new-case', label: 'Create verification case', hint: 'G N', run: () => navigate('/cases/new') },
      { id: 'analytics', label: 'Open analytics', hint: 'G A', run: () => navigate('/analytics') },
      { id: 'gateway', label: 'Open department gateway', hint: 'G W', run: () => navigate('/gateway') },
      { id: 'sources', label: 'Open data fabric / sources', hint: 'G S', run: () => navigate('/sources') },
      { id: 'studio', label: 'Open administrative studio', hint: 'G T', run: () => navigate('/studio') },
      { id: 'citizen', label: 'Open citizen services', hint: 'G Z', run: () => navigate('/citizen') },
      { id: 'health', label: 'System health', hint: 'G Y', run: () => navigate('/studio/health') },
    ],
    [navigate],
  );

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setActive(0);
      setHits([]);
      setSearchNote(null);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen || debounced.trim().length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    api
      .search(debounced, 6, controller.signal)
      .then((res) => {
        setHits(res.hits);
        setSearchNote(res.note);
      })
      .catch(() => {
        // Search failure inside the palette must not interrupt the user.
        setHits([]);
        setSearchNote('Search is temporarily unavailable. Navigation commands still work.');
      })
      .finally(() => setSearching(false));
    return () => controller.abort();
  }, [debounced, paletteOpen]);

  const items: { kind: 'command' | 'parcel'; id: string; node: React.ReactNode; run: () => void }[] = useMemo(() => {
    const list: { kind: 'command' | 'parcel'; id: string; node: React.ReactNode; run: () => void }[] = [];
    for (const c of filteredCommands) {
      list.push({
        kind: 'command',
        id: `cmd-${c.id}`,
        node: (
          <>
            <span>{c.label}</span>
            <span className="palette-hint">{c.hint}</span>
          </>
        ),
        run: c.run,
      });
    }
    for (const h of hits) {
      list.push({
        kind: 'parcel',
        id: `parcel-${h.parcelId}`,
        node: (
          <>
            <span className="row" style={{ gap: 8 }}>
              <span className="mono tiny">{h.displayId}</span>
              <span className="truncate">
                {h.village}, {h.district}
              </span>
            </span>
            <RiskBadge band={h.riskBand} score={h.score} />
          </>
        ),
        run: () => navigate(`/intelligence/${h.parcelId}`),
      });
    }
    return list;
  }, [filteredCommands, hits, navigate]);

  if (!paletteOpen) return null;

  const close = () => setPaletteOpen(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) {
        item.run();
        close();
      }
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search a parcel, or type a command…"
          aria-label="Search parcels or commands"
          aria-autocomplete="list"
          aria-controls="palette-list"
        />
        <div className="palette-list" id="palette-list" role="listbox" aria-label="Results">
          {searching ? (
            <div className="row small muted" style={{ padding: '10px 12px' }}>
              <span className="spinner" aria-hidden="true" /> Searching parcels…
            </div>
          ) : null}
          {items.length === 0 && !searching ? (
            <div className="small muted" style={{ padding: '12px' }}>
              No commands or parcels match “{query}”.
            </div>
          ) : null}
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className="palette-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                item.run();
                close();
              }}
            >
              {item.node}
            </button>
          ))}
        </div>
        {searchNote && hits.length > 0 ? (
          <div className="tiny muted" style={{ padding: '6px 12px', borderTop: '1px solid var(--border-soft)' }}>
            Structured search · provenanced parcel results
          </div>
        ) : null}
        <div className="tiny muted" style={{ padding: '7px 12px', borderTop: '1px solid var(--border-soft)' }}>
          ↑↓ navigate · Enter open · Esc close · ⌘K / Ctrl+K / “/” to open
        </div>
      </div>
    </div>
  );
}
