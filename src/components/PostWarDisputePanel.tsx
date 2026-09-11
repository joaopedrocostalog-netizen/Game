import React, { useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  breakPostWarAlliance,
  demandPostWarCompensation,
  disputeEscalation,
  openPostWarDiplomaticCrisis,
  potentialPostWarPartners,
  seekPostWarSupport,
  settlePostWarDispute,
} from '../engine/postWarDispute';
import { postWarDisputes } from '../engine/postWarConference';
import type { SimulationState } from '../engine/simulation';
import './postwar-dispute.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
};

const statusLabels = {
  latent: 'Latente',
  demanding: 'Exigência ativa',
  settled: 'Resolvida',
  rupture: 'Ruptura diplomática',
  crisis: 'Crise formal',
};

export function PostWarDisputePanel({ entityId, entities, simulation }: Props) {
  const [, setRevision] = useState(0);
  const [partnerDraft, setPartnerDraft] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const disputes = postWarDisputes(entityId).slice(0, 8);
  if (!disputes.length) return null;

  function applySimulationSnapshot(next: SimulationState) {
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.treaties.splice(0, simulation.treaties.length, ...next.treaties);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function finish(disputeId: string, result: { accepted: boolean; simulation: SimulationState; message: string }) {
    if (result.accepted) applySimulationSnapshot(result.simulation);
    setMessages((current) => ({ ...current, [disputeId]: result.message }));
    setRevision((value) => value + 1);
  }

  return <div className="postwar-dispute-panel">
    <div className="postwar-dispute-heading"><span>DISPUTAS PÓS-GUERRA</span><strong>Ressentimentos, exigências e realinhamento</strong></div>
    {disputes.map((dispute) => {
      const escalation = disputeEscalation(dispute, simulation);
      const isClaimant = dispute.claimantId === entityId;
      const isLeader = dispute.leaderId === entityId;
      const partners = isClaimant ? potentialPostWarPartners(dispute, simulation, entities) : [];
      const selectedPartner = partnerDraft[dispute.id] ?? partners[0]?.entityId ?? '';
      const canDemand = isClaimant && escalation.maturity >= 42 && !['settled', 'crisis'].includes(escalation.status);
      const canBreak = isClaimant && (escalation.maturity >= 58 || dispute.severity >= 68) && !['settled', 'crisis'].includes(escalation.status);
      const canSeek = isClaimant && escalation.maturity >= 48 && partners.length > 0 && !['settled', 'crisis'].includes(escalation.status);
      const canCrisis = isClaimant && (escalation.maturity >= 62 || dispute.severity >= 72) && !['settled', 'crisis'].includes(escalation.status);
      return <div className={`postwar-dispute-card status-${escalation.status}`} key={dispute.id}>
        <div className="postwar-dispute-head-row">
          <div><b>{names[dispute.claimantId] ?? dispute.claimantId} × {names[dispute.leaderId] ?? dispute.leaderId}</b><span>{dispute.reason}</span></div>
          <strong>{statusLabels[escalation.status]}</strong>
        </div>
        <div className="postwar-dispute-stats">
          <span>Gravidade <b>{dispute.severity.toFixed(0)}%</b></span>
          <span>Maturidade <b>{escalation.maturity.toFixed(0)}%</b></span>
          <span>Pressão <b>{escalation.pressure.toFixed(0)}%</b></span>
          <span>Apoios <b>{escalation.supportIds.length}</b></span>
        </div>
        <div className="postwar-dispute-track"><i style={{ width: `${Math.max(escalation.pressure, escalation.maturity)}%` }}/></div>
        {escalation.notes[0] && <small>{escalation.notes[0]}</small>}

        {isClaimant && !['settled', 'crisis'].includes(escalation.status) && <div className="postwar-dispute-actions">
          <button disabled={!canDemand} onClick={() => finish(dispute.id, demandPostWarCompensation(dispute, simulation))}>Exigir compensação</button>
          <button disabled={!canBreak} onClick={() => finish(dispute.id, breakPostWarAlliance(dispute, simulation))}>Romper aliança</button>
          <div className="postwar-support-row">
            <select value={selectedPartner} disabled={!canSeek} onChange={(event) => setPartnerDraft((current) => ({ ...current, [dispute.id]: event.target.value }))}>
              {partners.length === 0 ? <option value="">Sem apoiadores disponíveis</option> : partners.map((partner) => <option value={partner.entityId} key={partner.entityId}>{names[partner.entityId] ?? partner.entityId} • {partner.willingness.toFixed(0)}%</option>)}
            </select>
            <button disabled={!canSeek || !selectedPartner} onClick={() => selectedPartner && finish(dispute.id, seekPostWarSupport(dispute, selectedPartner, simulation, entities))}>Buscar apoio</button>
          </div>
          <button className="open-postwar-crisis" disabled={!canCrisis} onClick={() => finish(dispute.id, openPostWarDiplomaticCrisis(dispute, simulation, entities))}>Abrir crise diplomática</button>
        </div>}

        {isLeader && escalation.status !== 'settled' && escalation.status !== 'crisis' && <div className="postwar-leader-response">
          <span>Como antigo líder da coalizão, você pode tentar encerrar a disputa antes da escalada.</span>
          <button onClick={() => finish(dispute.id, settlePostWarDispute(dispute, simulation))}>Oferecer acordo compensatório</button>
        </div>}

        {escalation.supportIds.length > 0 && <div className="postwar-supporters">{escalation.supportIds.map((id) => <span key={id}>{names[id] ?? id}</span>)}</div>}
        {messages[dispute.id] && <div className="postwar-dispute-message">{messages[dispute.id]}</div>}
      </div>;
    })}
  </div>;
}
