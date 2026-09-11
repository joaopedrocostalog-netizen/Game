import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import { consumePreparation } from '../engine/casusBelli';
import { crisesForEntity, potentialMediators, type CrisisSide } from '../engine/crisis';
import {
  commitmentsForCrisis,
  conferenceForCrisis,
  conveneConference,
  evaluateConferenceProposal,
  formalCoalitionsForCrisis,
  potentialFormalInterveners,
  requestFormalIntervention,
  resolveConferenceProposal,
  type ConferenceTerm,
  type InterventionKind,
} from '../engine/conference';
import type { WarState } from '../engine/war';
import './conference.css';

const termLabels: Record<ConferenceTerm, string> = {
  status_quo: 'Status quo e encerramento da crise',
  mutual_demobilization: 'Desmobilização recíproca',
  arbitration: 'Arbitragem internacional',
  limited_concession: 'Concessão limitada negociada',
};

const kindLabels: Record<InterventionKind, string> = {
  guarantee: 'Garantia formal',
  intervention: 'Intervenção formal',
};

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  onWarStateChange: (state: WarState) => void;
};

export function CrisisConferencePanel({ entityId, entities, simulation, warState, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [chairId, setChairId] = useState('');
  const [term, setTerm] = useState<ConferenceTerm>('status_quo');
  const [intervenerId, setIntervenerId] = useState('');
  const [kind, setKind] = useState<InterventionKind>('guarantee');
  const [message, setMessage] = useState('');

  const crisis = useMemo(() => crisesForEntity(entityId).find((item) => item.status !== 'resolved'), [entityId, revision]);
  const side: CrisisSide | undefined = crisis ? (crisis.initiatorId === entityId ? 'initiator' : 'target') : undefined;
  const conference = crisis ? conferenceForCrisis(crisis.id) : undefined;
  const commitments = crisis ? commitmentsForCrisis(crisis.id) : [];
  const chairs = crisis ? potentialMediators(entities, simulation, crisis.initiatorId, crisis.targetId).filter((item) => !crisis.supporters.some((support) => support.entityId === item.entity.id)) : [];
  const candidates = crisis && side ? potentialFormalInterveners(entities, simulation, crisis, side) : [];
  const evaluation = conference && crisis && conference.status === 'open' ? evaluateConferenceProposal(conference, crisis, simulation, term) : undefined;
  const initiatorName = crisis ? entities.find((item) => item.id === crisis.initiatorId)?.name ?? crisis.initiatorId : '';
  const targetName = crisis ? entities.find((item) => item.id === crisis.targetId)?.name ?? crisis.targetId : '';
  const warStarted = crisis ? warState.wars.some((war) => war.status === 'active' && war.attackerId === crisis.initiatorId && war.defenderId === crisis.targetId) : false;

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-crises', refresh);
    window.addEventListener('world-state-conferences', refresh);
    return () => {
      window.removeEventListener('world-state-crises', refresh);
      window.removeEventListener('world-state-conferences', refresh);
    };
  }, []);

  useEffect(() => {
    if (!chairs.some((item) => item.entity.id === chairId)) setChairId(chairs[0]?.entity.id ?? '');
  }, [crisis?.id, revision]);

  useEffect(() => {
    if (!candidates.some((item) => item.entity.id === intervenerId)) setIntervenerId(candidates[0]?.entity.id ?? '');
  }, [crisis?.id, revision, side]);

  useEffect(() => {
    if (!crisis || !warStarted) return;
    const coalition = formalCoalitionsForCrisis(crisis.id);
    const matching = warState.wars.find((war) => war.status === 'active' && war.attackerId === crisis.initiatorId && war.defenderId === crisis.targetId);
    if (!matching) return;
    const attackers = [...new Set([...matching.attackers, ...coalition.attackers])];
    const defenders = [...new Set([...matching.defenders, ...coalition.defenders])].filter((id) => !attackers.includes(id));
    const changed = attackers.length !== matching.attackers.length || defenders.length !== matching.defenders.length;
    if (!changed) return;
    const mobilization = { ...warState.mobilization };
    coalition.attackers.forEach((id) => { if (!mobilization[id] || mobilization[id] === 'none') mobilization[id] = 'partial'; });
    coalition.defenders.forEach((id) => { if (!mobilization[id] || mobilization[id] === 'none') mobilization[id] = 'partial'; });
    onWarStateChange({
      ...warState,
      mobilization,
      wars: warState.wars.map((war) => war.id === matching.id ? { ...war, attackers, defenders } : war),
    });
    setMessage('Os compromissos formais da crise foram transferidos para a coalizão da guerra.');
  }, [warState, crisis?.id, revision, warStarted]);

  if (!crisis) return null;

  function applySimulationSnapshot(nextSimulation: SimulationState) {
    Object.assign(simulation.entities, nextSimulation.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, nextSimulation.diplomacy);
    simulation.events.splice(0, simulation.events.length, ...nextSimulation.events);
  }

  function openConference() {
    if (!crisis || !chairId || crisis.status !== 'active') return;
    const result = conveneConference(crisis, chairId, simulation);
    if (!result) return;
    setMessage(`${entities.find((item) => item.id === chairId)?.name ?? chairId} assumiu a presidência de uma conferência internacional. O prazo da crise foi ampliado para negociação.`);
    setRevision((value) => value + 1);
  }

  function submitConferenceTerm() {
    if (!crisis || !conference || conference.status !== 'open') return;
    const result = resolveConferenceProposal(crisis.id, simulation, term);
    if (!result) return;
    applySimulationSnapshot(result.simulation);
    setMessage(result.message);
    if (result.accepted) consumePreparation(crisis.initiatorId, crisis.targetId);
    setRevision((value) => value + 1);
  }

  function requestCommitment() {
    if (!crisis || !intervenerId || !side) return;
    const result = requestFormalIntervention(crisis.id, intervenerId, side, kind, simulation);
    const name = entities.find((item) => item.id === intervenerId)?.name ?? intervenerId;
    setMessage(`${name}: ${result.message}`);
    setRevision((value) => value + 1);
  }

  return <div className="conference-panel">
    <div className="conference-head"><div><span>CONFERÊNCIA INTERNACIONAL</span><strong>{initiatorName} × {targetName}</strong></div><b>{conference ? conference.status === 'open' ? `rodada ${conference.rounds + 1}` : conference.status === 'settled' ? 'ACORDO' : 'COLAPSO' : 'NÃO CONVOCADA'}</b></div>

    {warStarted ? <div className="conference-war-note">A crise já virou guerra. Compromissos formais aceitos foram incorporados aos lados beligerantes; novos acordos de conferência não podem ser abertos durante esta guerra.</div> : <>
      {!conference && crisis.status === 'active' && <div className="conference-open-row"><label><span>Presidência / anfitrião</span><select value={chairId} onChange={(event) => setChairId(event.target.value)}><option value="">Selecionar…</option>{chairs.map((item) => <option key={item.entity.id} value={item.entity.id}>{item.entity.name} • aptidão {item.suitability.toFixed(0)}</option>)}</select></label><button disabled={!chairId} onClick={openConference}>Convocar conferência</button></div>}

      {conference && conference.status === 'open' && <div className="conference-round">
        <div className="conference-round-grid"><label><span>Proposta</span><select value={term} onChange={(event) => setTerm(event.target.value as ConferenceTerm)}>{Object.entries(termLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="conference-chance"><span>Aceitação estimada</span><b>{evaluation?.acceptance.toFixed(0) ?? '—'}%</b><small>confiança no chair {evaluation?.chairTrust.toFixed(0) ?? '—'} • equilíbrio dos blocos {evaluation?.blocBalance.toFixed(0) ?? '—'}</small></div></div>
        {evaluation && <p>{evaluation.reason}</p>}
        <button onClick={submitConferenceTerm}>Apresentar proposta à conferência</button>
      </div>}

      {conference?.status === 'settled' && <div className="conference-settled">A conferência encerrou a crise sem guerra. A justificativa preparada foi consumida e a mobilização da crise foi desfeita.</div>}
      {conference?.status === 'collapsed' && <div className="conference-collapsed">A conferência colapsou sem acordo. A crise foi marcada como escalada e pode ser convertida em guerra pelo planejador acima.</div>}

      {crisis.status !== 'resolved' && <div className="intervention-box">
        <div className="context-kicker">Garantias e intervenção formal</div>
        <div className="intervention-list">{commitments.length ? commitments.map((commitment) => <div key={commitment.id}><b>{entities.find((item) => item.id === commitment.entityId)?.name ?? commitment.entityId}</b><span>{commitment.side === 'initiator' ? `lado de ${initiatorName}` : `lado de ${targetName}`} • {kindLabels[commitment.kind]} • credibilidade {commitment.credibility.toFixed(0)}</span></div>) : <div className="intervention-empty">Nenhum compromisso externo formalizado além das alianças já existentes.</div>}</div>
        {candidates.length > 0 && side && <div className="intervention-request"><label><span>Convidar potência</span><select value={intervenerId} onChange={(event) => setIntervenerId(event.target.value)}>{candidates.map((item) => <option key={item.entity.id} value={item.entity.id}>{item.entity.name} • disposição {item.willingness.toFixed(0)}</option>)}</select></label><label><span>Compromisso</span><select value={kind} onChange={(event) => setKind(event.target.value as InterventionKind)}><option value="guarantee">Garantia formal</option><option value="intervention">Intervenção formal</option></select></label><button disabled={!intervenerId} onClick={requestCommitment}>Solicitar compromisso</button></div>}
        <small>Garantias são politicamente mais fáceis de obter; intervenção formal exige disposição maior. Quando a crise vira guerra, compromissos aceitos entram no lado correspondente e recebem mobilização parcial inicial.</small>
      </div>}
    </>}

    {message && <div className="conference-message">{message}</div>}
  </div>;
}
