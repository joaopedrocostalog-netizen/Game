import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import { airFormationsForEntity } from '../engine/airCampaign';
import {
  airBasesForEntity,
  airOperationalReach,
  airRangeKm,
  processAirBaseNetwork,
  startAirTransfer,
} from '../engine/airBaseNetwork';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './air-base-network.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

function band(value: number) {
  if (value < 20) return 'CRÍTICO';
  if (value < 40) return 'BAIXO';
  if (value < 65) return 'ADEQUADO';
  if (value < 85) return 'FORTE';
  return 'MUITO FORTE';
}
function conditionLabel(value: string) {
  if (value === 'critical') return 'CRÍTICA';
  if (value === 'damaged') return 'DANIFICADA';
  if (value === 'overloaded') return 'SOBRECARREGADA';
  if (value === 'strained') return 'PRESSIONADA';
  return 'OPERACIONAL';
}

export function AirBaseNetworkPanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const locations = useMemo(() => Object.fromEntries(locationsForYear(simulation.date.year).map((location) => [location.id, location])), [simulation.date.year]);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-base-network', refresh);
    window.addEventListener('world-state-air-campaign', refresh);
    return () => {
      window.removeEventListener('world-state-air-base-network', refresh);
      window.removeEventListener('world-state-air-campaign', refresh);
    };
  }, []);

  useEffect(() => {
    processAirBaseNetwork(simulation);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, simulation.date.year]);

  void revision;
  const formations = airFormationsForEntity(entityId);
  const bases = airBasesForEntity(entityId, simulation);
  const relevantWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  function transfer(formationId: string) {
    const target = destinations[formationId];
    if (!target) return;
    const result = startAirTransfer(formationId, target, simulation);
    if ('error' in result) setMessage(result.error ?? 'Transferência indisponível.');
    else setMessage('Transferência aérea iniciada. A formação ficará com prontidão reduzida ao chegar à nova base.');
    setRevision((value) => value + 1);
  }

  return <section className="air-base-network-panel">
    <header className="air-base-network-heading">
      <div><span>REDE DE BASES AÉREAS</span><strong>ALCANCE • COMBUSTÍVEL • CAPACIDADE • TRANSFERÊNCIA</strong></div>
      <em>{bases.length} BASE{bases.length === 1 ? '' : 'S'}</em>
    </header>

    {!bases.length && <div className="air-base-empty">Nenhuma infraestrutura aérea operacional está disponível para esta entidade nesta época.</div>}

    {!!bases.length && <div className="air-base-grid">
      {bases.map((base) => {
        const location = locations[base.locationId];
        const nominalSlots = Math.max(1, Math.round(base.capacity / 8));
        return <article key={base.id} className={`air-base-card ${base.condition}`}>
          <div className="air-base-card-head"><div><b>{location?.name ?? base.locationId}</b><small>{base.basedFormationIds.length}/{nominalSlots} formações baseadas</small></div><em>{conditionLabel(base.condition)}</em></div>
          <div className="air-base-stats">
            <span><small>Combustível</small><b>{band(base.fuel)}</b></span>
            <span><small>Pista</small><b>{band(base.runwayCondition)}</b></span>
            <span><small>Infraestrutura</small><b>{band(base.infrastructure)}</b></span>
            <span><small>Manutenção</small><b>{band(base.maintenanceSupport)}</b></span>
          </div>
        </article>;
      })}
    </div>}

    {!!formations.length && <div className="air-transfer-list">
      <strong>Formações e alcance operacional</strong>
      {formations.map((formation) => {
        const current = locations[formation.baseLocationId];
        const targets = bases.filter((base) => base.locationId !== formation.baseLocationId && base.condition !== 'critical');
        const fronts = relevantWars.flatMap((war) => war.fronts.map((front) => ({ war, front, reach: airOperationalReach(formation, front.locationId, simulation) })));
        return <article key={formation.id}>
          <div className="air-transfer-head">
            <span><b>{formation.name}</b><small>{current?.name ?? formation.baseLocationId} • alcance nominal ~{Math.round(airRangeKm(formation, simulation))} km</small></span>
            <em>{fronts.some((item) => item.reach.reachable) ? 'EM ALCANCE DE COMBATE' : relevantWars.length ? 'FORA DO ALCANCE DAS FRENTES' : 'SEM GUERRA ATIVA'}</em>
          </div>
          {!!fronts.length && <div className="air-reach-row">
            {fronts.slice(0, 6).map(({ war, front, reach }) => <span key={`${war.id}-${front.id}`} className={reach.reachable ? 'reachable' : 'unreachable'}>
              <b>{front.name}</b><small>{reach.reachable ? `${Math.round(reach.distanceKm)} km • alcance disponível` : `${Math.round(reach.distanceKm)} km • fora do alcance`}</small>
            </span>)}
          </div>}
          {!!targets.length && <div className="air-transfer-controls">
            <select value={destinations[formation.id] ?? ''} onChange={(event) => setDestinations((value) => ({ ...value, [formation.id]: event.target.value }))}>
              <option value="">Transferir para...</option>
              {targets.map((base) => <option key={base.id} value={base.locationId}>{locations[base.locationId]?.name ?? base.locationId} — {conditionLabel(base.condition)}</option>)}
            </select>
            <button disabled={!destinations[formation.id]} onClick={() => transfer(formation.id)}>TRANSFERIR</button>
          </div>}
        </article>;
      })}
    </div>}

    {message && <div className="air-base-message">{message}</div>}
    <small className="air-base-note">O alcance é calculado entre a base real da formação e a localização da frente. Combustível, condição da pista, sobrecarga e distância reduzem a eficiência operacional. As capacidades são índices de jogo derivados da infraestrutura e da época, não estatísticas históricas exatas.</small>
  </section>;
}
