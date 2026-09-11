import { diplomaticOrganizationState, type DiplomaticOrganization, type OrganizationVoteChoice } from './diplomaticOrganizations';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import { setMobilization, type WarState } from './war';

export type CollectiveActionType = 'collective_defense' | 'military_intervention' | 'embargo' | 'collective_sanctions';
export type CollectiveMandateStatus = 'open' | 'passed' | 'rejected' | 'implemented';
export type ObligationResponse = 'pending' | 'complied' | 'refused';

export type CollectiveMandate = {
  id: string;
  organizationId: string;
  action: CollectiveActionType;
  sponsorId: string;
  beneficiaryId?: string;
  targetId: string;
  warId?: string;
  openedAtElapsedDay: number;
  deadlineElapsedDay: number;
  status: CollectiveMandateStatus;
  votes: Record<string, OrganizationVoteChoice>;
  summary: string;
};

export type MemberObligation = {
  id: string;
  mandateId: string;
  organizationId: string;
  memberId: string;
  action: CollectiveActionType;
  targetId: string;
  beneficiaryId?: string;
  warId?: string;
  response: ObligationResponse;
  credibilityCost: number;
  createdAtElapsedDay: number;
};

type CollectiveState = { mandates: CollectiveMandate[]; obligations: MemberObligation[] };
type CollectiveGlobal = typeof globalThis & { __WORLD_STATE_ORGANIZATION_OBLIGATIONS__?: CollectiveState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): CollectiveState {
  const root = globalThis as CollectiveGlobal;
  if (!root.__WORLD_STATE_ORGANIZATION_OBLIGATIONS__) root.__WORLD_STATE_ORGANIZATION_OBLIGATIONS__ = { mandates: [], obligations: [] };
  return root.__WORLD_STATE_ORGANIZATION_OBLIGATIONS__;
}

function publish(state: CollectiveState) {
  (globalThis as CollectiveGlobal).__WORLD_STATE_ORGANIZATION_OBLIGATIONS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-organization-obligations', { detail: state }));
}

export function resetOrganizationObligations() {
  publish({ mandates: [], obligations: [] });
}

export function organizationObligationState() {
  const state = rootState();
  return {
    mandates: state.mandates.map((item) => ({ ...item, votes: { ...item.votes } })),
    obligations: state.obligations.map((item) => ({ ...item })),
  };
}

function organizationById(id: string) {
  return diplomaticOrganizationState().organizations.find((item) => item.id === id && item.active);
}

function relationScore(simulation: SimulationState, a: string, b: string) {
  const relation = simulation.diplomacy[pairKey(a, b)];
  if (!relation) return 0;
  return relation.score * 0.45 + relation.trust * 0.35 - relation.threat * 0.25;
}

function votingThreshold(organization: DiplomaticOrganization) {
  if (organization.votingRule === 'unanimity') return organization.memberIds.length;
  if (organization.votingRule === 'qualified_majority') return Math.ceil(organization.memberIds.length * 0.66);
  return Math.floor(organization.memberIds.length / 2) + 1;
}

function mandateLabel(action: CollectiveActionType, beneficiaryId: string | undefined, targetId: string) {
  if (action === 'collective_defense') return `Ativar defesa coletiva em favor de ${beneficiaryId ?? 'membro'} contra ${targetId}`;
  if (action === 'military_intervention') return `Autorizar intervenção coletiva contra ${targetId}`;
  if (action === 'embargo') return `Impor embargo coletivo a ${targetId}`;
  return `Aplicar sanções coletivas a ${targetId}`;
}

export function createCollectiveMandate(
  organizationId: string,
  sponsorId: string,
  action: CollectiveActionType,
  targetId: string,
  simulation: SimulationState,
  warState: WarState,
  beneficiaryId?: string,
  warId?: string,
) {
  const organization = organizationById(organizationId);
  if (!organization || !organization.memberIds.includes(sponsorId)) return undefined;
  if (rootState().mandates.some((item) => item.organizationId === organizationId && item.status === 'open')) return undefined;
  if ((action === 'collective_defense' || action === 'military_intervention') && !warId) return undefined;
  if (warId && !warState.wars.some((war) => war.id === warId && war.status === 'active')) return undefined;
  const mandate: CollectiveMandate = {
    id: `collective-${organizationId}-${action}-${simulation.elapsedDays}`,
    organizationId,
    action,
    sponsorId,
    beneficiaryId,
    targetId,
    warId,
    openedAtElapsedDay: simulation.elapsedDays,
    deadlineElapsedDay: simulation.elapsedDays + (simulation.date.year < 1800 ? 90 : 45),
    status: 'open',
    votes: { [sponsorId]: 'yes' },
    summary: mandateLabel(action, beneficiaryId, targetId),
  };
  publish({ ...rootState(), mandates: [mandate, ...rootState().mandates].slice(0, 80) });
  return mandate;
}

export function castCollectiveVote(mandateId: string, memberId: string, choice: OrganizationVoteChoice) {
  const state = rootState();
  const mandate = state.mandates.find((item) => item.id === mandateId && item.status === 'open');
  const organization = mandate ? organizationById(mandate.organizationId) : undefined;
  if (!mandate || !organization || !organization.memberIds.includes(memberId)) return false;
  publish({ ...state, mandates: state.mandates.map((item) => item.id === mandateId ? { ...item, votes: { ...item.votes, [memberId]: choice } } : item) });
  return true;
}

function automatedVote(simulation: SimulationState, organization: DiplomaticOrganization, mandate: CollectiveMandate, memberId: string): OrganizationVoteChoice {
  if (memberId === simulation.playerEntityId) return mandate.votes[memberId] ?? 'abstain';
  const toSponsor = relationScore(simulation, memberId, mandate.sponsorId);
  const toTarget = relationScore(simulation, memberId, mandate.targetId);
  const toBeneficiary = mandate.beneficiaryId ? relationScore(simulation, memberId, mandate.beneficiaryId) : 0;
  let score = 44 + organization.cohesion * 0.24 + toSponsor * 0.22 - toTarget * 0.18 + toBeneficiary * 0.18;
  if (mandate.action === 'collective_defense' && organization.agenda === 'security') score += 13;
  if (mandate.action === 'embargo' && organization.agenda === 'trade') score += 4;
  if (mandate.action === 'military_intervention') score -= 8;
  if (score >= 61) return 'yes';
  if (score <= 39) return 'no';
  return 'abstain';
}

export function resolveCollectiveMandate(mandateId: string, simulation: SimulationState) {
  const state = rootState();
  const mandate = state.mandates.find((item) => item.id === mandateId && item.status === 'open');
  const organization = mandate ? organizationById(mandate.organizationId) : undefined;
  if (!mandate || !organization) return { accepted: false, simulation, message: 'Mandato coletivo indisponível.' };
  const votes = { ...mandate.votes };
  for (const memberId of organization.memberIds) if (!votes[memberId]) votes[memberId] = automatedVote(simulation, organization, mandate, memberId);
  const yes = Object.values(votes).filter((vote) => vote === 'yes').length;
  const passed = yes >= votingThreshold(organization);
  const resolved: CollectiveMandate = { ...mandate, votes, status: passed ? 'passed' : 'rejected' };
  const obligations = passed
    ? organization.memberIds.filter((id) => id !== mandate.targetId && id !== mandate.beneficiaryId).map<MemberObligation>((memberId) => ({
        id: `obligation-${mandate.id}-${memberId}`,
        mandateId: mandate.id,
        organizationId: organization.id,
        memberId,
        action: mandate.action,
        targetId: mandate.targetId,
        beneficiaryId: mandate.beneficiaryId,
        warId: mandate.warId,
        response: 'pending',
        credibilityCost: mandate.action === 'military_intervention' ? 14 : mandate.action === 'collective_defense' ? 18 : 9,
        createdAtElapsedDay: simulation.elapsedDays,
      }))
    : [];
  const event: WorldEvent = {
    id: `collective-vote-${mandate.id}-${simulation.elapsedDays}`,
    date: simulation.date,
    category: 'diplomacy',
    title: passed ? 'Mandato coletivo aprovado' : 'Mandato coletivo rejeitado',
    text: `${organization.name} ${passed ? 'aprovou' : 'rejeitou'} “${mandate.summary}” por ${yes} voto(s) favorável(is).`,
  };
  const nextSimulation = { ...simulation, events: [event, ...simulation.events].slice(0, 50) };
  publish({ mandates: state.mandates.map((item) => item.id === mandate.id ? resolved : item), obligations: [...obligations, ...state.obligations].slice(0, 160) });
  return { accepted: true, passed, simulation: nextSimulation, mandate: resolved, message: passed ? 'A resolução foi aprovada e criou obrigações para os membros.' : 'A organização rejeitou a ação coletiva.' };
}

function mutateRelation(simulation: SimulationState, a: string, b: string, score: number, trust: number, threat: number, memory: string) {
  const key = pairKey(a, b);
  const relation = simulation.diplomacy[key];
  if (!relation) return simulation;
  return {
    ...simulation,
    diplomacy: {
      ...simulation.diplomacy,
      [key]: {
        ...relation,
        score: clamp(relation.score + score, -100, 100),
        trust: clamp(relation.trust + trust),
        threat: clamp(relation.threat + threat),
        memory: [memory, ...relation.memory].slice(0, 8),
      },
    },
  };
}

function joinWar(warState: WarState, obligation: MemberObligation) {
  if (!obligation.warId || !obligation.beneficiaryId) return warState;
  let next = { ...warState, wars: warState.wars.map((war) => {
    if (war.id !== obligation.warId || war.status !== 'active') return war;
    if (war.attackers.includes(obligation.memberId) || war.defenders.includes(obligation.memberId)) return war;
    const beneficiaryOnAttack = war.attackers.includes(obligation.beneficiaryId!);
    return beneficiaryOnAttack
      ? { ...war, attackers: [...war.attackers, obligation.memberId] }
      : { ...war, defenders: [...war.defenders, obligation.memberId] };
  }) };
  next = setMobilization(next, obligation.memberId, 'partial');
  return next;
}

export function respondToOrganizationObligation(obligationId: string, response: Exclude<ObligationResponse, 'pending'>, simulation: SimulationState, warState: WarState) {
  const state = rootState();
  const obligation = state.obligations.find((item) => item.id === obligationId && item.response === 'pending');
  if (!obligation) return { accepted: false, simulation, warState, message: 'Obrigação indisponível.' };
  const organization = organizationById(obligation.organizationId);
  if (!organization) return { accepted: false, simulation, warState, message: 'A organização já não está ativa.' };
  let nextSimulation = simulation;
  let nextWarState = warState;

  if (response === 'complied') {
    if (obligation.action === 'collective_defense' || obligation.action === 'military_intervention') {
      nextWarState = joinWar(nextWarState, obligation);
      nextSimulation = mutateRelation(nextSimulation, obligation.memberId, obligation.beneficiaryId ?? organization.leaderId, 3, 5, -1, 'Cumpriu uma obrigação coletiva de segurança da organização.');
    } else {
      const member = nextSimulation.entities[obligation.memberId];
      const target = nextSimulation.entities[obligation.targetId];
      if (member && target) {
        nextSimulation = {
          ...nextSimulation,
          entities: {
            ...nextSimulation.entities,
            [obligation.memberId]: { ...member, economyIndex: clamp(member.economyIndex - 0.8), treasuryIndex: clamp(member.treasuryIndex - 0.4) },
            [obligation.targetId]: { ...target, economyIndex: clamp(target.economyIndex - (obligation.action === 'embargo' ? 2.2 : 1.4)), treasuryIndex: clamp(target.treasuryIndex - (obligation.action === 'embargo' ? 1.6 : 1.1)) },
          },
        };
      }
      nextSimulation = mutateRelation(nextSimulation, obligation.memberId, obligation.targetId, -8, -6, 7, obligation.action === 'embargo' ? 'Participou de um embargo coletivo.' : 'Participou de sanções coletivas.');
    }
  } else {
    nextSimulation = mutateRelation(nextSimulation, obligation.memberId, organization.leaderId, -5, -obligation.credibilityCost, 2, 'Recusou cumprir uma decisão coletiva aprovada pela organização.');
  }

  const event: WorldEvent = {
    id: `organization-obligation-${obligation.id}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId: obligation.memberId,
    category: 'diplomacy',
    title: response === 'complied' ? 'Obrigação coletiva cumprida' : 'Obrigação coletiva recusada',
    text: `${obligation.memberId} ${response === 'complied' ? 'cumpriu' : 'recusou'} a decisão coletiva “${obligation.action}” de ${organization.name}.`,
  };
  nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
  publish({ ...state, obligations: state.obligations.map((item) => item.id === obligation.id ? { ...item, response } : item), mandates: state.mandates.map((item) => item.id === obligation.mandateId && response === 'complied' ? { ...item, status: 'implemented' } : item) });
  return { accepted: true, simulation: nextSimulation, warState: nextWarState, message: response === 'complied' ? 'A obrigação foi cumprida.' : 'A recusa foi registrada e prejudicou a credibilidade dentro do bloco.' };
}

export function pendingObligationsForEntity(entityId: string) {
  return rootState().obligations.filter((item) => item.memberId === entityId && item.response === 'pending');
}

export function mandatesForOrganization(organizationId: string) {
  return rootState().mandates.filter((item) => item.organizationId === organizationId);
}

export function collectiveActionOpportunities(entityId: string, warState: WarState) {
  const organizations = diplomaticOrganizationState().organizations.filter((item) => item.active && item.memberIds.includes(entityId));
  return organizations.flatMap((organization) => warState.wars.filter((war) => war.status === 'active').flatMap((war) => {
    const defendedMember = organization.memberIds.find((memberId) => war.defenders.includes(memberId));
    const attackerOutside = war.attackers.find((id) => !organization.memberIds.includes(id));
    if (defendedMember && attackerOutside) return [{ organization, war, beneficiaryId: defendedMember, targetId: attackerOutside, action: 'collective_defense' as const }];
    return [];
  }));
}
