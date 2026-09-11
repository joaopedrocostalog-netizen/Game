import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  castOrganizationVote,
  createOrganizationProposal,
  diplomaticOrganizationState,
  organizationsForEntity,
  proposalsForOrganization,
  runAnnualDiplomaticOrganizations,
  type DiplomaticOrganizationType,
  type OrganizationVoteChoice,
} from '../engine/diplomaticOrganizations';
import type { SimulationState } from '../engine/simulation';
import './diplomatic-organizations.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
};

const typeLabels: Record<DiplomaticOrganizationType, string> = {
  league: 'Liga',
  defensive_union: 'União defensiva',
  commercial_bloc: 'Bloco comercial',
  international_organization: 'Organização internacional',
};

export function DiplomaticOrganizationsPanel({ entityId, entities, simulation }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<Record<string, string>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const updated = runAnnualDiplomaticOrganizations(simulation);
    if (updated !== simulation) {
      Object.assign(simulation.entities, updated.entities);
      Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
      Object.assign(simulation.diplomacy, updated.diplomacy);
      simulation.treaties.splice(0, simulation.treaties.length, ...updated.treaties);
      simulation.events.splice(0, simulation.events.length, ...updated.events);
    }
    setRevision((value) => value + 1);
  }, [simulation, simulation.date.year]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-diplomatic-organizations', refresh);
    return () => window.removeEventListener('world-state-diplomatic-organizations', refresh);
  }, []);

  void revision;
  const memberships = organizationsForEntity(entityId);
  const state = diplomaticOrganizationState();
  const relevant = memberships.length ? memberships : state.organizations.filter((organization) => organization.active).slice(0, 4);
  if (!relevant.length) return null;

  function vote(organizationId: string, proposalId: string, choice: OrganizationVoteChoice) {
    const accepted = castOrganizationVote(organizationId, proposalId, entityId, choice);
    setMessage((current) => ({ ...current, [organizationId]: accepted ? `Voto registrado: ${choice}.` : 'Não foi possível registrar o voto.' }));
    setRevision((value) => value + 1);
  }

  function propose(organizationId: string, type: 'defensive_coordination' | 'trade_integration') {
    const proposal = createOrganizationProposal(organizationId, entityId, type, simulation);
    setMessage((current) => ({ ...current, [organizationId]: proposal ? 'Nova resolução submetida aos membros.' : 'Já existe uma proposta aberta ou sua entidade não pode patrocinar esta resolução.' }));
    setRevision((value) => value + 1);
  }

  return <div className="diplomatic-organizations-panel">
    <div className="diplomatic-organizations-heading">
      <span>BLOCOS E ORGANIZAÇÕES</span>
      <strong>Governança multilateral dinâmica</strong>
    </div>

    {relevant.map((organization) => {
      const proposals = proposalsForOrganization(organization.id).slice(0, 4);
      const openProposal = proposals.find((proposal) => proposal.status === 'open');
      const isMember = organization.memberIds.includes(entityId);
      const isLeader = organization.leaderId === entityId;
      return <div className="organization-card" key={organization.id}>
        <div className="organization-card-head">
          <div><b>{organization.name}</b><span>{typeLabels[organization.type]} • agenda {organization.agenda}</span></div>
          <strong>{organization.active ? 'ATIVA' : 'ENCERRADA'}</strong>
        </div>

        <div className="organization-metrics">
          <span>Líder <b>{names[organization.leaderId] ?? organization.leaderId}</b></span>
          <span>Membros <b>{organization.memberIds.length}</b></span>
          <span>Coesão <b>{organization.cohesion.toFixed(0)}%</b></span>
          <span>Legitimidade <b>{organization.legitimacy.toFixed(0)}%</b></span>
        </div>

        <div className="organization-rule-line">
          <span>Regra de votação</span>
          <b>{organization.votingRule === 'unanimity' ? 'Unanimidade' : organization.votingRule === 'qualified_majority' ? 'Maioria qualificada' : 'Maioria simples'}</b>
          <em>Fundada em {organization.foundedYear}</em>
        </div>

        <div className="organization-members">
          {organization.memberIds.map((memberId) => <span className={memberId === entityId ? 'self' : ''} key={memberId}>{names[memberId] ?? memberId}</span>)}
        </div>

        {openProposal && <div className="organization-proposal">
          <div className="context-kicker">Resolução aberta</div>
          <b>{openProposal.summary}</b>
          <span>Patrocinador: {names[openProposal.sponsorId] ?? openProposal.sponsorId} • prazo {openProposal.deadlineYear}</span>
          <div className="organization-vote-summary">
            <em>Sim {Object.values(openProposal.votes).filter((item) => item === 'yes').length}</em>
            <em>Não {Object.values(openProposal.votes).filter((item) => item === 'no').length}</em>
            <em>Abstenção {Object.values(openProposal.votes).filter((item) => item === 'abstain').length}</em>
          </div>
          {isMember && <div className="organization-vote-actions">
            <button onClick={() => vote(organization.id, openProposal.id, 'yes')}>Votar sim</button>
            <button onClick={() => vote(organization.id, openProposal.id, 'no')}>Votar não</button>
            <button onClick={() => vote(organization.id, openProposal.id, 'abstain')}>Abster</button>
          </div>}
        </div>}

        {!openProposal && isLeader && <div className="organization-leader-actions">
          <button onClick={() => propose(organization.id, 'defensive_coordination')}>Propor coordenação defensiva</button>
          <button onClick={() => propose(organization.id, 'trade_integration')}>Propor integração comercial</button>
        </div>}

        {proposals.filter((proposal) => proposal.status !== 'open').slice(0, 2).map((proposal) => <div className={`organization-history ${proposal.status}`} key={proposal.id}><span>{proposal.summary}</span><b>{proposal.status === 'passed' ? 'APROVADA' : 'REJEITADA'}</b></div>)}
        {message[organization.id] && <div className="organization-message">{message[organization.id]}</div>}
      </div>;
    })}

    <small className="organization-note">Blocos surgem e desaparecem conforme relações, tratados, coesão e poder relativo. Em períodos anteriores, estruturas multilaterais tendem a aparecer como ligas e uniões; em épocas contemporâneas, podem evoluir para organizações internacionais.</small>
  </div>;
}
