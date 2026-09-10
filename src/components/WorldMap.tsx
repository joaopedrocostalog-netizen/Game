import React, { useEffect, useMemo, useRef, useState } from 'react';
import { locationsForYear } from '../data/territories';

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

type Props = {
  selectedName?: string;
  selectedEntityId?: string;
  year?: number;
  entityNames?: Record<string, string>;
  onSelectCountry: (name: string) => void;
  onSelectTerritory?: (entityId: string, locationName: string) => void;
  historicalLayerReady?: boolean;
};

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

function geometryToPath(geometry: Geometry) {
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates as number[][][]).map(ringToPath).join(' ');
  }
  return (geometry.coordinates as number[][][][])
    .flatMap((polygon) => polygon.map(ringToPath))
    .join(' ');
}

export function WorldMap({
  selectedName,
  selectedEntityId,
  year,
  entityNames = {},
  onSelectCountry,
  onSelectTerritory,
  historicalLayerReady = false,
}: Props) {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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

  const features = useMemo(() => data?.features ?? [], [data]);
  const temporalLocations = useMemo(() => locationsForYear(effectiveYear), [effectiveYear]);

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

      {!historicalLayerReady && (
        <div className="historical-status">Geografia real ativa • locations temporais em integração • fronteiras políticas históricas completas pendentes</div>
      )}

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
              return (
                <path
                  key={`${name}-${index}`}
                  d={geometryToPath(feature.geometry)}
                  className={selected ? 'country-shape selected' : 'country-shape'}
                  tabIndex={0}
                  aria-label={name}
                  onClick={() => onSelectCountry(name)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectCountry(name); }}
                >
                  <title>{name}</title>
                </path>
              );
            })}

            <g className="temporal-layer" aria-label={`Locations temporais de ${effectiveYear}`}>
              {temporalLocations.map((location) => {
                const [x, y] = project([location.lon, location.lat]);
                const active = location.ownerId === selectedEntityId;
                const ownerName = location.ownerId ? (entityNames[location.ownerId] ?? location.ownerId) : 'Desconhecido';
                return (
                  <g
                    key={location.id}
                    className={active ? 'territory-marker active' : 'territory-marker'}
                    transform={`translate(${x} ${y})`}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (location.ownerId && onSelectTerritory) onSelectTerritory(location.ownerId, location.name);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && location.ownerId && onSelectTerritory) onSelectTerritory(location.ownerId, location.name);
                    }}
                  >
                    <circle r={active ? 5.5 : 4} />
                    <circle className="marker-ring" r={active ? 9 : 7} />
                    <title>{location.name} • {ownerName} • confiança {location.confidence}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}
