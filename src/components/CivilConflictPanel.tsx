import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import type { ArmyState } from '../engine/army';
import {
  civilFactionGoalLabel,
  civilFactionsForParent,
  processCivilConflict,
  regionalLoyaltyForEntity,
} from '../engine/civilConflict';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './civil-conflict.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onSimulationStateChange: (state: SimulationState) => void;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

function band(value: number) {
  if (value < 22) return 'BAIXA';
  if (value < 42) return 'LIMITADA';
  if (value < 62) return 'MODERADA';
  if (value < 82) return 'ALTA';
  return 'CRÍTICA';
}
function factionStatus(status: string) {
  if (status === 'active') return 'CONFLITO ATIVO';
  if (status === 'victorious') return 'ENTIDADE CONSOLIDADA';
  if (status === 'suppressed') return 'SUPRIMIDA';
  if (status === 'negotiated') return 'ACORDO NEGOCIADO';
  return 'LATENTE';
}

export function CivilConflictPanel({ entityId, entities, simulation, warState, armyState, territorialControl, onSimulationStateChange, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-civil-conflict', refresh);
    window.addEventListener('world-state-war-politics', refresh);
    window.addEventListener('world-state-national-morale', refresh);
    return () => {
      window.removeEventListener('world-state-civil-conflict', refresh);
      window.removeEventListener('world-state-war-politics', refresh);
      window.removeEventListener('world-state-national-morale', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processCivilConflict(simulation, warState, armyState, territorialControl, entities);
    if (result.changed) {
      onSimulationStateChange(result.simulation);
      onArmyStateChange(result.armyState);
      onWarStateChange(result.warState);
      Object.assign(territorialControl, result.territorialControl);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const locations = useMemo(() => new Map(locationsForYear(simulation.date.year).map((item) => [item.id, item])), [simulation.date.year]);
  const loyalties = regionalLoyaltyForEntity(entityId).sort((a, b) => a.loyalty - b.loyalty);
  const factions = civilFactionsForParent(entityId);
  const active = factions.filter((item) => item.status === 'active');
  const weakest = loyalties[0];
  const averageLoyalty = loyalties.length ? loyalties.reduce((sum, item) => sum + item.loyalty, 0) / loyalties.length : 100;

  return <section className="civil-conflict-panel">
    <header className="civil-conflict-heading">
      <div><span>FRAGMENTAÇÃO E CONFLITO INTERNO</span><strong>Lealdade regional, facções e guerras civis emergentes</strong></div>
      <em>{active.length ? `${active.length} RUPTURA${active.length > 1 ? 'S' : ''} ATIVA${active.length > 1 ? 'S' : ''}` : averageLoyalty < 48 ? 'COESÃO INTERNA FRÁGIL' : 'COESÃO SOB CONTROLE'}</em>
    </header>

    <div className="civil-conflict-summary">
      <span><small>Lealdade regional média</small><b>{band(averageLoyalty)}</b><i><em style={{ width: `${averageLoyalty}%` }}/></i></span>
      <span><small>Região mais vulnerável</small><b>{weakest ? locations.get(weakest.locationId)?.name ?? weakest.locationId : 'Sem dados'}</b><i><em style={{ width: `${weakest ? 100 - weakest.loyalty : 0}%` }}/></i></span>
      <span><small>Facções surgidas na campanha</small><b>{factions.length}</b></span>
    </div>

    <div className="civil-loyalty-list">
      {loyalties.slice(0, 6).map((item) => {
        const location = locations.get(item.locationId);
        return <article key={`${item.entityId}:${item.locationId}`}>
          <div><strong>{location?.name ?? item.locationId}</strong><span>{location?.kind ?? 'região'} • {location?.terrain ?? 'terreno não classificado'}</span></div>
          <div className="civil-loyalty-values"><b>Lealdade {band(item.loyalty)}</b><small>Dissidência {band(item.dissent)}</small></div>
          <i><em style={{ width: `${item.loyalty}%` }}/></i>
        </article>;
      })}
      {!loyalties.length && <div className="civil-conflict-empty">Esta entidade ainda não possui regiões temporais suficientes para calcular fragmentação territorial.</div>}
    </div>

    {!!factions.length && <div className="civil-faction-list">
      {factions.slice(0, 5).map((faction) => <article key={faction.id} className={faction.status === 'active' ? 'active' : ''}>
        <div className="civil-faction-title"><strong>{faction.name}</strong><em>{factionStatus(faction.status)}</em></div>
        <p>Objetivo: {civilFactionGoalLabel(faction.goal, simulation.date.year)}.</p>
        <div className="civil-faction-stats">
          <span><small>Apoio</small><b>{band(faction.support)}</b></span>
          <span><small>Coesão</small><b>{band(faction.cohesion)}</b></span>
          <span><small>Capacidade militar</small><b>{band(faction.militaryCapacity)}</b></span>
          <span><small>Território controlado</small><b>{faction.controlledLocationIds.length}</b></span>
        </div>
      </article>)}
    </div>}

    <small className="civil-conflict-note">Uma guerra civil só emerge quando fragmentação política, baixa autoridade e lealdade regional deterioram juntas. A facção recebe identidade própria na simulação, forças militares e controle efetivo de uma localização; a soberania histórica não muda automaticamente. O resultado do conflito determina se a ruptura é suprimida ou se a entidade emergente consegue sobreviver.</small>
  </section>;
}
