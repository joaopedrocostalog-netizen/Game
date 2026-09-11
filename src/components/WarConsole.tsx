import React, { useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import {
  type MobilizationLevel,
  type WarGoal,
  type WarState,
  warsForEntity,
} from '../engine/war';
import { ArmyOperations } from './ArmyOperations';
import './war-console.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  onMobilize: (level: MobilizationLevel) => void;
  onDeclareWar: (targetId: string, goal: WarGoal) => void;
};

const goalLabels: Record<WarGoal, string> = {
  territory: 'Território / fronteira',
  reparations: 'Reparações / concessões',
  regime: 'Mudança de regime',
  independence: 'Independência / libertação',
  defense: 'Defesa / restauração do status quo',
};

function SideList({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  return <div className="war-side-list">{ids.map((id) => <span key={id}>{names[id] ?? id}</span>)}</div>;
}

export function WarConsole({ entityId, entities, simulation, warState, onMobilize, onDeclareWar }: Props) {
  const targets = entities.filter((item) => item.id !== entityId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [goal, setGoal] = useState<WarGoal>('territory');
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const wars = warsForEntity(warState, entityId);
  const activeWars = wars.filter((war) => war.status === 'active');
  const mobilization = warState.mobilization[entityId] ?? 'none';
  const runtime = simulation.entities[entityId];

  return <div className="war-console">
    <div className="context-kicker">Comando militar estratégico</div>
    <div className="war-readiness-grid">
      <div><span>Mobilização</span><strong>{mobilization === 'general' ? 'Geral' : mobilization === 'partial' ? 'Parcial' : 'Normal'}</strong></div>
      <div><span>Prontidão</span><strong>{runtime ? runtime.militaryReadiness.toFixed(1) : '—'}</strong></div>
      <div><span>Guerras ativas</span><strong>{activeWars.length}</strong></div>
    </div>

    <div className="war-mobilization-actions">
      <button className={mobilization === 'none' ? 'active' : ''} onClick={() => onMobilize('none')}>Normal</button>
      <button className={mobilization === 'partial' ? 'active' : ''} onClick={() => onMobilize('partial')}>Mobilização parcial</button>
      <button className={mobilization === 'general' ? 'active' : ''} onClick={() => onMobilize('general')}>Mobilização geral</button>
    </div>

    <div className="war-planner">
      <div className="context-kicker">Planejar conflito</div>
      <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
        {targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <select value={goal} onChange={(event) => setGoal(event.target.value as WarGoal)}>
        {Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button className="declare-war" disabled={!targetId} onClick={() => targetId && onDeclareWar(targetId, goal)}>Declarar guerra</button>
      <p>Alianças ativas podem convocar participantes automaticamente. A resolução usa prontidão, tecnologia, tesouro, estabilidade, mobilização e desgaste.</p>
    </div>

    <div className="war-list">
      <div className="context-kicker">Conflitos da entidade</div>
      {wars.length === 0 ? <div className="war-empty">Nenhum conflito armado registrado para esta entidade.</div> : wars.slice(0, 5).map((war) => {
        const playerOnAttack = war.attackers.includes(entityId);
        return <div className={`war-card ${war.status}`} key={war.id}>
          <div className="war-card-head"><strong>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</strong><span>{war.status === 'active' ? 'EM GUERRA' : war.victor === 'stalemate' ? 'IMPASSE' : 'ENCERRADA'}</span></div>
          <div className="war-goal">Objetivo: {goalLabels[war.goal]}</div>
          <div className="war-sides"><div><b>Atacantes</b><SideList ids={war.attackers} names={names} /></div><div><b>Defensores</b><SideList ids={war.defenders} names={names} /></div></div>
          <div className="war-score"><span>Defensores</span><div><i style={{ width: `${Math.max(2, Math.min(98, 50 + war.score / 2))}%` }} /></div><span>Atacantes</span></div>
          <div className="war-metrics">
            <span><b>{war.score.toFixed(1)}</b> saldo estratégico</span>
            <span><b>{playerOnAttack ? war.attackerSupport.toFixed(0) : war.defenderSupport.toFixed(0)}%</b> apoio de guerra</span>
            <span><b>{Math.round(war.elapsedDays)}</b> dias</span>
          </div>
          {war.fronts.map((front) => <div className="front-row" key={front.id}><div><strong>{front.name}</strong><span>Intensidade {front.intensity.toFixed(0)}%</span></div><div className="front-track"><i style={{ width: `${front.progress}%` }} /></div></div>)}
        </div>;
      })}
    </div>

    <ArmyOperations entityId={entityId} year={simulation.date.year} simulation={simulation} warState={warState} />
  </div>;
}
