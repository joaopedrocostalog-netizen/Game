import React, { useEffect, useMemo, useRef, useState } from 'react';
import { locationsForYear } from '../data/territories';
import { areasForYear } from '../data/historicalAreas';
import type { TerritorialControlState } from '../engine/territorialControl';
import './world-map.css';

type Geometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

type Feature = {
  type: 'Feature';
  properties: { name?: string; ADMIN?: string; NAME?: string };
  geometry: Geometry;
};

type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

type ArmyMarker = {
  id: string;
  entityId: string;
  name: string;
  locationId: string;
  destinationId?: string;
  movementProgress: number;
  strength: number;
  order: string;
};

type Props = {
  selectedName?: string;
  selectedEntityId?: string;
  year?: number;
  entityNames?: Record<string, string>;
  onSelectCountry: (name: string) => void;
  onSelectTerritory?: (entityId: string, locationName: string) => void;
  historicalLayerReady?: boolean;
};

type ControlGlobal = typeof globalThis & { __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

const GEOJSON_URL = 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson';

function project([lon, lat]: number[]) {
  const x = ((lon + 180) / 360) * 1000;
  const y = ((90 - lat) / 180) * 500;
  return [x, y] as const;
}

function ringToPath(ring: number[][]) {
  return ring.map((coord, index) => {
    const [x, y] = project(coord);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + ' Z';
}

function areaPath(polygon: Array<[number, number]>) {
  return ringToPath(polygon.map(([lon, lat]) => [lon, lat]));
}

function geometryToPath(geometry: Geometry) {
  if (geometry.type === 'Polygon') return (geometry.coordinates as number[][][]).map(ringToPath).join(' ');
  return (geometry.coordinates as number[][][][]).flatMap((polygon) => polygon.map(ringToPath)).join(' ');
}

function colorIndex(id: string) {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
}

export function WorldMap({ selectedName, selectedEntityId, year, entityNames = {}, onSelectCountry, onSelectTerritory, historicalLayerReady = false }: Props) {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [armyMarkers, setArmyMarkers] = useState<ArmyMarker[]>([]);
  const [territorialControl, setTerritorialControl] = useState<TerritorialControlState>(() => (globalThis as ControlGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ ?? { occupations: {}, battles: [] });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const effectiveYear = year ?? (historicalLayerReady ? 2026 : 1500);

  useEffect(() => {
    let cancelled = false;
    fetch(GEOJSON_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Falha ao carregar geografia mundial');
        return response.json();
      })
      .then((json: FeatureCollection) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setError('Não foi possível carregar o mapa mundial.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ entityId: string; markers: ArmyMarker[] }>;
      if (custom.detail?.entityId === selectedEntityId) setArmyMarkers(custom.detail.markers ?? []);
    };
    window.addEventListener('world-state-armies', listener);
    return () => window.removeEventListener('world-state-armies', listener);
  }, [selectedEntityId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<TerritorialControlState>;
      if (custom.detail) setTerritorialControl(custom.detail);
    };
    window.addEventListener('world-state-territorial-control', listener);
    return () => window.removeEventListener('world-state-territorial-control', listener);
  }, []);

  useEffect(() => { setArmyMarkers([]); }, [selectedEntityId, effectiveYear]);

  const features = useMemo(() => data?.features ?? [], [data]);
  const temporalLocations = useMemo(() => locationsForYear(effectiveYear), [effectiveYear]);
  const locationById = useMemo(() => Object.fromEntries(temporalLocations.map((location) => [location.id, location])), [temporalLocations]);
  const historicalAreas = useMemo(() => historicalLayerReady ? [] : areasForYear(effectiveYear), [effectiveYear, historicalLayerReady]);

  function countryName(feature: Feature) {
    return feature.properties.name || feature.properties.ADMIN || feature.properties.NAME || 'Entidade';
  }

  function zoomBy(delta: number) {
    setZoom((value) => Math.max(1, Math.min(4, Number((value + delta).toFixed(2)))));
  }

  return (
    <div className="geo-map-wrap">
      <div className="map-zoom-controls" aria-label="Controles de zoom do mapa">
        <button type="button" onClick={() => zoomBy(.35)}>+</button>
        <button type="button" onClick={() => zoomBy(-.35)}>−</button>
        <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>⟳</button>
      </div>

      {!historicalLayerReady && <div className="historical-status">Camada política histórica experimental • áreas esquemáticas + locations temporais • controle militar dinâmico separado da soberania</div>}

      {error ? <div className="map-loading error">{error}</div> : !data ? <div className="map-loading">Carregando geografia mundial…</div> : (
        <svg
          className="geo-map"
          viewBox="0 0 1000 500"
          role="img"
          aria-label="Mapa mundial interativo"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || zoom <= 1) return;
            const dx = (event.clientX - drag.current.x) / zoom;
            const dy = (event.clientY - drag.current.y) / zoom;
            setOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy });
          }}
          onPointerUp={(event) => {
            drag.current = null;
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
          }}
        >
          <rect width="1000" height="500" className="ocean" />
          <g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
            {features.map((feature, index) => {
              const name = countryName(feature);
              const selected = selectedName?.toLowerCase() === name.toLowerCase();
              return <path
                key={`${name}-${index}`}
                d={geometryToPath(feature.geometry)}
                className={`${selected ? 'country-shape selected' : 'country-shape'} ${historicalLayerReady ? '' : 'geography-only'}`}
                tabIndex={historicalLayerReady ? 0 : -1}
                aria-label={name}
                onClick={() => { if (historicalLayerReady) onSelectCountry(name); }}
                onKeyDown={(event) => { if (historicalLayerReady && (event.key === 'Enter' || event.key === ' ')) onSelectCountry(name); }}
              ><title>{historicalLayerReady ? name : `${name} • geografia-base contemporânea, não fronteira histórica`}</title></path>;
            })}

            {!historicalLayerReady && <g className="historical-area-layer" aria-label={`Áreas políticas esquemáticas de ${effectiveYear}`}>
              {historicalAreas.map((area) => {
                const active = area.entityId === selectedEntityId;
                const ownerName = entityNames[area.entityId] ?? area.name;
                return <path
                  key={area.id}
                  d={areaPath(area.polygon)}
                  className={`historical-area color-${colorIndex(area.entityId)} ${active ? 'active' : ''} confidence-${area.confidence}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${ownerName}, ${area.name}`}
                  onClick={(event) => { event.stopPropagation(); onSelectTerritory?.(area.entityId, area.name); }}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectTerritory?.(area.entityId, area.name); }}
                ><title>{ownerName} • {area.name} • confiança {area.confidence} • {area.note}</title></path>;
              })}
            </g>}

            <g className="temporal-layer" aria-label={`Locations temporais de ${effectiveYear}`}>
              {temporalLocations.map((location) => {
                const [x, y] = project([location.lon, location.lat]);
                const occupation = territorialControl.occupations[location.id];
                const effectiveController = occupation?.controllerId ?? location.controllerId ?? location.ownerId;
                const active = effectiveController === selectedEntityId || location.ownerId === selectedEntityId;
                const ownerName = location.ownerId ? (entityNames[location.ownerId] ?? location.ownerId) : 'Desconhecido';
                const controllerName = effectiveController ? (entityNames[effectiveController] ?? effectiveController) : ownerName;
                const occupied = !!occupation && occupation.controllerId !== occupation.ownerId;
                const contested = !!occupation?.contested;
                const className = `territory-marker ${active ? 'active' : ''} ${occupied ? 'occupied' : ''} ${contested ? 'contested' : ''}`;
                return <g
                  key={location.id}
                  className={className}
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => { event.stopPropagation(); if (location.ownerId && onSelectTerritory) onSelectTerritory(location.ownerId, location.name); }}
                  onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && location.ownerId && onSelectTerritory) onSelectTerritory(location.ownerId, location.name); }}
                >
                  <circle r={active ? 5.5 : 4} />
                  <circle className="marker-ring" r={active ? 9 : 7} />
                  {occupation && occupation.progress > 0 && <circle className="occupation-ring" r={11} pathLength={100} strokeDasharray={`${occupation.progress} 100`} transform="rotate(-90)" />}
                  <title>{location.name} • soberania: {ownerName} • controle: {controllerName}{occupation ? ` • ocupação ${occupation.progress.toFixed(0)}% • batalhas ${occupation.battleCount}` : ''} • confiança ${location.confidence}</title>
                </g>;
              })}
            </g>

            <g className="army-map-layer" aria-label="Formações militares da entidade selecionada">
              {armyMarkers.map((army) => {
                const origin = locationById[army.locationId];
                if (!origin) return null;
                const destination = army.destinationId ? locationById[army.destinationId] : undefined;
                const [ox, oy] = project([origin.lon, origin.lat]);
                const [dx, dy] = destination ? project([destination.lon, destination.lat]) : [ox, oy];
                const ratio = Math.max(0, Math.min(1, army.movementProgress / 100));
                const x = ox + (dx - ox) * ratio;
                const y = oy + (dy - oy) * ratio;
                return <g key={army.id} className={`army-map-marker ${army.order === 'move' ? 'moving' : ''}`} transform={`translate(${x} ${y})`}>
                  {destination && <line className="army-route" x1={ox - x} y1={oy - y} x2={dx - x} y2={dy - y} />}
                  <rect x={-8} y={-6} width={16} height={12} rx={3} />
                  <text x={0} y={2.8} textAnchor="middle">⚔</text>
                  <circle className="army-strength-ring" r={10} />
                  <title>{army.name} • força {army.strength.toFixed(0)}%{destination ? ` • deslocando para ${destination.name}` : ` • ${origin.name}`}</title>
                </g>;
              })}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}
