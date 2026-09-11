import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  availableMilitaryReforms,
  peacetimeMilitaryReformState,
  processPeacetimeMilitaryReforms,
  startMilitaryReform,
  type MilitaryReformType,
} from '../engine/peacetimeMilitaryReforms';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './peacetime-military-reforms.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
};

export function PeacetimeMilitaryReformsPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-peacetime-military-reforms', refresh);
    return () => window.removeEventListener('world-state-peacetime-military-reforms', refresh);
  }, []);

  useEffect(() => {
    const result = processPeacetimeMilitaryReforms(simulation, armyState, warState);
    if (!result.changed) return;
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const state = peacetimeMilitaryReformState();
  const portfolio = state.portfolios[entityId];
  const active = state.reforms.find((reform) => reform.entityId === entityId && reform.status === 'active');
  const recent = state.reforms.filter((reform) => reform.entityId === entityId && reform.status === 'completed').slice(0, 5);
  const options = availableMilitaryReforms(entityId, simulation, warState);
  const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  function begin(type: MilitaryReformType) {
    const result = startMilitaryReform(entityId, type, simulation, warState);
    if (!result.reform) {
      setMessage(result.error ?? 'Não foi possível iniciar a reforma.');
      return;
    }
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setMessage(`${result.reform.label} entrou em implementação.`);
    setRevision((value) => value + 1);
  }

  return <section className="military-reforms-panel">
    <header className="military-reforms-heading">
      <div><span>REFORMAS MILITARES</span><strong>Transformar experiência de guerra em instituições permanentes</strong></div>
      <div className="military-reforms-capacity"><small>Capacidade institucional</small><b>{portfolio?.reformCapacity.toFixed(0) ?? 0}</b></div>
    </header>

    {atWar && <div className="military-reforms-warning">Reformas estruturais novas ficam suspensas durante guerra ativa. Reformas já concluídas continuam produzindo efeitos.</div>}

    {active && <div className="military-reform-active">
      <div className="military-reform-active-head"><div><b>{active.label}</b><span>{active.description}</span></div><strong>{active.progress.toFixed(0)}%</strong></div>
      <div className="military-reform-progress"><i style={{ width: `${active.progress}%` }}/></div>
      <small>Conclusão prevista no dia de campanha {active.completesAtElapsedDay}. Investimento já comprometido: {active.cost.toFixed(0)} pontos de tesouro.</small>
    </div>}

    <div className="military-reform-grid">
      {options.map((option) => <article className={`military-reform-option ${option.recommended ? 'recommended' : ''}`} key={option.type}>
        <div className="military-reform-option-head"><div><b>{option.label}</b><span>{option.description}</span></div><em>NÍVEL {option.completedLevel}/3</em></div>
        <div className="military-reform-meta"><span>Custo <b>{option.cost}</b></span><span>Duração <b>{option.duration} dias</b></span>{option.recommended && <span className="recommended-tag">RECOMENDADA</span>}</div>
        <button disabled={!option.available} onClick={() => begin(option.type)}>{option.available ? 'Iniciar reforma' : option.reason}</button>
      </article>)}
    </div>

    {!!recent.length && <div className="military-reform-history">
      <strong>Reformas institucionalizadas por {names[entityId] ?? entityId}</strong>
      {recent.map((reform) => <span key={reform.id}><b>{reform.label}</b> • concluída no dia {reform.completedAtElapsedDay}</span>)}
    </div>}

    {message && <div className="military-reform-message">{message}</div>}
    <small className="military-reform-note">As reformas possuem custos e trade-offs. Profissionalização melhora qualidade, mas exige mais recursos; mobilização em massa aumenta prontidão potencial, porém pode pressionar estabilidade e organização. A nomenclatura e a duração mudam conforme a época.</small>
  </section>;
}
