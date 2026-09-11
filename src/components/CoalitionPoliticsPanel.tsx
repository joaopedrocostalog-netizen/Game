import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  coalitionMemberDisposition,
  coalitionPoliticalHistory,
  defectCoalitionMember,
  demandCoalitionCompensation,
  grantCoalitionCompensation,
  resetCoalitionPolitics,
  signSeparatePeace,
  withdrawCoalitionMember,
} from '../engine/coalitionPolitics';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './coalition-politics.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onWarStateChange: (state: WarState) => void;
};

const statusLabels = {
  committed: 'Comprometido',
  uneasy: 'Inquieto',
  demanding: 'Exigente',
  'withdrawal-risk': 'Risco de saída',
  breakaway: 'Ruptura iminente',
};

export function CoalitionPoliticsPanel({ entityId, entities, simulation, warState, territorialControl, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const activeWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-coalition-politics', refresh);
    window.addEventListener('world-state-territorial-control', refresh);
    return () => {
      window.removeEventListener('world-state-coalition-politics', refresh);
      window.removeEventListener('world-state-territorial-control', refresh);
    };
  }, []);

  useEffect(() => {
    if (simulation.elapsedDays === 0 && warState.wars.length === 0) resetCoalitionPolitics();
  }, [simulation.date.year]);

  void revision;
  if (!activeWars.length) return null;

  function applySimulationSnapshot(next: SimulationState) {
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function setWarMessage(warId: string, text: string) {
    setMessage((current) => ({ ...current, [warId]: text }));
    setRevision((value) => value + 1);
  }

  function compensate(warId: string, memberId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const result = grantCoalitionCompensation(war, memberId, simulation, territorialControl);
    if (result.accepted) applySimulationSnapshot(result.simulation);
    setWarMessage(warId, result.message);
  }

  function demand(warId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const result = demandCoalitionCompensation(war, entityId, simulation, territorialControl);
    if (result.accepted) applySimulationSnapshot(result.simulation);
    setWarMessage(warId, result.message);
  }

  function withdraw(warId: string) {
    const result = withdrawCoalitionMember(warState, warId, entityId, simulation, territorialControl);
    if (result.accepted) {
      applySimulationSnapshot(result.simulation);
      onWarStateChange(result.warState);
    }
    setWarMessage(warId, result.message);
  }

  function separatePeace(warId: string) {
    const result = signSeparatePeace(warState, warId, entityId, simulation, territorialControl);
    if (result.accepted) {
      applySimulationSnapshot(result.simulation);
      onWarStateChange(result.warState);
    }
    setWarMessage(warId, result.message);
  }

  function defect(warId: string) {
    const result = defectCoalitionMember(warState, warId, entityId, simulation, territorialControl);
    if (result.accepted) {
      applySimulationSnapshot(result.simulation);
      onWarStateChange(result.warState);
    }
    setWarMessage(warId, result.message);
  }

  return <div className="coalition-politics-panel">
    <div className="coalition-politics-heading"><span>POLÍTICA DA COALIZÃO</span><strong>Lealdade, desgaste e risco de ruptura</strong></div>
    {activeWars.map((war) => {
      const side = war.attackers.includes(entityId) ? 'attacker' as const : 'defender' as const;
      const leaderId = side === 'attacker' ? war.attackerId : war.defenderId;
      const members = side === 'attacker' ? war.attackers : war.defenders;
      const isLeader = entityId === leaderId;
      const dispositions = members.map((memberId) => coalitionMemberDisposition(war, memberId, simulation, territorialControl)).filter(Boolean);
      const own = coalitionMemberDisposition(war, entityId, simulation, territorialControl);
      const history = coalitionPoliticalHistory(war.id).slice(0, 3);
      return <div className="coalition-politics-war" key={war.id}>
        <div className="coalition-politics-war-head"><div><b>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</b><span>Líder do seu lado: {names[leaderId] ?? leaderId}</span></div><strong>{isLeader ? 'LIDERANÇA' : statusLabels[own?.status ?? 'committed']}</strong></div>
        <div className="coalition-politics-members">{dispositions.map((item) => item && <div className={`coalition-politics-member status-${item.status}`} key={item.entityId}>
          <div className="coalition-politics-member-head"><b>{names[item.entityId] ?? item.entityId}</b><em>{statusLabels[item.status]}</em></div>
          <div className="coalition-politics-bars"><span>Lealdade <b>{item.loyalty.toFixed(0)}%</b></span><i><em style={{ width: `${item.loyalty}%` }}/></i><span>Desgaste <b>{item.warWeariness.toFixed(0)}%</b></span><i><em style={{ width: `${item.warWeariness}%` }}/></i></div>
          <div className="coalition-politics-metrics"><span>Satisfação <b>{item.satisfaction.toFixed(0)}</b></span><span>Confiança no líder <b>{item.leaderTrust.toFixed(0)}</b></span><span>Atração do adversário <b>{item.enemyAppeal.toFixed(0)}</b></span></div>
          <small>{item.reason}</small>
          {isLeader && item.entityId !== entityId && item.canDemandCompensation && <button onClick={() => compensate(war.id, item.entityId)}>Oferecer compensação</button>}
        </div>)}</div>

        {!isLeader && own && <div className="coalition-self-actions">
          <span>Opções da entidade controlada</span>
          <div>
            <button disabled={!own.canDemandCompensation} onClick={() => demand(war.id)}>Exigir compensação</button>
            <button disabled={!own.canWithdraw} onClick={() => withdraw(war.id)}>Abandonar coalizão</button>
            <button disabled={!own.canSeparatePeace} onClick={() => separatePeace(war.id)}>Paz separada</button>
            <button className="defect-action" disabled={!own.canDefect} onClick={() => defect(war.id)}>Mudar de lado</button>
          </div>
          <small>Mudança de lado exige ruptura extrema, guerra prolongada e alinhamento significativamente maior com o adversário. Não é uma ação livre.</small>
        </div>}

        {history.length > 0 && <div className="coalition-politics-history">{history.map((record) => <div key={record.id}><b>{names[record.entityId] ?? record.entityId}</b><span>{record.note}</span></div>)}</div>}
        {message[war.id] && <div className="coalition-politics-message">{message[war.id]}</div>}
      </div>;
    })}
  </div>;
}
