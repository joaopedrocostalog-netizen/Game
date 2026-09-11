import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
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

type ControlGlobal = typeof globalThis & { __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

const goalLabels: Record<WarGoal, string> = {
  territory: 'Território / fronteira',
  reparations: 'Reparações / concessões',
  regime: 'Mudança de regime',
  independence: 'Independência / libertação',
  defense: 'Defesa / restauração do status quo',
};

const terrainLabels: Record<string, string> = {
  plains: 'Planícies', hills: 'Colinas', mountains: 'Montanhas', coastal: 'Litoral', forest: 'Floresta', desert: 'Deserto', mixed: 'Terreno misto',
};

const outcomeLabels = {
  'attacker-advance': 'Avanço atacante',
  'defender-hold': 'Defesa sustentada',
  contested: 'Combate inconclusivo',
};

function SideList({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  return <div className="war-side-list">{ids.map((id) => <span key={id}>{names[id] ?? id}</span>)}</div>;
}

export function WarConsole({ entityId, entities, simulation, warState, onMobilize, onDeclareWar }: Props) {
  const targets = entities.filter((item) => item.id !== entityId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [goal, setGoal] = useState<WarGoal>('territory');
  const [territorialControl, setTerritorialControl] = useState<TerritorialControlState>(() => (globalThis as ControlGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ ?? { occupations: {}, battles: [] });
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const wars = warsForEntity(warState, entityId);
  const activeWars = wars.filter((war) => war.status === 'active');
  const mobilization = warState.mobilization[entityId] ?? 'none';
  const runtime = simulation.entities[entityId];

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<TerritorialControlState>;
      if (custom.detail) setTerritorialControl(custom.detail);
    };
    window.addEventListener('world-state-territorial-control', listener);
    return () => window.removeEventListener('world-state-territorial-control', listener);
  }, []);

  const controlledLocations = Object.values(territorialControl.occupations).filter((item) => item.controllerId === entityId && item.ownerId !== entityId).length;

  return <div className="war-console">
    <div className="context-kicker">Comando militar estratégico</div>
    <div className="war-readiness-grid">
      <div><span>Mobilização</span><strong>{mobilization === 'general' ? 'Geral' : mobilization === 'partial' ? 'Parcial' : 'Normal'}</strong></div>
      <div><span>Prontidão</span><strong>{runtime ? runtime.militaryReadiness.toFixed(1) : '—'}</strong></div>
      <div><span>Controle ocupado</span><strong>{controlledLocations}</strong></div>
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
      <p>Combate, ocupação e soberania são estados separados. Uma vitória local pode criar controle militar sem anexar automaticamente o território.</p>
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
          {war.fronts.map((front) => {
            const occupation = front.locationId ? territorialControl.occupations[front.locationId] : undefined;
            const battle = territorialControl.battles.find((item) => item.warId === war.id && item.frontId === front.id);
            const controllerName = occupation ? (names[occupation.controllerId] ?? occupation.controllerId) : 'controle original';
            return <div className="front-row" key={front.id}>
              <div><strong>{front.name}</strong><span>Intensidade {front.intensity.toFixed(0)}%</span></div>
              <div className="front-subline"><span>{terrainLabels[front.terrain ?? ''] ?? 'Terreno não mapeado'}</span><span>{front.operationalData ? 'Dados operacionais ativos' : 'Estimativa agregada'}</span></div>
              <div className="front-track"><i style={{ width: `${front.progress}%` }} /></div>
              <div className="front-power-grid">
                <div><span>Atacantes</span><b>{front.attackerPower.toFixed(1)}</b><small>{front.attackerFormations} formações • logística {front.attackerLogistics.toFixed(0)}</small></div>
                <div><span>Defensores</span><b>{front.defenderPower.toFixed(1)}</b><small>{front.defenderFormations} formações • logística {front.defenderLogistics.toFixed(0)}</small></div>
              </div>
              {occupation && <div className={`occupation-card ${occupation.contested ? 'contested' : occupation.controllerId !== occupation.ownerId ? 'occupied' : ''}`}>
                <div><span>Ocupação da location</span><b>{occupation.progress.toFixed(0)}%</b></div>
                <i><em style={{ width: `${occupation.progress}%` }} /></i>
                <small>Controle: {controllerName} • soberania permanece com {names[occupation.ownerId] ?? occupation.ownerId}</small>
              </div>}
              {battle && <div className="battle-result"><span>Último ciclo de batalha</span><b>{outcomeLabels[battle.outcome]}</b><small>poder {battle.attackerPower.toFixed(1)} × {battle.defenderPower.toFixed(1)} • intensidade {battle.intensity.toFixed(0)}%</small></div>}
            </div>;
          })}
        </div>;
      })}
    </div>

    <ArmyOperations entityId={entityId} year={simulation.date.year} simulation={simulation} warState={warState} />
  </div>;
}
