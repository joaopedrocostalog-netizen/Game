import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { ArmyState } from '../engine/army';
import {
  activeTruceBetween,
  claimsForEntity,
  evaluatePeaceOffer,
  postWarState,
  resetPostWarState,
  resolvePeaceOffer,
  revanchismForEntity,
  type PeaceTerm,
} from '../engine/peace';
import {
  type FrontOrder,
  type FrontPriority,
  type FrontSide,
  type MobilizationLevel,
  type WarGoal,
  type WarState,
  assignUnitToFront,
  clearUnitFrontAssignment,
  setFrontOrder,
  setFrontPriority,
  warsForEntity,
} from '../engine/war';
import { ArmyOperations } from './ArmyOperations';
import './war-console.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
  onMobilize: (level: MobilizationLevel) => void;
  onDeclareWar: (targetId: string, goal: WarGoal) => void;
};

const goalLabels: Record<WarGoal, string> = {
  territory: 'Território / fronteira', reparations: 'Reparações / concessões', regime: 'Mudança de regime', independence: 'Independência / libertação', defense: 'Defesa / restauração do status quo',
};
const terrainLabels: Record<string, string> = { plains: 'Planícies', hills: 'Colinas', mountains: 'Montanhas', coastal: 'Litoral', forest: 'Floresta', desert: 'Deserto', mixed: 'Terreno misto' };
const outcomeLabels = { 'attacker-advance': 'Avanço atacante', 'defender-hold': 'Defesa sustentada', contested: 'Combate inconclusivo' };
const priorityLabels: Record<FrontPriority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', main: 'Ofensiva principal' };
const orderLabels: Record<FrontOrder, string> = { defend: 'Defender', cautious: 'Avanço cauteloso', offensive: 'Ofensiva', breakthrough: 'Ruptura', reserve: 'Reserva', withdraw: 'Retirada organizada' };
const peaceLabels: Record<PeaceTerm, string> = {
  status_quo: 'Cessar-fogo / status quo',
  reparations: 'Reparações financeiras',
  limited_annexation: 'Anexação territorial limitada',
  recognition: 'Reconhecimento político',
};
const orderHints: Record<FrontOrder, string> = {
  defend: 'Menos perdas e maior resistência, mas pouco avanço.',
  cautious: 'Preserva organização e logística com avanço limitado.',
  offensive: 'Mais pressão e avanço, com consumo e baixas maiores.',
  breakthrough: 'Máxima concentração para romper a frente; alto custo e risco.',
  reserve: 'Reduz exposição e conserva força para outra fase da campanha.',
  withdraw: 'Cede terreno para preservar tropas e reorganizar a linha.',
};

type ControlGlobal = typeof globalThis & { __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

function SideList({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  return <div className="war-side-list">{ids.map((id) => <span key={id}>{names[id] ?? id}</span>)}</div>;
}

export function WarConsole({ entityId, entities, simulation, warState, armyState, territorialControl, onArmyStateChange, onWarStateChange, onMobilize, onDeclareWar }: Props) {
  const targets = entities.filter((item) => item.id !== entityId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [goal, setGoal] = useState<WarGoal>('territory');
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({});
  const [peaceDraft, setPeaceDraft] = useState<Record<string, PeaceTerm>>({});
  const [peaceMessage, setPeaceMessage] = useState<Record<string, string>>({});
  const [postWarRevision, setPostWarRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const wars = warsForEntity(warState, entityId);
  const mobilization = warState.mobilization[entityId] ?? 'none';
  const runtime = simulation.entities[entityId];
  const controlledLocations = Object.values(territorialControl.occupations).filter((item) => item.controllerId === entityId && item.ownerId !== entityId).length;
  const ownUnits = armyState.units.filter((unit) => unit.entityId === entityId);
  const truceWithTarget = targetId ? activeTruceBetween(entityId, targetId, simulation.elapsedDays) : undefined;
  const entityClaims = claimsForEntity(entityId);
  const revanchism = revanchismForEntity(entityId, simulation.elapsedDays);
  const postWar = postWarState();
  const entityPeaceHistory = postWar.peaceHistory.filter((memory) => memory.parties.includes(entityId)).slice(0, 4);

  useEffect(() => {
    const listener = () => setPostWarRevision((value) => value + 1);
    window.addEventListener('world-state-postwar', listener);
    return () => window.removeEventListener('world-state-postwar', listener);
  }, []);

  useEffect(() => {
    if (simulation.elapsedDays === 0 && warState.wars.length === 0) resetPostWarState();
  }, [simulation.date.year]);

  void postWarRevision;

  function sideForWar(war: WarState['wars'][number]): FrontSide | null {
    if (war.attackers.includes(entityId)) return 'attacker';
    if (war.defenders.includes(entityId)) return 'defender';
    return null;
  }

  function submitPeace(war: WarState['wars'][number], side: FrontSide) {
    const term = peaceDraft[war.id] ?? 'status_quo';
    const result = resolvePeaceOffer(warState, territorialControl, simulation, war.id, side, term);
    setPeaceMessage((current) => ({ ...current, [war.id]: result.message }));
    if (!result.accepted) return;

    Object.assign(simulation.entities, result.simulation.entities);
    Object.keys(territorialControl.occupations).forEach((key) => delete territorialControl.occupations[key]);
    Object.assign(territorialControl.occupations, result.territorialControl.occupations);
    const publishedControl: TerritorialControlState = {
      ...territorialControl,
      occupations: { ...territorialControl.occupations },
      battles: [...territorialControl.battles],
    };
    (globalThis as ControlGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ = publishedControl;
    window.dispatchEvent(new CustomEvent('world-state-territorial-control', { detail: publishedControl }));
    onWarStateChange(result.warState);
  }

  return <div className="war-console">
    <div className="context-kicker">Comando militar estratégico</div>
    <div className="war-readiness-grid">
      <div><span>Mobilização</span><strong>{mobilization === 'general' ? 'Geral' : mobilization === 'partial' ? 'Parcial' : 'Normal'}</strong></div>
      <div><span>Prontidão</span><strong>{runtime ? runtime.militaryReadiness.toFixed(1) : '—'}</strong></div>
      <div><span>Revanchismo</span><strong>{revanchism.toFixed(0)}%</strong></div>
    </div>
    <div className="war-mobilization-actions">
      <button className={mobilization === 'none' ? 'active' : ''} onClick={() => onMobilize('none')}>Normal</button>
      <button className={mobilization === 'partial' ? 'active' : ''} onClick={() => onMobilize('partial')}>Mobilização parcial</button>
      <button className={mobilization === 'general' ? 'active' : ''} onClick={() => onMobilize('general')}>Mobilização geral</button>
    </div>
    <div className="war-planner">
      <div className="context-kicker">Planejar conflito</div>
      <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={goal} onChange={(event) => setGoal(event.target.value as WarGoal)}>{Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="declare-war" disabled={!targetId || !!truceWithTarget} onClick={() => targetId && !truceWithTarget && onDeclareWar(targetId, goal)}>Declarar guerra</button>
      {truceWithTarget ? <div className="truce-warning"><b>Trégua em vigor</b><span>{Math.max(0, truceWithTarget.expiresAtElapsedDay - simulation.elapsedDays)} dias restantes com {names[targetId] ?? targetId}. Nova guerra bloqueada enquanto o acordo vigorar.</span></div> : <p>Prioridade decide onde concentrar recursos. Ordem operacional decide como a frente luta: cautela, defesa, ofensiva, ruptura, reserva ou retirada.</p>}
    </div>
    {(entityClaims.length > 0 || entityPeaceHistory.length > 0) && <div className="postwar-box">
      <div className="context-kicker">Pós-guerra e memória estratégica</div>
      <div className="postwar-summary"><span>Reivindicações ativas <b>{entityClaims.length}</b></span><span>Revanchismo <b>{revanchism.toFixed(0)}%</b></span><span>Territórios ocupados <b>{controlledLocations}</b></span></div>
      {entityClaims.length > 0 && <div className="claim-list">{entityClaims.slice(0, 5).map((claim) => <div key={claim.id}><b>{claim.locationId}</b><span>detido por {names[claim.holderId] ?? claim.holderId} • força da reivindicação {claim.strength.toFixed(0)}%</span></div>)}</div>}
      {entityPeaceHistory.length > 0 && <div className="peace-memory-list">{entityPeaceHistory.map((memory) => <div key={memory.id}><span>Tratado após {memory.warId}</span><b>{peaceLabels[memory.term]}</b></div>)}</div>}
    </div>}
    <div className="war-list">
      <div className="context-kicker">Conflitos da entidade</div>
      {wars.length === 0 ? <div className="war-empty">Nenhum conflito armado registrado para esta entidade.</div> : wars.slice(0, 5).map((war) => {
        const side = sideForWar(war);
        const term = peaceDraft[war.id] ?? 'status_quo';
        const peaceEvaluation = side ? evaluatePeaceOffer(war, side, term, territorialControl) : null;
        return <div className={`war-card ${war.status}`} key={war.id}>
          <div className="war-card-head"><strong>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</strong><span>{war.status === 'active' ? 'EM GUERRA' : war.victor === 'stalemate' ? 'IMPASSE' : 'ENCERRADA'}</span></div>
          <div className="war-goal">Objetivo: {goalLabels[war.goal]} • {war.fronts.length} frente(s)</div>
          <div className="war-sides"><div><b>Atacantes</b><SideList ids={war.attackers} names={names}/></div><div><b>Defensores</b><SideList ids={war.defenders} names={names}/></div></div>
          <div className="war-score"><span>Defensores</span><div><i style={{ width: `${Math.max(2, Math.min(98, 50 + war.score / 2))}%` }}/></div><span>Atacantes</span></div>
          {side && war.status === 'active' && peaceEvaluation && <div className="peace-box">
            <div className="context-kicker">Negociação de paz</div>
            <div className="peace-controls"><select value={term} onChange={(event) => setPeaceDraft((current) => ({ ...current, [war.id]: event.target.value as PeaceTerm }))}>{Object.entries(peaceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button disabled={!peaceEvaluation.eligible} onClick={() => submitPeace(war, side)}>Propor termos</button></div>
            <div className="peace-estimate"><span>Aceitação estimada</span><b>{peaceEvaluation.acceptance.toFixed(0)}%</b><small>alavancagem {peaceEvaluation.leverage.toFixed(0)} • locations ocupadas elegíveis {peaceEvaluation.occupiedLocations}</small></div>
            <p>{peaceEvaluation.reason}</p>
            {peaceMessage[war.id] && <div className="peace-result">{peaceMessage[war.id]}</div>}
          </div>}
          {war.fronts.map((front) => {
            const occupation = front.locationId ? territorialControl.occupations[front.locationId] : undefined;
            const battle = territorialControl.battles.find((item) => item.warId === war.id && item.frontId === front.id);
            const priority = side === 'attacker' ? front.attackerPriority : side === 'defender' ? front.defenderPriority : 'normal';
            const operation = side === 'attacker' ? front.attackerOrder : side === 'defender' ? front.defenderOrder : 'cautious';
            const assignments = side === 'attacker' ? front.attackerAssignments : side === 'defender' ? front.defenderAssignments : [];
            const assignedUnits = ownUnits.filter((unit) => assignments.includes(unit.id));
            const draftKey = `${war.id}:${front.id}`;
            return <div className="front-row" key={front.id}>
              <div><strong>{front.name}</strong><span>Intensidade {front.intensity.toFixed(0)}%</span></div>
              <div className="front-subline"><span>{terrainLabels[front.terrain ?? ''] ?? 'Terreno não mapeado'}</span><span>{front.operationalData ? 'Dados operacionais ativos' : 'Estimativa agregada'}</span></div>
              {side && war.status === 'active' && <>
                <div className="front-command-grid">
                  <label><span>Prioridade</span><select value={priority} onChange={(event) => onWarStateChange(setFrontPriority(warState, war.id, front.id, side, event.target.value as FrontPriority))}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label><span>Ordem operacional</span><select value={operation} onChange={(event) => onWarStateChange(setFrontOrder(warState, war.id, front.id, side, event.target.value as FrontOrder))}>{Object.entries(orderLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label className="assignment-control"><span>Designar formação</span><div className="front-assignment-row"><select value={assignmentDraft[draftKey] ?? ''} onChange={(event) => setAssignmentDraft((current) => ({ ...current, [draftKey]: event.target.value }))}><option value="">Selecionar…</option>{ownUnits.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select><button disabled={!assignmentDraft[draftKey]} onClick={() => assignmentDraft[draftKey] && onWarStateChange(assignUnitToFront(warState, war.id, front.id, side, assignmentDraft[draftKey]))}>Fixar</button></div></label>
                </div>
                <div className={`front-order-hint order-${operation}`}><b>{orderLabels[operation]}</b><span>{orderHints[operation]}</span></div>
              </>}
              {assignedUnits.length > 0 && <div className="front-assigned-units">{assignedUnits.map((unit) => <button key={unit.id} title="Liberar para redistribuição automática" onClick={() => onWarStateChange(clearUnitFrontAssignment(warState, war.id, unit.id))}>{unit.name} ×</button>)}</div>}
              <div className="front-track"><i style={{ width: `${front.progress}%` }}/></div>
              <div className="front-power-grid"><div><span>Atacantes • {priorityLabels[front.attackerPriority]}</span><b>{front.attackerPower.toFixed(1)}</b><small>{front.attackerFormations} formações • {orderLabels[front.attackerOrder]} • logística {front.attackerLogistics.toFixed(0)}</small></div><div><span>Defensores • {priorityLabels[front.defenderPriority]}</span><b>{front.defenderPower.toFixed(1)}</b><small>{front.defenderFormations} formações • {orderLabels[front.defenderOrder]} • logística {front.defenderLogistics.toFixed(0)}</small></div></div>
              {occupation && <div className={`occupation-card ${occupation.contested ? 'contested' : occupation.controllerId !== occupation.ownerId ? 'occupied' : ''}`}><div><span>Ocupação da location</span><b>{occupation.progress.toFixed(0)}%</b></div><i><em style={{ width: `${occupation.progress}%` }}/></i><small>Controle: {names[occupation.controllerId] ?? occupation.controllerId} • soberania: {names[occupation.ownerId] ?? occupation.ownerId}</small></div>}
              {battle && <div className="battle-result"><span>Último ciclo de batalha</span><b>{outcomeLabels[battle.outcome]}</b><small>poder {battle.attackerPower.toFixed(1)} × {battle.defenderPower.toFixed(1)} • intensidade {battle.intensity.toFixed(0)}%</small></div>}
            </div>;
          })}
        </div>;
      })}
    </div>
    <ArmyOperations entityId={entityId} year={simulation.date.year} simulation={simulation} warState={warState} armyState={armyState} territorialControl={territorialControl} onArmyStateChange={onArmyStateChange}/>
  </div>;
}