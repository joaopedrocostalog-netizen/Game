import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { diplomaticOrganizationState, type OrganizationVoteChoice } from '../engine/diplomaticOrganizations';
import {
  castCollectiveVote,
  collectiveActionOpportunities,
  createCollectiveMandate,
  mandatesForOrganization,
  organizationObligationState,
  pendingObligationsForEntity,
  resolveCollectiveMandate,
  respondToOrganizationObligation,
  type CollectiveActionType,
} from '../engine/organizationObligations';
import { applyOrganizationComplianceShock } from '../engine/organizationCompliance';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './organization-obligations.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  onWarStateChange: (state: WarState) => void;
};

const actionLabels: Record<CollectiveActionType, string> = {
  collective_defense: 'Defesa coletiva',
  military_intervention: 'Intervenção coletiva',
  embargo: 'Embargo coletivo',
  collective_sanctions: 'Sanções coletivas',
};

export function OrganizationObligationsPanel({ entityId, entities, simulation, warState, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [targetByOrg, setTargetByOrg] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const organizations = diplomaticOrganizationState().organizations.filter((item) => item.active && item.memberIds.includes(entityId));
  const obligations = pendingObligationsForEntity(entityId);
  const opportunities = collectiveActionOpportunities(entityId, warState);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-organization-obligations', refresh);
    window.addEventListener('world-state-diplomatic-organizations', refresh);
    return () => {
      window.removeEventListener('world-state-organization-obligations', refresh);
      window.removeEventListener('world-state-diplomatic-organizations', refresh);
    };
  }, []);
  void revision;

  function mutateSimulation(next: SimulationState) {
    Object.keys(simulation.entities).forEach((key) => delete simulation.entities[key]);
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.treaties.splice(0, simulation.treaties.length, ...next.treaties);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function openMandate(organizationId: string, action: CollectiveActionType, targetId: string, beneficiaryId?: string, warId?: string) {
    const mandate = createCollectiveMandate(organizationId, entityId, action, targetId, simulation, warState, beneficiaryId, warId);
    setMessage(mandate ? 'A resolução coletiva foi aberta para votação.' : 'Não foi possível abrir uma nova resolução coletiva.');
    setRevision((value) => value + 1);
  }

  function vote(mandateId: string, choice: OrganizationVoteChoice) {
    const ok = castCollectiveVote(mandateId, entityId, choice);
    setMessage(ok ? `Voto coletivo registrado: ${choice}.` : 'Não foi possível registrar o voto.');
    setRevision((value) => value + 1);
  }

  function closeVote(mandateId: string) {
    const result = resolveCollectiveMandate(mandateId, simulation);
    if (!result.accepted) {
      setMessage(result.message);
      return;
    }
    mutateSimulation(result.simulation);
    let currentWar = warState;
    if (result.passed && result.mandate) {
      const state = organizationObligationState();
      const aiObligations = state.obligations.filter((item) => item.mandateId === result.mandate!.id && item.memberId !== entityId && item.response === 'pending');
      for (const obligation of aiObligations) {
        const voteChoice = result.mandate.votes[obligation.memberId] ?? 'abstain';
        const response = voteChoice === 'no' ? 'refused' : 'complied';
        const outcome = respondToOrganizationObligation(obligation.id, response, simulation, currentWar);
        if (outcome.accepted) {
          mutateSimulation(outcome.simulation);
          currentWar = outcome.warState;
          applyOrganizationComplianceShock(obligation.organizationId, response === 'complied' ? 1.2 : -7, response === 'complied' ? 0.6 : -4);
        }
      }
      onWarStateChange(currentWar);
    }
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function respond(obligationId: string, response: 'complied' | 'refused') {
    const result = respondToOrganizationObligation(obligationId, response, simulation, warState);
    if (!result.accepted) {
      setMessage(result.message);
      return;
    }
    mutateSimulation(result.simulation);
    onWarStateChange(result.warState);
    const obligation = organizationObligationState().obligations.find((item) => item.id === obligationId);
    if (obligation) applyOrganizationComplianceShock(obligation.organizationId, response === 'complied' ? 1.5 : -9, response === 'complied' ? 0.8 : -5);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  if (!organizations.length && !obligations.length) return null;

  return <div className="organization-obligations-panel">
    <div className="organization-obligations-heading">
      <span>AÇÕES COLETIVAS</span>
      <strong>Defesa, intervenção, sanções e cumprimento das decisões do bloco</strong>
    </div>

    {obligations.map((obligation) => <div className="obligation-alert" key={obligation.id}>
      <div><b>Obrigação pendente: {actionLabels[obligation.action]}</b><span>Alvo: {names[obligation.targetId] ?? obligation.targetId}{obligation.beneficiaryId ? ` • em favor de ${names[obligation.beneficiaryId] ?? obligation.beneficiaryId}` : ''}</span></div>
      <em>Recusar pode reduzir fortemente a coesão e a confiança dentro do bloco.</em>
      <div className="obligation-actions"><button onClick={() => respond(obligation.id, 'complied')}>Cumprir decisão</button><button className="danger" onClick={() => respond(obligation.id, 'refused')}>Recusar obrigação</button></div>
    </div>)}

    {organizations.map((organization) => {
      const mandates = mandatesForOrganization(organization.id).slice(0, 5);
      const open = mandates.find((item) => item.status === 'open');
      const isLeader = organization.leaderId === entityId;
      const outsiders = entities.filter((entity) => !organization.memberIds.includes(entity.id));
      const selectedTarget = targetByOrg[organization.id] ?? outsiders[0]?.id ?? '';
      const defenseOpportunity = opportunities.find((item) => item.organization.id === organization.id);
      const activeMemberWar = warState.wars.find((war) => war.status === 'active' && organization.memberIds.some((id) => war.attackers.includes(id) || war.defenders.includes(id)));
      let interventionTarget = '';
      let interventionBeneficiary = '';
      if (activeMemberWar) {
        interventionBeneficiary = organization.memberIds.find((id) => activeMemberWar.attackers.includes(id) || activeMemberWar.defenders.includes(id)) ?? '';
        const onAttack = activeMemberWar.attackers.includes(interventionBeneficiary);
        interventionTarget = (onAttack ? activeMemberWar.defenders : activeMemberWar.attackers).find((id) => !organization.memberIds.includes(id)) ?? '';
      }

      return <div className="collective-card" key={organization.id}>
        <div className="collective-card-head"><div><b>{organization.name}</b><span>Coesão {organization.cohesion.toFixed(0)}% • legitimidade {organization.legitimacy.toFixed(0)}%</span></div><strong>{organization.agenda.toUpperCase()}</strong></div>

        {open ? <div className="collective-mandate open">
          <span>RESOLUÇÃO EM VOTAÇÃO</span><b>{open.summary}</b>
          <div className="collective-votes"><em>Sim {Object.values(open.votes).filter((v) => v === 'yes').length}</em><em>Não {Object.values(open.votes).filter((v) => v === 'no').length}</em><em>Abstenção {Object.values(open.votes).filter((v) => v === 'abstain').length}</em></div>
          <div className="collective-buttons"><button onClick={() => vote(open.id, 'yes')}>Votar sim</button><button onClick={() => vote(open.id, 'no')}>Votar não</button><button onClick={() => vote(open.id, 'abstain')}>Abster</button>{isLeader && <button className="primary" onClick={() => closeVote(open.id)}>Encerrar votação</button>}</div>
        </div> : isLeader && <div className="collective-leader-tools">
          {defenseOpportunity && <button className="primary" onClick={() => openMandate(organization.id, 'collective_defense', defenseOpportunity.targetId, defenseOpportunity.beneficiaryId, defenseOpportunity.war.id)}>Ativar defesa coletiva</button>}
          {activeMemberWar && interventionTarget && <button onClick={() => openMandate(organization.id, 'military_intervention', interventionTarget, interventionBeneficiary, activeMemberWar.id)}>Votar intervenção</button>}
          {!!outsiders.length && <><select value={selectedTarget} onChange={(event) => setTargetByOrg((current) => ({ ...current, [organization.id]: event.target.value }))}>{outsiders.map((entity) => <option value={entity.id} key={entity.id}>{entity.name}</option>)}</select><button onClick={() => openMandate(organization.id, 'embargo', selectedTarget)}>Propor embargo</button><button onClick={() => openMandate(organization.id, 'collective_sanctions', selectedTarget)}>Propor sanções</button></>}
        </div>}

        {mandates.filter((item) => item.status !== 'open').slice(0, 3).map((mandate) => <div className={`collective-history ${mandate.status}`} key={mandate.id}><span>{mandate.summary}</span><b>{mandate.status === 'rejected' ? 'REJEITADA' : mandate.status === 'implemented' ? 'IMPLEMENTADA' : 'APROVADA'}</b></div>)}
      </div>;
    })}

    {message && <div className="collective-message">{message}</div>}
    <small className="collective-note">Uma resolução aprovada não transforma todos os membros em autômatos. Países podem recusar a obrigação, mas o custo político enfraquece a credibilidade e a coesão do bloco.</small>
  </div>;
}
