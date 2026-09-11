import React, { useMemo } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { coalitionCohesion, coalitionGoalsForWar } from '../engine/coalitionGoals';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './coalition-interests.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  territorialControl: TerritorialControlState;
};

function statusLabel(status: 'active' | 'satisfied' | 'frustrated') {
  if (status === 'satisfied') return 'Satisfeito';
  if (status === 'frustrated') return 'Frustrado';
  return 'Em disputa';
}

export function CoalitionInterestsPanel({ entityId, entities, simulation, warState, territorialControl }: Props) {
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const wars = warState.wars.filter((war) => war.attackers.includes(entityId) || war.defenders.includes(entityId)).slice(0, 4);
  if (!wars.length) return null;

  return <div className="coalition-interests-panel">
    <div className="coalition-interests-head"><span>OBJETIVOS DA COALIZÃO</span><strong>Interesses individuais dos beligerantes</strong></div>
    {wars.map((war) => {
      const side = war.attackers.includes(entityId) ? 'attacker' as const : 'defender' as const;
      const goals = coalitionGoalsForWar(war, simulation, territorialControl);
      const sideGoals = goals.filter((goal) => goal.side === side);
      const enemyGoals = goals.filter((goal) => goal.side !== side);
      const cohesion = coalitionCohesion(war, side, simulation, territorialControl);
      return <div className={`coalition-war-block ${war.status}`} key={war.id}>
        <div className="coalition-war-title"><div><b>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</b><span>{war.status === 'active' ? 'coalizão ativa' : 'acordo concluído'}</span></div><strong>{cohesion.cohesion.toFixed(0)}% coesão</strong></div>
        <div className="coalition-cohesion-track"><i style={{ width: `${cohesion.cohesion}%` }}/></div>
        <p>{cohesion.summary}</p>
        <div className="coalition-goal-columns">
          <div>
            <span className="coalition-side-label">Seu lado</span>
            {sideGoals.map((goal) => <div className={`coalition-goal-card status-${goal.status}`} key={goal.id}>
              <div><b>{names[goal.entityId] ?? goal.entityId}</b><em>{statusLabel(goal.status)}</em></div>
              <strong>{goal.label}</strong>
              <small>{goal.rationale}</small>
              <div className="coalition-goal-metrics"><span>Prioridade <b>{goal.priority.toFixed(0)}</b></span><span>Satisfação <b>{goal.satisfaction.toFixed(0)}%</b></span></div>
              <i><em style={{ width: `${goal.satisfaction}%` }}/></i>
            </div>)}
          </div>
          <div>
            <span className="coalition-side-label">Lado adversário</span>
            {enemyGoals.map((goal) => <div className={`coalition-goal-card enemy status-${goal.status}`} key={goal.id}>
              <div><b>{names[goal.entityId] ?? goal.entityId}</b><em>{statusLabel(goal.status)}</em></div>
              <strong>{goal.label}</strong>
              <div className="coalition-goal-metrics"><span>Prioridade <b>{goal.priority.toFixed(0)}</b></span><span>Satisfação <b>{goal.satisfaction.toFixed(0)}%</b></span></div>
              <i><em style={{ width: `${goal.satisfaction}%` }}/></i>
            </div>)}
          </div>
        </div>
        <div className="coalition-summary-row"><span>Membros avaliados <b>{cohesion.members}</b></span><span>Dissidentes <b>{cohesion.dissenters}</b></span><span>Satisfação média <b>{cohesion.averageSatisfaction.toFixed(0)}%</b></span></div>
      </div>;
    })}
  </div>;
}
