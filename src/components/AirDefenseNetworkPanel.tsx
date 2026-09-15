import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import {
  airDefenseEraAvailable,
  airDefenseEraLabel,
  airDefenseNetworkCondition,
  airDefenseNodesForEntity,
  airDefenseSupport,
  electronicWarfareAvailable,
  electronicWarfareLabel,
  estimatedEnemyAirPicture,
  processAirDefenseNetwork,
  setAirDefensePosture,
  type AirDefensePosture,
} from '../engine/airDefenseNetwork';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './air-defense-network.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

const postures: { value: AirDefensePosture; label: string }[] = [
  { value: 'balanced', label: 'Rede equilibrada' },
  { value: 'early-warning', label: 'Priorizar alerta antecipado' },
  { value: 'base-defense', label: 'Priorizar defesa das bases' },
  { value: 'dispersed', label: 'Dispersão e sobrevivência da rede' },
];

function band(value: number) {
  if (value < 20) return 'MUITO LIMITADA';
  if (value < 40) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}
function conditionLabel(value: string) {
  if (value === 'limited') return 'REDE LIMITADA';
  if (value === 'developing') return 'REDE EM DESENVOLVIMENTO';
  if (value === 'effective') return 'REDE EFETIVA';
  return 'REDE INTEGRADA';
}
function confidenceLabel(value: number) {
  if (value < 30) return 'CONFIANÇA MUITO BAIXA';
  if (value < 50) return 'CONFIANÇA BAIXA';
  if (value < 72) return 'CONFIANÇA MODERADA';
  return 'CONFIANÇA ALTA';
}
function enemyEstimate(lower: number, upper: number) {
  const midpoint = (lower + upper) / 2;
  return band(midpoint);
}

export function AirDefenseNetworkPanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const locations = useMemo(() => Object.fromEntries(locationsForYear(simulation.date.year).map((location) => [location.id, location])), [simulation.date.year]);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-defense-network', refresh);
    window.addEventListener('world-state-air-base-network', refresh);
    return () => {
      window.removeEventListener('world-state-air-defense-network', refresh);
      window.removeEventListener('world-state-air-base-network', refresh);
    };
  }, []);

  useEffect(() => {
    processAirDefenseNetwork(simulation, warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, simulation.date.year, warState]);

  void revision;
  const available = airDefenseEraAvailable(simulation.date.year);
  const nodes = airDefenseNodesForEntity(entityId, simulation);
  const support = airDefenseSupport(entityId, simulation);
  const condition = airDefenseNetworkCondition(entityId, simulation);
  const enemyIds = new Set<string>();
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    if (war.attackers.includes(entityId)) war.defenders.forEach((id) => enemyIds.add(id));
    if (war.defenders.includes(entityId)) war.attackers.forEach((id) => enemyIds.add(id));
  }

  function changePosture(next: AirDefensePosture) {
    setAirDefensePosture(entityId, next);
    processAirDefenseNetwork(simulation, warState);
    const selected = postures.find((item) => item.value === next)?.label ?? next;
    setMessage(`Postura da rede alterada para ${selected}.`);
    setRevision((value) => value + 1);
  }

  return <section className="air-defense-network-panel">
    <header className="air-defense-network-heading">
      <div><span>DEFESA AÉREA E GUERRA ELETRÔNICA</span><strong>{airDefenseEraLabel(simulation.date.year)}</strong></div>
      <em>{available ? conditionLabel(condition) : 'INDISPONÍVEL NESTA ÉPOCA'}</em>
    </header>

    {!available && <div className="air-defense-network-empty">Nesta época ainda não existe uma rede de alerta e defesa aérea que justifique uma mecânica operacional independente.</div>}

    {available && <>
      <div className="air-defense-network-summary">
        <label>Postura da rede
          <select value={support.posture} onChange={(event) => changePosture(event.target.value as AirDefensePosture)}>
            {postures.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <span><small>Detecção e alerta</small><b>{band(support.sensor)}</b></span>
        <span><small>Coordenação de interceptação</small><b>{band(support.interception)}</b></span>
        <span><small>Defesa terrestre</small><b>{band(support.defense)}</b></span>
        <span><small>Prontidão da rede</small><b>{band(support.readiness)}</b></span>
        <span><small>Guerra eletrônica</small><b>{electronicWarfareAvailable(simulation.date.year) ? band(support.electronicWarfare) : 'AINDA INDISPONÍVEL'}</b></span>
      </div>

      <div className="air-defense-node-grid">
        <strong>Nós de alerta e defesa</strong>
        {!nodes.length && <small>Nenhum nó de defesa aérea operacional está disponível.</small>}
        {nodes.map((node) => <article key={node.id}>
          <div><b>{locations[node.locationId]?.name ?? node.locationId}</b><small>Cobertura aproximada: {Math.max(0, Math.round(node.coverageKm / 25) * 25).toLocaleString('pt-BR')} km</small></div>
          <span><small>Sensores</small><b>{band(node.sensorStrength)}</b></span>
          <span><small>Interceptação</small><b>{band(node.interceptionSupport)}</b></span>
          <span><small>Defesa local</small><b>{band(node.groundDefense)}</b></span>
          <span><small>Prontidão</small><b>{band(node.readiness)}</b></span>
        </article>)}
      </div>

      <div className="air-defense-enemy-picture">
        <strong>Quadro aéreo adversário — estimativas</strong>
        {!enemyIds.size && <small>Sem adversário aéreo ativo nesta campanha.</small>}
        {[...enemyIds].map((enemyId) => {
          const estimate = estimatedEnemyAirPicture(entityId, enemyId, simulation);
          return <article key={enemyId}>
            <div><b>{names[enemyId] ?? enemyId}</b><small>{confidenceLabel(estimate.confidence)}</small></div>
            <em>{enemyEstimate(estimate.lowerBound, estimate.upperBound)}</em>
          </article>;
        })}
      </div>

      <div className="air-defense-ew-note"><b>{electronicWarfareLabel(simulation.date.year)}</b><small>A interferência reduz parte da eficiência de detecção e da defesa adversária; ela não revela posições ou capacidades exatas.</small></div>
    </>}

    {message && <div className="air-defense-network-message">{message}</div>}
    <small className="air-defense-network-note">A rede representa sensores, observadores, comunicações, comando de interceptação, defesa antiaérea e contramedidas como abstrações de grande estratégia. Informações sobre o adversário aparecem como estimativas com incerteza, enquanto os valores internos permanecem ocultos ao jogador.</small>
  </section>;
}
