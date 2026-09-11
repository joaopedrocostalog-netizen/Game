import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { coalitionPromises, type CoalitionRewardType } from '../engine/allianceCommand';
import {
  allocateConferenceReward,
  expectationsForConference,
  finalizePostWarConference,
  openPostWarConference,
  postWarConferences,
  postWarDisputes,
} from '../engine/postWarConference';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './postwar-conference.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onTerritorialControlChange: (state: TerritorialControlState) => void;
};

const rewardLabels: Record<CoalitionRewardType, string> = {
  territory: 'Território',
  reparations: 'Participação nas reparações',
  influence: 'Influência pós-guerra',
  security: 'Garantia de segurança',
};

export function PostWarConferencePanel({ entityId, entities, simulation, warState, territorialControl, onTerritorialControlChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({});
  const [rewardDraft, setRewardDraft] = useState<Record<string, CoalitionRewardType>>({});
  const [locationDraft, setLocationDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const endedVictories = warState.wars.filter((war) => war.status === 'ended' && (
    (war.victor === 'attackers' && war.attackerId === entityId) ||
    (war.victor === 'defenders' && war.defenderId === entityId)
  )).slice(0, 4);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-postwar-conferences', refresh);
    window.addEventListener('world-state-alliance-command', refresh);
    return () => {
      window.removeEventListener('world-state-postwar-conferences', refresh);
      window.removeEventListener('world-state-alliance-command', refresh);
    };
  }, []);

  void revision;
  if (!endedVictories.length) return null;

  function applySimulationSnapshot(next: SimulationState) {
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function open(warId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const conference = openPostWarConference(war, simulation);
    setMessage((current) => ({ ...current, [warId]: conference ? 'Conferência de paz convocada. Distribua os ganhos antes de encerrar a partilha.' : 'Não foi possível abrir a conferência.' }));
    setRevision((value) => value + 1);
  }

  function allocate(warId: string, conferenceId: string) {
    const memberId = memberDraft[warId];
    const type = rewardDraft[warId] ?? 'reparations';
    const locationId = locationDraft[warId];
    if (!memberId) return;
    const result = allocateConferenceReward(conferenceId, memberId, type, simulation, territorialControl, type === 'territory' ? locationId : undefined);
    if (result.accepted) {
      applySimulationSnapshot(result.simulation);
      onTerritorialControlChange(result.territorialControl);
    }
    setMessage((current) => ({ ...current, [warId]: result.message }));
    setRevision((value) => value + 1);
  }

  function finalize(warId: string, conferenceId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const result = finalizePostWarConference(conferenceId, war, simulation, territorialControl);
    if (result.accepted) applySimulationSnapshot(result.simulation);
    setMessage((current) => ({ ...current, [warId]: result.message }));
    setRevision((value) => value + 1);
  }

  const conferences = postWarConferences();
  const disputes = postWarDisputes(entityId);

  return <div className="postwar-conference-panel">
    <div className="postwar-conference-heading"><span>CONFERÊNCIA DE PAZ</span><strong>Partilha dos ganhos da vitória</strong></div>
    {endedVictories.map((war) => {
      const conference = conferences.find((item) => item.warId === war.id);
      const promises = coalitionPromises(war.id);
      const expectations = conference ? expectationsForConference(conference, war, simulation, territorialControl) : [];
      const usedReparations = conference?.allocations.filter((item) => item.type === 'reparations').reduce((sum, item) => sum + item.value, 0) ?? 0;
      const fairness = conference?.fairness;
      const warDisputes = disputes.filter((item) => item.warId === war.id);
      const chosenType = rewardDraft[war.id] ?? 'reparations';
      const chosenMember = memberDraft[war.id] ?? conference?.participantIds[0] ?? '';
      return <div className="postwar-conference-war" key={war.id}>
        <div className="postwar-conference-war-head"><div><b>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</b><span>Vitória da sua coalizão</span></div><strong>{conference ? conference.status === 'open' ? 'EM NEGOCIAÇÃO' : 'ENCERRADA' : 'AGUARDANDO'}</strong></div>
        {!conference && <button className="open-postwar-conference" onClick={() => open(war.id)}>Convocar conferência de paz</button>}

        {conference && <>
          <div className="postwar-resource-row"><span>Territórios disponíveis <b>{conference.availableLocationIds.length}</b></span><span>Reparações restantes <b>{Math.max(0, conference.reparationsPool - usedReparations).toFixed(1)}</b></span><span>Aliados na mesa <b>{conference.participantIds.length}</b></span></div>

          <div className="postwar-expectations">
            {expectations.length === 0 ? <div className="postwar-empty">Nenhum aliado adicional exige participação formal na partilha.</div> : expectations.map((expectation) => {
              const memberPromises = promises.filter((promise) => promise.memberId === expectation.memberId && !promise.broken);
              const allocations = conference.allocations.filter((allocation) => allocation.memberId === expectation.memberId);
              return <div className="postwar-member-card" key={expectation.memberId}>
                <div><b>{names[expectation.memberId] ?? expectation.memberId}</b><em>expectativa {expectation.expectedValue.toFixed(0)}</em></div>
                <strong>{expectation.goalLabel}</strong>
                <small>{memberPromises.length ? `Promessas: ${memberPromises.map((promise) => rewardLabels[promise.type]).join(', ')}` : 'Sem promessa formal registrada.'}</small>
                <div className="postwar-allocation-chips">{allocations.length ? allocations.map((allocation) => <span key={allocation.id}>{rewardLabels[allocation.type]}{allocation.locationId ? ` • ${allocation.locationId}` : ''}</span>) : <i>Nenhuma recompensa distribuída.</i>}</div>
              </div>;
            })}
          </div>

          {conference.status === 'open' && conference.participantIds.length > 0 && <div className="postwar-allocation-box">
            <div className="context-kicker">Distribuir recompensa</div>
            <div className="postwar-allocation-grid">
              <label><span>Aliado</span><select value={chosenMember} onChange={(event) => setMemberDraft((current) => ({ ...current, [war.id]: event.target.value }))}>{conference.participantIds.map((id) => <option value={id} key={id}>{names[id] ?? id}</option>)}</select></label>
              <label><span>Tipo</span><select value={chosenType} onChange={(event) => setRewardDraft((current) => ({ ...current, [war.id]: event.target.value as CoalitionRewardType }))}>{Object.entries(rewardLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {chosenType === 'territory' && <label><span>Location</span><select value={locationDraft[war.id] ?? ''} onChange={(event) => setLocationDraft((current) => ({ ...current, [war.id]: event.target.value }))}><option value="">Selecionar…</option>{conference.availableLocationIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
              <button disabled={!chosenMember || (chosenType === 'territory' && !locationDraft[war.id])} onClick={() => allocate(war.id, conference.id)}>Conceder</button>
            </div>
            <small>Território transfere soberania efetiva da location conquistada para o aliado. Reparações transferem parte do ganho fiscal; influência e segurança alteram a relação política pós-guerra.</small>
          </div>}

          {conference.status === 'open' && <button className="finalize-postwar-conference" onClick={() => finalize(war.id, conference.id)}>Finalizar partilha</button>}
          {conference.status === 'settled' && <div className="postwar-settlement-summary"><span>Justiça percebida <b>{fairness?.toFixed(0) ?? '—'}%</b></span><span>Dissidentes <b>{conference.dissenters ?? 0}</b></span></div>}
          {warDisputes.length > 0 && <div className="postwar-disputes"><div className="context-kicker">Disputas pós-guerra</div>{warDisputes.map((dispute) => <div key={dispute.id}><b>{names[dispute.claimantId] ?? dispute.claimantId}</b><span>gravidade {dispute.severity.toFixed(0)} • {dispute.reason}</span></div>)}</div>}
        </>}
        {message[war.id] && <div className="postwar-conference-message">{message[war.id]}</div>}
      </div>;
    })}
  </div>;
}
