import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeojsonCollection, GeojsonFeature, LayerEntry, RiskBand, SpatialContext } from '../types/api';
import { formatArea, formatNumber } from '../components/ui';

export type BasemapId = 'dark-gis' | 'osm' | 'satellite' | 'bhuvan-lulc';

export interface Basemap {
  id: BasemapId;
  label: string;
  attribution: string;
  url: string | null;
  /** WMS layers use a different Leaflet layer type and are built on demand. */
  kind: 'xyz' | 'wms' | 'none';
  wmsLayers?: string;
  note?: string;
}

export const BASEMAPS: Basemap[] = [
  {
    id: 'dark-gis',
    label: 'Light GIS (Carto)',
    attribution: '© OpenStreetMap contributors © CARTO',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    kind: 'xyz',
    note: 'Neutral dark basemap intended for overlaying authoritative layers.',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    kind: 'xyz',
    note: 'Community-mapped context. Not a cadastral or ownership authority.',
  },
  {
    id: 'satellite',
    label: 'Satellite imagery',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    kind: 'xyz',
    note: 'Visual context only. Imagery never establishes ownership or legality.',
  },
  {
    id: 'bhuvan-lulc',
    label: 'Bhuvan LULC (context)',
    attribution: '© ISRO / NRSC Bhuvan',
    url: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    kind: 'wms',
    wmsLayers: 'lulc',
    note: 'Contextual land use / land cover from Bhuvan. If unreachable the map falls back and says so.',
  },
];

export const RISK_COLOURS: Record<RiskBand, string> = {
  VERIFIED: '#3fae7d',
  REVIEW: '#d9a13b',
  'HIGH RISK': '#d9605a',
};

interface MapViewProps {
  parcels: GeojsonCollection | null;
  selectedParcelId: string | null;
  onSelectParcel?: (parcelId: string) => void;
  basemap: BasemapId;
  onBasemapChange?: (id: BasemapId) => void;
  showParcels: boolean;
  showContext: boolean;
  context?: SpatialContext | null;
  flyTo?: { lat: number; lon: number; zoom?: number; nonce: number } | null;
  externalLayers?: LayerEntry[];
  heightClass?: string;
  extraOverlay?: React.ReactNode;
  onRegisterMap?: (map: L.Map | null) => void;
}

export function MapView({
  parcels,
  selectedParcelId,
  onSelectParcel,
  basemap,
  onBasemapChange,
  showParcels,
  showContext,
  context,
  flyTo,
  externalLayers,
  heightClass,
  extraOverlay,
  onRegisterMap,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.Layer | null>(null);
  const parcelLayerRef = useRef<L.GeoJSON | null>(null);
  const contextLayerRef = useRef<L.LayerGroup | null>(null);
  const externalRef = useRef<L.LayerGroup | null>(null);
  const [basemapIssue, setBasemapIssue] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /* ---------------------------------------------------------------- init */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [12.9716, 79.1587],
      zoom: 11,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      worldCopyJump: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    mapRef.current = map;
    setReady(true);
    onRegisterMap?.(map);

    // Keep tile sizing correct when panels resize the container.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      onRegisterMap?.(null);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ basemap */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const definition = BASEMAPS.find((b) => b.id === basemap);
    if (!definition) return;
    const previous = baseLayerRef.current;

    const fail = (label: string) => {
      // A missing basemap degrades to the neutral grid — never to a blank canvas.
      setBasemapIssue(
        `${label} is temporarily unavailable. Parcel geometry and governance layers remain fully operable on the fallback basemap.`,
      );
    };

    let layer: L.Layer | null = null;
    if (definition.kind === 'xyz' && definition.url) {
      const xyz = L.tileLayer(definition.url, {
        attribution: definition.attribution,
        maxZoom: 19,
        crossOrigin: true,
        errorTileUrl: '',
      });
      xyz.on('tileerror', () => fail(definition.label));
      layer = xyz;
    } else if (definition.kind === 'wms' && definition.url) {
      const wms = L.tileLayer.wms(definition.url, {
        layers: definition.wmsLayers ?? 'lulc',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: definition.attribution,
        opacity: 0.65,
      });
      wms.on('tileerror', () => fail(definition.label));
      layer = wms;
    }

    if (layer) {
      layer.addTo(map);
      if ('bringToBack' in layer && typeof layer.bringToBack === 'function') layer.bringToBack();
      baseLayerRef.current = layer;
      setBasemapIssue(null);
    }
    return () => {
      if (previous && map.hasLayer(previous)) map.removeLayer(previous);
    };
  }, [basemap, ready]);

  /* ------------------------------------------------------- parcel layer */
  const parcelStyle = useMemo(
    () => (feature?: GeoJSON.Feature) => {
      const f = feature as GeojsonFeature | undefined;
      const risk = (f?.properties?.risk ?? 'REVIEW') as RiskBand;
      const selected = f?.properties?.parcelId === selectedParcelId;
      return {
        color: selected ? '#7fe8de' : RISK_COLOURS[risk],
        weight: selected ? 3 : 1.4,
        opacity: selected ? 1 : 0.85,
        fillColor: RISK_COLOURS[risk],
        fillOpacity: selected ? 0.36 : 0.16,
        dashArray: undefined,
      };
    },
    [selectedParcelId],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (parcelLayerRef.current) {
      map.removeLayer(parcelLayerRef.current);
      parcelLayerRef.current = null;
    }
    if (!showParcels || !parcels) return;

    const layer = L.geoJSON(parcels as unknown as GeoJSON.GeoJsonObject, {
      style: parcelStyle as L.PathOptions | L.StyleFunction,
      onEachFeature: (feature, lyr) => {
        const props = (feature as GeojsonFeature).properties;
        const findings =
          props.findingCount > 0
            ? `<div style="margin-top:4px;color:#e9b06a">${props.findingCodes?.join(', ') ?? `${props.findingCount} finding(s)`}</div>`
            : '<div style="margin-top:4px;color:#7fd6a3">No integrity findings</div>';
        lyr.bindPopup(
          `<div style="min-width:210px">
             <div style="font-weight:650;letter-spacing:0.03em">${props.displayId}</div>
             <div style="font-size:11px;opacity:0.75">${props.parcelId} · survey ${props.surveyNumber ?? '—'}</div>
             <div style="font-size:11px;margin-top:4px">${props.village ?? ''}${props.district ? `, ${props.district}` : ''}</div>
             <div style="font-size:11px">${formatArea(props.areaSqft)}</div>
             ${findings}
             <div style="font-size:10px;margin-top:5px;opacity:0.6;border-top:1px solid rgba(255,255,255,0.14);padding-top:4px">
               Demonstration parcel · not an official government record
             </div>
           </div>`,
        );
        lyr.on('click', () => {
          const id = props.parcelId;
          if (id) onSelectParcel?.(id);
        });
        lyr.on('mouseover', () => (lyr as L.Path).setStyle({ weight: 2.6, fillOpacity: 0.3 }));
        lyr.on('mouseout', () => (lyr as L.Path).setStyle(parcelStyle(feature) as L.PathOptions));
      },
    });
    layer.addTo(map);
    parcelLayerRef.current = layer;

    // Fit to the demonstration extent only on the first paint of the layer.
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.35), { animate: false, maxZoom: 14 });
    }
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      parcelLayerRef.current = null;
    };
  }, [parcels, ready, showParcels, parcelStyle, onSelectParcel]);

  /* ------------------------------------------------------ context layer */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (contextLayerRef.current) {
      map.removeLayer(contextLayerRef.current);
      contextLayerRef.current = null;
    }
    if (!showContext || !context || context.unavailable) return;

    const group = L.layerGroup();
    const palette = { road: '#e3b341', building: '#9aa9bb', water: '#4aa3d6', amenity: '#7fd6a3', landuse: '#7a6fc0' };

    for (const r of context.roads ?? []) {
      if (r.geometry) {
        const g = L.geoJSON(r.geometry as GeoJSON.GeoJsonObject, {
          style: { color: palette.road, weight: 2.4, opacity: 0.85, fillOpacity: 0 },
        });
        g.bindTooltip(`${r.name ?? 'Unnamed road'}${r.highway ? ` · ${r.highway}` : ''}`, { sticky: true });
        g.addTo(group);
      }
    }
    for (const b of context.buildings ?? []) {
      if (b.geometry) {
        const g = L.geoJSON(b.geometry as GeoJSON.GeoJsonObject, {
          style: { color: palette.building, weight: 1, opacity: 0.7, fillColor: palette.building, fillOpacity: 0.22 },
        });
        g.addTo(group);
      }
    }
    for (const w of context.water ?? []) {
      if (w.geometry) {
        const g = L.geoJSON(w.geometry as GeoJSON.GeoJsonObject, {
          style: { color: palette.water, weight: 1.6, opacity: 0.9, fillColor: palette.water, fillOpacity: 0.3 },
        });
        g.bindTooltip(w.name ?? w.waterType, { sticky: true });
        g.addTo(group);
      }
    }
    for (const a of context.amenities ?? []) {
      // Amenity coordinates are not geometry objects; they ride on the tooltip.
      if (a.distanceM !== null && typeof (a as { lat?: number }).lat === 'number') {
        const latlng: L.LatLngExpression = [(a as unknown as { lat: number }).lat, (a as unknown as { lon: number }).lon];
        const marker = L.circleMarker(latlng, {
          radius: 5,
          color: palette.amenity,
          fillColor: palette.amenity,
          fillOpacity: 0.8,
        });
        marker.bindTooltip(a.name ?? a.category, { sticky: true });
        marker.addTo(group);
      }
    }
    for (const l of context.landuse ?? []) {
      if (l.geometry) {
        const g = L.geoJSON(l.geometry as GeoJSON.GeoJsonObject, {
          style: { color: palette.landuse, weight: 1, opacity: 0.5, fillOpacity: 0.1, dashArray: '3 3' },
        });
        g.addTo(group);
      }
    }

    group.addTo(map);
    contextLayerRef.current = group;
    return () => {
      if (map.hasLayer(group)) map.removeLayer(group);
      contextLayerRef.current = null;
    };
  }, [context, ready, showContext]);

  /* ----------------------------------------------------- external layers */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (externalRef.current) {
      map.removeLayer(externalRef.current);
      externalRef.current = null;
    }
    const group = L.layerGroup();
    const loaded = new Set<string>();

    for (const layer of externalLayers ?? []) {
      if (!layer.serviceUrl || layer.status === 'NOT_CONFIGURED' || layer.status === 'UPSTREAM_UNAVAILABLE') continue;
      if (loaded.has(layer.layerId)) continue;
      loaded.add(layer.layerId);
      if (layer.serviceType === 'WMS') {
        const wms = L.tileLayer.wms(layer.serviceUrl, {
          layers: layer.layerId,
          format: 'image/png',
          transparent: true,
          version: '1.1.1',
          attribution: layer.attribution,
          opacity: layer.defaultOpacity,
        });
        wms.addTo(group);
      } else if (layer.serviceType === 'XYZ') {
        L.tileLayer(layer.serviceUrl, { attribution: layer.attribution, opacity: layer.defaultOpacity }).addTo(group);
      }
    }
    group.addTo(map);
    externalRef.current = group;
    return () => {
      if (map.hasLayer(group)) map.removeLayer(group);
      externalRef.current = null;
    };
  }, [externalLayers, ready]);

  /* --------------------------------------------------------------- flyto */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lon], flyTo.zoom ?? 15, { duration: 0.85 });
  }, [flyTo]);

  /* -------------------------------------------------- selection emphasis */
  useEffect(() => {
    const layer = parcelLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.eachLayer((l) => {
      const f = (l as L.GeoJSON).feature as GeojsonFeature | undefined;
      if (!f) return;
      (l as L.Path).setStyle(parcelStyle(f as unknown as GeoJSON.Feature) as L.PathOptions);
    });
  }, [selectedParcelId, parcelStyle]);

  return (
    <div className={`map-shell ${heightClass ?? ''}`.trim()}>
      <div className="map-canvas" ref={containerRef} role="application" aria-label="Parcel map" />
      {!ready ? (
        <div className="state-block" style={{ position: 'absolute', inset: 0, zIndex: 600, border: 'none' }}>
          <span className="spinner spinner-lg" aria-hidden="true" />
          <div className="state-title">Initialising GIS engine</div>
        </div>
      ) : null}

      {onBasemapChange ? (
        <div className="map-toolbar top-right" role="group" aria-label="Basemap">
          <label className="sr-only" htmlFor="basemap-select">
            Basemap
          </label>
          <select
            id="basemap-select"
            className="select"
            style={{ minWidth: 168, fontSize: 11.5, padding: '5px 26px 5px 9px' }}
            value={basemap}
            onChange={(e) => onBasemapChange(e.target.value as BasemapId)}
          >
            {BASEMAPS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {basemapIssue ? (
        <div
          className="notice notice-warn"
          style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 550, maxWidth: 460 }}
          role="status"
        >
          <span aria-hidden="true">⚠</span>
          <div>{basemapIssue}</div>
        </div>
      ) : null}

      <div className="map-tool-legend" aria-label="Legend">
        <div className="label" style={{ marginBottom: 4 }}>
          Verification-support band
        </div>
        {(Object.keys(RISK_COLOURS) as RiskBand[]).map((band) => (
          <div className="legend-row" key={band}>
            <span className="legend-swatch" style={{ background: RISK_COLOURS[band], opacity: 0.55 }} />
            {band}
          </div>
        ))}
        {showContext && context && !context.unavailable ? (
          <>
            <div className="divider" style={{ margin: '7px 0' }} />
            <div className="label" style={{ marginBottom: 4 }}>
              Contextual (OSM)
            </div>
            <div className="legend-row">
              <span className="legend-swatch" style={{ background: '#e3b341' }} />
              Road
            </div>
            <div className="legend-row">
              <span className="legend-swatch" style={{ background: '#4aa3d6' }} />
              Water
            </div>
            <div className="legend-row">
              <span className="legend-swatch" style={{ background: '#9aa9bb' }} />
              Building
            </div>
          </>
        ) : null}
        <div className="divider" style={{ margin: '7px 0' }} />
        <div className="tiny muted">Internal verification-support indicator — not a legal determination.</div>
      </div>

      {extraOverlay}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

export function MapStatChips({
  parcels,
  findings,
  unlinked,
  highRisk,
  cases,
  datasetLabel,
}: {
  parcels: number;
  findings: number;
  unlinked: number;
  highRisk: number;
  cases: number;
  datasetLabel: string;
}) {
  const chips = [
    { label: 'Parcels', value: parcels },
    { label: 'Findings', value: findings },
    { label: 'High risk', value: highRisk },
    { label: 'Unlinked', value: unlinked },
    { label: 'Cases', value: cases },
  ];
  return (
    <div className="map-overlay-stats">
      <span className="overlay-chip" style={{ maxWidth: 150 }}>
        <b style={{ fontSize: 11 }}>{datasetLabel}</b>
        <span>Data mode</span>
      </span>
      {chips.map((c) => (
        <span className="overlay-chip" key={c.label}>
          <b>{formatNumber(c.value)}</b>
          <span>{c.label}</span>
        </span>
      ))}
    </div>
  );
}
