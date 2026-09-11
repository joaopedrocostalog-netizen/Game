import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForEntity } from '../data/territories';
import {
  coalitionCommandHistory,
  coalitionPromises,
  expelCoalitionMember,
  inviteWartimeAlly,
  potentialWartimeAllies,
  promiseCoalitionReward,
  resetAllianceCommand,
  type CoalitionRewardType,
} from '../engine/allianceCommand';
import { coalitionMemberDisposition } from '../engine/coalitionPolitics';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './alliance-command.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onWarStateChange: (state: WarState) => void;
};

const rewardLabels: Record<CoalitionRewardType, string> = {
  territory: 'Território na paz',
  reparations: 'Parte das reparações',
  influence: 'Influência pós-guerra',
  security: 'Garantias de segurança',
};

export function AllianceCommandPanel({ entityId, entities, simulation, warState, territorialControl, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [candidateDraft, setCandidateDraft] = useState<Record<string, string>>({});
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({});
  const [rewardDraft, setRewardDraft] = useState<Record<string, CoalitionRewardType>>({});
  const [locationDraft, setLocationDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const ledWars = warState.wars.filter((war) => war.status === 'active' && (war.attackerId === entityId || war.defenderId === entityId));

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-alliance-command', refresh);
    window.addEventListener('world-state-coalition-politics', refresh);
    return () => {
      window.removeEventListener('world-state-alliance-command', refresh);
      window.removeEventListener('world-state-coalition-politics', refresh);
    };
  }, []);

  useEffect(() => {
    if (simulation.elapsedDays === 0 && warState.wars.length === 0) resetAllianceCommand();
  }, [simulation.date.year]);

  void revision;
  if (!ledWars.length) return null;

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

  function invite(warId: string) {
    const candidateId = candidateDraft[warId];
    if (!candidateId) return;
    const result = inviteWartimeAlly(warState, warId, entityId, candidateId, simulation);
    applySimulationSnapshot(result.simulation);
    if (result.accepted) onWarStateChange(result.warState);
    setWarMessage(warId, result.message);
  }

  function expel(warId: string) {
    const memberId = memberDraft[warId];
    if (!memberId) return;
    const result = expelCoalitionMember(warState, warId, entityId, memberId, simulation, territorialControl);
    applySimulationSnapshot(result.simulation);
    if (result.accepted) onWarStateChange(result.warState);
    setWarMessage(warId, result.message);
  }

  function promiseReward(warId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    const memberId = memberDraft[warId];
    if (!war || !memberId) return;
    const reward = rewardDraft[warId] ?? 'reparations';
    const locationId = reward === 'territory' ? locationDraft[warId] : undefined;
    const result = promiseCoalitionReward(war, entityId, memberId, reward, simulation, locationId);
    if (result.accepted) applySimulationSnapshot(result.simulation);
    setWarMessage(warId, result.message);
  }

  return <div className="alliance-command-panel">
    <div className="alliance-command-heading"><span>COMANDO DA ALIANÇA</span><strong>Convocações, expulsões e recompensas prometidas</strong></div>
    {ledWars.map((war) => {
      const side = war.attackerId === entityId ? 'attacker' as const : 'defender' as const;
      const members = (side === 'attacker' ? war.attackers : war.defenders).filter((id) => id !== entityId);
      const candidates = potentialWartimeAllies(war, entityId, simulation);
      const selectedMember = memberDraft[war.id] || members[0] || '';
      const reward = rewardDraft[war.id] ?? 'reparations';
      const enemyLeaderId = side === 'attacker' ? war.defenderId : war.attackerId;
      const enemyLocations = locationsForEntity(enemyLeaderId, simulation.date.year);
      const promises = coalitionPromises(war.id);
      const history = coalitionCommandHistory(war.id).slice(0, 4);
      const unstable = members.filter((id) => {
        const disposition = coalitionMemberDisposition(war, id, simulation, territorialControl);
        return !!disposition && (disposition.loyalty < 55 || disposition.warWeariness > 58);
      });
      return <div className="alliance-command-war" key={war.id}>
        <div className="alliance-command-war-head"><div><b>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</b><span>{members.length + 1} membros no seu bloco • {unstable.length} sob pressão</span></div><strong>LÍDER</strong></div>

        <div className="alliance-command-grid">
          <div className="alliance-command-box">
            <span>Convocar novo aliado</span>
            <select value={candidateDraft[war.id] ?? candidates[0]?.entityId ?? ''} onChange={(event) => setCandidateDraft((current) => ({ ...current, [war.id]: event.target.value }))}>
              {candidates.length === 0 && <option value="">Nenhum candidato viável</option>}
              {candidates.map((candidate) => <option value={candidate.entityId} key={candidate.entityId}>{names[candidate.entityId] ?? candidate.entityId} • disposição {candidate.willingness.toFixed(0)}%</option>)}
            </select>
            <button disabled={!candidates.length} onClick={() => {
              if (!candidateDraft[war.id] && candidates[0]) setCandidateDraft((current) => ({ ...current, [war.id]: candidates[0].entityId }));
              const candidate = candidateDraft[war.id] ?? candidates[0]?.entityId;
              if (!candidate) return;
              const result = inviteWartimeAlly(warState, war.id, entityId, candidate, simulation);
              applySimulationSnapshot(result.simulation);
              if (result.accepted) onWarStateChange(result.warState);
              setWarMessage(war.id, result.message);
            }}>Enviar chamado de guerra</button>
            <small>Aliança formal, confiança, alinhamento contra o inimigo e poder militar aumentam a disposição para entrar.</small>
          </div>

          <div className="alliance-command-box">
            <span>Gerir membro da coalizão</span>
            <select value={selectedMember} onChange={(event) => setMemberDraft((current) => ({ ...current, [war.id]: event.target.value }))}>
              {members.length === 0 && <option value="">Nenhum aliado adicional</option>}
              {members.map((id) => {
                const disposition = coalitionMemberDisposition(war, id, simulation, territorialControl);
                return <option value={id} key={id}>{names[id] ?? id} • lealdade {disposition?.loyalty.toFixed(0) ?? '—'}%</option>;
              })}
            </select>
            <button className="alliance-expel" disabled={!members.length || !unstable.includes(selectedMember)} onClick={() => expel(war.id)}>Expulsar membro instável</button>
            <small>O jogo bloqueia a expulsão de parceiros ainda leais; expulsões válidas encerram a mobilização e deterioram fortemente a relação.</small>
          </div>
        </div>

        {members.length > 0 && <div className="alliance-reward-box">
          <div><span>Promessa de recompensa</span><b>{names[selectedMember] ?? selectedMember}</b></div>
          <div className="alliance-reward-controls">
            <select value={reward} onChange={(event) => setRewardDraft((current) => ({ ...current, [war.id]: event.target.value as CoalitionRewardType }))}>{Object.entries(rewardLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {reward === 'territory' && <select value={locationDraft[war.id] ?? enemyLocations[0]?.id ?? ''} onChange={(event) => setLocationDraft((current) => ({ ...current, [war.id]: event.target.value }))}>{enemyLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}
            <button onClick={() => promiseReward(war.id)}>Registrar promessa</button>
          </div>
          <small>Promessas elevam confiança e ajudam a manter aliados na guerra, mas permanecem registradas para o pós-guerra. Prometer demais pode criar uma coalizão impossível de satisfazer.</small>
        </div>}

        {promises.length > 0 && <div className="alliance-promise-list">{promises.slice(0, 6).map((promise) => <div key={promise.id}><b>{names[promise.memberId] ?? promise.memberId}</b><span>{rewardLabels[promise.type]}{promise.locationId ? ` • ${enemyLocations.find((location) => location.id === promise.locationId)?.name ?? promise.locationId}` : ''}</span><em>{promise.fulfilled ? 'CUMPRIDA' : promise.broken ? 'QUEBRADA' : 'PENDENTE'}</em></div>)}</div>}
        {history.length > 0 && <div className="alliance-command-history">{history.map((item) => <div key={item.id}><b>{names[item.memberId] ?? item.memberId}</b><span>{item.note}</span></div>)}</div>}
        {message[war.id] && <div className="alliance-command-message">{message[war.id]}</div>}
      </div>;
    })}
  </div>;
}
