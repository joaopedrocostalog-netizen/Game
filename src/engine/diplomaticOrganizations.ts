import { geopoliticalState } from './geopoliticalAlignment';
import { pairKey, type SimulationState, type Treaty, type WorldEvent } from './simulation';

export type DiplomaticOrganizationType = 'league' | 'defensive_union' | 'commercial_bloc' | 'international_organization';
export type OrganizationVotingRule = 'unanimity' | 'qualified_majority' | 'simple_majority';
export type OrganizationAgenda = 'security' | 'trade' | 'stability' | 'influence';
export type OrganizationProposalType = 'admit_member' | 'defensive_coordination' | 'trade_integration' | 'discipline_member';
export type OrganizationVoteChoice = 'yes' | 'no' | 'abstain';

export type DiplomaticOrganization = {
  id: string;
  name: string;
  type: DiplomaticOrganizationType;
  foundedYear: number;
  leaderId: string;
  memberIds: string[];
  votingRule: OrganizationVotingRule;
  agenda: OrganizationAgenda;
  cohesion: number;
  legitimacy: number;
  active: boolean;
  lastReviewYear: number;
};

export type OrganizationProposal = {
  id: string;
  organizationId: string;
  type: OrganizationProposalType;
  sponsorId: string;
  targetId?: string;
  openedYear: number;
  deadlineYear: number;
  status: 'open' | 'passed' | 'rejected';
  votes: Record<string, OrganizationVoteChoice>;
  summary: string;
};

export type DiplomaticOrganizationState = {
  lastProcessedYear?: number;
  organizations: DiplomaticOrganization[];
  proposals: OrganizationProposal[];
};

type OrganizationGlobal = typeof globalThis & { __WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__?: DiplomaticOrganizationState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): DiplomaticOrganizationState {
  const root = globalThis as OrganizationGlobal;
  if (!root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__) root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__ = { organizations: [], proposals: [] };
  return root.__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__;
}

function publish(state: DiplomaticOrganizationState) {
  (globalThis as OrganizationGlobal).__WORLD_STATE_DIPLOMATIC_ORGANIZATIONS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-diplomatic-organizations', { detail: state }));
}

export function resetDiplomaticOrganizations() {
  publish({ organizations: [], proposals: [] });
}

export function diplomaticOrganizationState() {
  const state = rootState();
  return {
    ...state,
    organizations: state.organizations.map((item) => ({ ...item, memberIds: [...item.memberIds] })),
    proposals: state.proposals.map((item) => ({ ...item, votes: { ...item.votes } })),
  };
}

function activeTreaty(simulation: SimulationState, a: string, b: string, type: Treaty['type']) {
  const key = pairKey(a, b);
  return simulation.treaties.some((treaty) => treaty.active && treaty.type === type && pairKey(...treaty.parties) === key);
}

function statePower(simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return 45;
  return runtime.militaryReadiness * 0.3 + runtime.economyIndex * 0.28 + runtime.technology * 0.18 + runtime.treasuryIndex * 0.14 + runtime.stability * 0.1;
}

function relationScore(simulation: SimulationState, a: string, b: string) {
  const relation = simulation.diplomacy[pairKey(a, b)];
  if (!relation) return 0;
  return relation.score * 0.45 + relation.trust * 0.42 - relation.threat * 0.28 + relation.tradeInterest * 0.12;
}

function organizationType(year: number, securityLinks: number, tradeLinks: number): DiplomaticOrganizationType {
  if (year < 1700) return securityLinks >= tradeLinks ? 'league' : 'commercial_bloc';
  if (year < 1919) return securityLinks >= tradeLinks ? 'defensive_union' : 'commercial_bloc';
  if (securityLinks + tradeLinks >= 4) return 'international_organization';
  return securityLinks >= tradeLinks ? 'defensive_union' : 'commercial_bloc';
}

function votingRuleFor(type: DiplomaticOrganizationType): OrganizationVotingRule {
  if (type === 'league') return 'unanimity';
  if (type === 'defensive_union') return 'qualified_majority';
  if (type === 'international_organization') return 'qualified_majority';
  return 'simple_majority';
}

function agendaFor(type: DiplomaticOrganizationType): OrganizationAgenda {
  if (type === 'commercial_bloc') return 'trade';
  if (type === 'international_organization') return 'stability';
  return 'security';
}

function organizationName(type: DiplomaticOrganizationType, leaderId: string, year: number) {
  if (type === 'league') return `Liga de ${leaderId}`;
  if (type === 'defensive_union') return `União Defensiva de ${leaderId}`;
  if (type === 'commercial_bloc') return year < 1800 ? `Liga Mercantil de ${leaderId}` : `Bloco Comercial de ${leaderId}`;
  return `Organização de Cooperação de ${leaderId}`;
}

function connectedGroups(simulation: SimulationState) {
  const ids = Object.keys(simulation.entities);
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const alliance = activeTreaty(simulation, a, b, 'alliance');
      const trade = activeTreaty(simulation, a, b, 'trade');
      const relation = simulation.diplomacy[pairKey(a, b)];
      const aligned = !!relation && relation.score >= 58 && relation.trust >= 55 && relation.threat <= 42;
      if (alliance || trade || aligned) {
        adjacency.get(a)?.add(b);
        adjacency.get(b)?.add(a);
      }
    }
  }

  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const start of ids) {
    if (visited.has(start)) continue;
    const queue = [start];
    const group: string[] = [];
    visited.add(start);
    while (queue.length) {
      const current = queue.shift()!;
      group.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    if (group.length >= 3) groups.push(group);
  }
  return groups;
}

function groupMetrics(simulation: SimulationState, members: string[]) {
  let securityLinks = 0;
  let tradeLinks = 0;
  let relationTotal = 0;
  let relationCount = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      if (activeTreaty(simulation, a, b, 'alliance')) securityLinks += 1;
      if (activeTreaty(simulation, a, b, 'trade')) tradeLinks += 1;
      if (simulation.diplomacy[pairKey(a, b)]) {
        relationTotal += relationScore(simulation, a, b);
        relationCount += 1;
      }
    }
  }
  const averageRelation = relationCount ? relationTotal / relationCount : 0;
  return { securityLinks, tradeLinks, averageRelation };
}

function cohesionFor(simulation: SimulationState, organization: DiplomaticOrganization) {
  const metrics = groupMetrics(simulation, organization.memberIds);
  const treatyDensity = (metrics.securityLinks + metrics.tradeLinks) / Math.max(1, organization.memberIds.length - 1);
  const geopolitical = geopoliticalState();
  const rivalPairs = geopolitical.links.filter((link) => link.posture === 'rival' && organization.memberIds.includes(link.parties[0]) && organization.memberIds.includes(link.parties[1])).length;
  return clamp(42 + metrics.averageRelation * 0.42 + treatyDensity * 7 - rivalPairs * 12, 0, 100);
}

function leaderFor(simulation: SimulationState, members: string[]) {
  return [...members].sort((a, b) => statePower(simulation, b) - statePower(simulation, a))[0];
}

function sameMembers(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function makeOrganization(simulation: SimulationState, members: string[]): DiplomaticOrganization | undefined {
  const metrics = groupMetrics(simulation, members);
  if (metrics.averageRelation < 35 || metrics.securityLinks + metrics.tradeLinks < 2) return undefined;
  const leaderId = leaderFor(simulation, members);
  const type = organizationType(simulation.date.year, metrics.securityLinks, metrics.tradeLinks);
  return {
    id: `organization-${leaderId}-${simulation.date.year}-${members.slice().sort().join('-')}`,
    name: organizationName(type, leaderId, simulation.date.year),
    type,
    foundedYear: simulation.date.year,
    leaderId,
    memberIds: [...members].sort(),
    votingRule: votingRuleFor(type),
    agenda: agendaFor(type),
    cohesion: clamp(48 + metrics.averageRelation * 0.35),
    legitimacy: clamp(50 + members.length * 5 + Math.max(0, metrics.averageRelation) * 0.25),
    active: true,
    lastReviewYear: simulation.date.year,
  };
}

function voteThreshold(rule: OrganizationVotingRule, voters: number) {
  if (rule === 'unanimity') return voters;
  if (rule === 'qualified_majority') return Math.ceil(voters * 0.66);
  return Math.floor(voters / 2) + 1;
}

function automatedVote(simulation: SimulationState, organization: DiplomaticOrganization, proposal: OrganizationProposal, memberId: string): OrganizationVoteChoice {
  if (memberId === simulation.playerEntityId) return 'abstain';
  const sponsorAffinity = relationScore(simulation, memberId, proposal.sponsorId);
  let score = 48 + sponsorAffinity * 0.24 + organization.cohesion * 0.14;
  if (proposal.targetId) score += relationScore(simulation, memberId, proposal.targetId) * 0.18;
  if (proposal.type === 'defensive_coordination' && organization.agenda === 'security') score += 10;
  if (proposal.type === 'trade_integration' && organization.agenda === 'trade') score += 10;
  if (proposal.type === 'discipline_member' && proposal.targetId === memberId) score -= 45;
  if (score >= 62) return 'yes';
  if (score <= 40) return 'no';
  return 'abstain';
}

function resolveProposal(state: DiplomaticOrganizationState, simulation: SimulationState, proposal: OrganizationProposal) {
  const organization = state.organizations.find((item) => item.id === proposal.organizationId && item.active);
  if (!organization) return { state, simulation };
  const votes = { ...proposal.votes };
  for (const memberId of organization.memberIds) {
    if (!votes[memberId]) votes[memberId] = automatedVote(simulation, organization, proposal, memberId);
  }
  const yes = Object.values(votes).filter((vote) => vote === 'yes').length;
  const passed = yes >= voteThreshold(organization.votingRule, organization.memberIds.length);
  const resolved: OrganizationProposal = { ...proposal, votes, status: passed ? 'passed' : 'rejected' };
  let nextSimulation = simulation;
  let nextOrganization = organization;

  if (passed && proposal.type === 'admit_member' && proposal.targetId && !organization.memberIds.includes(proposal.targetId)) {
    nextOrganization = { ...organization, memberIds: [...organization.memberIds, proposal.targetId], cohesion: clamp(organization.cohesion - 4), lastReviewYear: simulation.date.year };
  } else if (passed && proposal.type === 'defensive_coordination') {
    nextOrganization = { ...organization, cohesion: clamp(organization.cohesion + 4), legitimacy: clamp(organization.legitimacy + 2) };
  } else if (passed && proposal.type === 'trade_integration') {
    nextOrganization = { ...organization, cohesion: clamp(organization.cohesion + 3), legitimacy: clamp(organization.legitimacy + 2) };
  } else if (passed && proposal.type === 'discipline_member' && proposal.targetId) {
    nextOrganization = { ...organization, memberIds: organization.memberIds.filter((id) => id !== proposal.targetId), cohesion: clamp(organization.cohesion - 5) };
  }

  const event: WorldEvent = {
    id: `organization-vote-${proposal.id}-${simulation.elapsedDays}`,
    date: simulation.date,
    category: 'diplomacy',
    title: passed ? 'Organização: resolução aprovada' : 'Organização: resolução rejeitada',
    text: `${organization.name} ${passed ? 'aprovou' : 'rejeitou'} a proposta “${proposal.summary}” por ${yes} voto(s) favorável(is).`,
  };
  nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
  return {
    state: {
      ...state,
      organizations: state.organizations.map((item) => item.id === organization.id ? nextOrganization : item),
      proposals: state.proposals.map((item) => item.id === proposal.id ? resolved : item),
    },
    simulation: nextSimulation,
  };
}

export function castOrganizationVote(organizationId: string, proposalId: string, memberId: string, choice: OrganizationVoteChoice) {
  const state = rootState();
  const organization = state.organizations.find((item) => item.id === organizationId && item.active);
  const proposal = state.proposals.find((item) => item.id === proposalId && item.status === 'open');
  if (!organization || !proposal || !organization.memberIds.includes(memberId)) return false;
  publish({ ...state, proposals: state.proposals.map((item) => item.id === proposalId ? { ...item, votes: { ...item.votes, [memberId]: choice } } : item) });
  return true;
}

export function createOrganizationProposal(organizationId: string, sponsorId: string, type: OrganizationProposalType, simulation: SimulationState, targetId?: string) {
  const state = rootState();
  const organization = state.organizations.find((item) => item.id === organizationId && item.active);
  if (!organization || !organization.memberIds.includes(sponsorId)) return undefined;
  if (state.proposals.some((item) => item.organizationId === organizationId && item.status === 'open')) return undefined;
  const summary = type === 'admit_member' ? `Admitir ${targetId ?? 'novo membro'}` : type === 'defensive_coordination' ? 'Aprofundar coordenação defensiva' : type === 'trade_integration' ? 'Aprofundar integração comercial' : `Aplicar sanção interna a ${targetId ?? 'membro'}`;
  const proposal: OrganizationProposal = {
    id: `organization-proposal-${organizationId}-${simulation.date.year}-${simulation.elapsedDays}`,
    organizationId,
    type,
    sponsorId,
    targetId,
    openedYear: simulation.date.year,
    deadlineYear: simulation.date.year + 1,
    status: 'open',
    votes: { [sponsorId]: 'yes' },
    summary,
  };
  publish({ ...state, proposals: [proposal, ...state.proposals].slice(0, 80) });
  return proposal;
}

export function runAnnualDiplomaticOrganizations(simulation: SimulationState): SimulationState {
  const current = rootState();
  if (current.lastProcessedYear === simulation.date.year) return simulation;
  let state = { ...current, organizations: current.organizations.map((item) => ({ ...item, memberIds: [...item.memberIds] })), proposals: current.proposals.map((item) => ({ ...item, votes: { ...item.votes } })) };
  let nextSimulation = simulation;
  const events: WorldEvent[] = [];

  for (const proposal of state.proposals.filter((item) => item.status === 'open' && item.deadlineYear <= simulation.date.year)) {
    const resolved = resolveProposal(state, nextSimulation, proposal);
    state = resolved.state;
    nextSimulation = resolved.simulation;
  }

  const groups = connectedGroups(nextSimulation);
  for (const members of groups) {
    const existing = state.organizations.find((item) => item.active && sameMembers(item.memberIds, members));
    if (existing) continue;
    const organization = makeOrganization(nextSimulation, members);
    if (!organization) continue;
    state.organizations = [organization, ...state.organizations].slice(0, 30);
    events.push({
      id: `organization-founded-${organization.id}`,
      date: nextSimulation.date,
      category: 'diplomacy',
      title: 'Novo bloco diplomático',
      text: `${organization.name} foi formado por ${organization.memberIds.length} membros com agenda principal de ${organization.agenda}.`,
    });
  }

  state.organizations = state.organizations.map((organization) => {
    if (!organization.active) return organization;
    const cohesion = cohesionFor(nextSimulation, organization);
    if (organization.memberIds.length < 2 || cohesion < 18) {
      events.push({
        id: `organization-collapse-${organization.id}-${nextSimulation.date.year}`,
        date: nextSimulation.date,
        category: 'diplomacy',
        title: 'Colapso de bloco diplomático',
        text: `${organization.name} deixou de funcionar após perda prolongada de coesão entre seus membros.`,
      });
      return { ...organization, cohesion, active: false, lastReviewYear: nextSimulation.date.year };
    }
    const leaderId = leaderFor(nextSimulation, organization.memberIds);
    return { ...organization, leaderId, cohesion, legitimacy: clamp(organization.legitimacy + (cohesion - 50) * 0.04), lastReviewYear: nextSimulation.date.year };
  });

  for (const organization of state.organizations.filter((item) => item.active)) {
    if (state.proposals.some((item) => item.organizationId === organization.id && item.status === 'open')) continue;
    const roll = (organization.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) + nextSimulation.date.year) % 4;
    if (roll !== 0) continue;
    const type: OrganizationProposalType = organization.agenda === 'trade' ? 'trade_integration' : 'defensive_coordination';
    const proposal: OrganizationProposal = {
      id: `organization-proposal-${organization.id}-${nextSimulation.date.year}`,
      organizationId: organization.id,
      type,
      sponsorId: organization.leaderId,
      openedYear: nextSimulation.date.year,
      deadlineYear: nextSimulation.date.year + 1,
      status: 'open',
      votes: { [organization.leaderId]: 'yes' },
      summary: type === 'trade_integration' ? 'Aprofundar integração comercial' : 'Aprofundar coordenação defensiva',
    };
    state.proposals = [proposal, ...state.proposals].slice(0, 80);
  }

  state.lastProcessedYear = nextSimulation.date.year;
  publish(state);
  if (events.length) nextSimulation = { ...nextSimulation, events: [...events.slice(0, 6), ...nextSimulation.events].slice(0, 50) };
  return nextSimulation;
}

export function organizationsForEntity(entityId: string) {
  const state = rootState();
  return state.organizations.filter((organization) => organization.active && organization.memberIds.includes(entityId));
}

export function proposalsForOrganization(organizationId: string) {
  return rootState().proposals.filter((proposal) => proposal.organizationId === organizationId);
}
