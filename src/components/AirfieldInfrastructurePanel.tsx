import React, { useEffect, useMemo, useState } from 'react';
import { locationsForYear } from '../data/territories';
import { airBaseNetworkState } from '../engine/airBaseNetwork';
import {
  abandonAirfield,
  airfieldInfrastructureState,
  effectiveLocationController,
  processAirfieldInfrastructure,
  startAirfieldProject,
  type AirfieldProjectType,
} from '../engine/airfieldInfrastructure';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import './airfield-infrastructure.css';

type Props = {
  entityId: string;
  simulation: SimulationState;
  territorialControl: TerritorialControlState;
};

function projectLabel(type: AirfieldProjectType, year: number) {
  if (type === 'forward-base') return year < 1914 ? 'Preparar campo de aviação' : year < 1945 ? 'Construir aeródromo avançado' : 'Construir base aérea avançada';
  if (type === 'expand') return year < 1945 ? 'Ampliar campo e oficinas' : 'Ampliar pista e capacidade';
  return year < 1945 ? 'Recuperar pista e instalações' : 'Reparar infraestrutura aérea';
}
function statusLabel(value: string) {
  if (value === 'completed') return 'CONCLUÍDO';
  if (value === 'cancelled') return 'CANCELADO';
  return 'EM OBRAS';
}
function conditionLabel(value: string) {
  if (value === 'critical') return 'CRÍTICA';
  if (value === 'damaged') return 'DANIFICADA';
  if (value === 'overloaded') return 'SOBRECARREGADA';
  if (value === 'strained') return 'PRESSIONADA';
  return 'OPERACIONAL';
}

export function AirfieldInfrastructurePanel({ entityId, simulation, territorialControl }: Props) {
  const [revision, setRevision] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [message, setMessage] = useState('');
  const locations = useMemo(() => locationsForYear(simulation.date.year), [simulation.date.year]);
  const names = useMemo(() => Object.fromEntries(locations.map((item) => [item.id, item.name])), [locations]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-airfield-infrastructure', refresh);
    window.addEventListener('world-state-air-base-network', refresh);
    return () => {
      window.removeEventListener('world-state-airfield-infrastructure', refresh);
      window.removeEventListener('world-state-air-base-network', refresh);
    };
  }, []);

  useEffect(() => {
    processAirfieldInfrastructure(simulation, territorialControl);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, territorialControl]);

  void revision;
  const infrastructure = airfieldInfrastructureState();
  const network = airBaseNetworkState();
  const bases = Object.values(network.bases).filter((base) => base.entityId === entityId);
  const baseLocationIds = new Set(bases.map((base) => base.locationId));
  const controlledLocations = locations.filter((location) => effectiveLocationController(location.id, simulation, territorialControl) === entityId);
  const buildable = controlledLocations.filter((location) => !baseLocationIds.has(location.id));
  const projects = infrastructure.projects.filter((item) => item.entityId === entityId).slice(0, 12);
  const captures = infrastructure.captures.filter((item) => item.toEntityId === entityId || item.fromEntityId === entityId).slice(0, 8);

  function begin(type: AirfieldProjectType, locationId: string) {
    const result = startAirfieldProject(entityId, locationId, type, simulation, territorialControl);
    if ('error' in result) setMessage(result.error ?? 'Projeto indisponível.');
    else setMessage(`${projectLabel(type, simulation.date.year)} iniciado.`);
    setRevision((value) => value + 1);
  }

  function abandon(locationId: string) {
    const result = abandonAirfield(entityId, locationId, simulation);
    if ('error' in result) setMessage(result.error ?? 'Não foi possível abandonar a base.');
    else setMessage('Aeródromo abandonado. Formações baseadas foram deslocadas para uma posição disponível quando possível.');
    setRevision((value) => value + 1);
  }

  return <section className="airfield-infrastructure-panel">
    <header className="airfield-infrastructure-heading">
      <div><span>INFRAESTRUTURA DE AERÓDROMOS</span><strong>CONSTRUÇÃO • EXPANSÃO • CAPTURA • RETIRADA</strong></div>
      <em>{bases.length} POSIÇÃO{bases.length === 1 ? '' : 'ÕES'} ATIVA{bases.length === 1 ? '' : 'S'}</em>
    </header>

    {simulation.date.year < 1794 && <div className="airfield-empty">A época ainda não permite uma rede aérea militar institucionalizada.</div>}

    {simulation.date.year >= 1794 && <>
      <div className="airfield-builder">
        <label>Localização sob controle
          <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>
            <option value="">Selecionar...</option>
            {buildable.map((location) => <option key={location.id} value={location.id}>{location.name} — {location.kind}</option>)}
          </select>
        </label>
        <button disabled={!selectedLocation} onClick={() => selectedLocation && begin('forward-base', selectedLocation)}>
          {projectLabel('forward-base', simulation.date.year).toUpperCase()}
        </button>
      </div>

      {!!bases.length && <div className="airfield-base-grid">
        {bases.map((base) => <article key={base.id} className={base.condition}>
          <div className="airfield-base-head"><div><b>{names[base.locationId] ?? base.locationId}</b><small>{base.basedFormationIds.length} formação(ões) baseada(s)</small></div><em>{conditionLabel(base.condition)}</em></div>
          <div className="airfield-base-stats">
            <span><small>Capacidade</small><b>{Math.round(base.capacity)}</b></span>
            <span><small>Pista</small><b>{Math.round(base.runwayCondition)}%</b></span>
            <span><small>Combustível</small><b>{Math.round(base.fuel)}%</b></span>
            <span><small>Infraestrutura</small><b>{Math.round(base.infrastructure)}%</b></span>
          </div>
          <div className="airfield-actions">
            <button onClick={() => begin('expand', base.locationId)}>{projectLabel('expand', simulation.date.year)}</button>
            <button disabled={base.runwayCondition >= 92} onClick={() => begin('repair', base.locationId)}>{projectLabel('repair', simulation.date.year)}</button>
            <button className="danger" onClick={() => abandon(base.locationId)}>ABANDONAR</button>
          </div>
        </article>)}
      </div>}

      {!!projects.length && <div className="airfield-projects">
        <strong>Obras e reformas recentes</strong>
        {projects.map((project) => {
          const duration = Math.max(1, project.completesAtElapsedDay - project.startedAtElapsedDay);
          const progress = project.status === 'completed' ? 100 : project.status === 'cancelled' ? 0 : Math.max(0, Math.min(100, (simulation.elapsedDays - project.startedAtElapsedDay) / duration * 100));
          return <div key={project.id} className={`airfield-project ${project.status}`}>
            <span><b>{projectLabel(project.type, simulation.date.year)}</b><small>{names[project.locationId] ?? project.locationId}</small></span>
            <div><i style={{ width: `${progress}%` }}/></div>
            <em>{statusLabel(project.status)}</em>
          </div>;
        })}
      </div>}

      {!!captures.length && <div className="airfield-captures">
        <strong>Mudanças de controle de infraestrutura</strong>
        {captures.map((capture) => <div key={capture.id}>
          <span><b>{names[capture.locationId] ?? capture.locationId}</b><small>{capture.fromEntityId} → {capture.toEntityId}</small></span>
          <em>BASE CAPTURADA</em>
        </div>)}
      </div>}
    </>}

    {message && <div className="airfield-message">{message}</div>}
    <small className="airfield-note">Projetos dependem do controle territorial atual. Se uma localização for perdida antes da conclusão, a obra é cancelada. Bases capturadas mudam de controlador com dano e estoques reduzidos; abandonar uma posição impede que ela reapareça automaticamente enquanto não houver nova construção.</small>
  </section>;
}
