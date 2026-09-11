import { coalitionPromises, type CoalitionRewardType } from './allianceCommand';
import { coalitionGoalsForWar } from './coalitionGoals';
import { pairKey, type SimulationState } from './simulation';
import { postWarState } from './peace';
import type { TerritorialControlState } from './territorialControl';
import type { War } from './war';

export type PeaceConferenceStatus = 'open' | 'settled';
export type PeaceConferenceAllocation = {
  id: string;
  memberId: string;
  type: CoalitionRewardType;
  value: number;
  locationId?: string;
};

export type PeaceConferenceExpectation = {
  memberId: string;
  expectedValue: number;
  promisedTypes: CoalitionRewardType[];
  goalLabel: string;
};

export type PeaceConferenceDispute = {
  id: string;
  warId: string;
  claimantId: string;
  leaderId: string;
  severity: number;
  reason: string;
  createdAtElapsedDay: number;
};

export type PeaceConference = {
  id: string;
  warId: string;
  winnerSide: 'attacker' | 'defender';
  leaderId: string;
  participantIds: string[];
  availableLocationIds: string[];
  reparationsPool: number;
  allocations: PeaceConferenceAllocation[];
  status: PeaceConferenceStatus;
  openedAtElapsedDay: number;
  finalizedAtElapsedDay?: number;
  fairness?: number;
  dissenters?: number;
};

type PeaceConferenceState = {
  conferences: PeaceConference[];
  disputes: PeaceConferenceDispute[];
};

type ConferenceGlobal = typeof globalThis & { __WORLD_STATE_POSTWAR_CONFERENCES__?: PeaceConferenceState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): PeaceConferenceState {
  const root = globalThis as ConferenceGlobal;
  if (!root.__WORLD_STATE_POSTWAR_CONFERENCES__) root.__WORLD_STATE_POSTWAR_CONFERENCES__ = { conferences: [], disputes: [] };
  return root.__WORLD_STATE_POSTWAR_CONFERENCES__;
}

function publish(next: PeaceConferenceState) {
  (globalThis as ConferenceGlobal).__WORLD_STATE_POSTWAR_CONFERENCES__ = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-postwar-conferences', { detail: next }));
}

export function resetPostWarConferences() {
  publish({ conferences: [], disputes: [] });
}

export function postWarConferences() {
  return rootState().conferences.map((item) => ({ ...item, allocations: [...item.allocations], participantIds: [...item.participantIds], availableLocationIds: [...item.availableLocationIds] }));
}

export function postWarDisputes(entityId?: string) {
  const disputes = rootState().disputes;
  return entityId ? disputes.filter((item) => item.claimantId === entityId || item.leaderId === entityId) : [...disputes];
}

function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, memory: string) {
  const key = pairKey(a, b);
  const current = simulation.diplomacy[key];
  if (!current) return simulation;
  return {
    ...simulation,
    diplomacy: {
      ...simulation.diplomacy,
      [key]: {
        ...current,
        score: clamp(current.score + scoreDelta, -100, 100),
        trust: clamp(current.trust + trustDelta),
        memory: [memory, ...current.memory].slice(0, 8),
      },
    },
  };
}

function winnerInfo(war: War) {
  if (war.victor === 'attackers') return { side: 'attacker' as const, leaderId: war.attackerId, members: war.attackers };
  if (war.victor === 'defenders') return { side: 'defender' as const, leaderId: war.defenderId, members: war.defenders };
  return undefined;
}

export function openPostWarConference(war: War, simulation: SimulationState) {
  const winner = winnerInfo(war);
  if (war.status !== 'ended' || !winner) return undefined;
  const existing = rootState().conferences.find((item) => item.warId === war.id);
  if (existing) return existing;
  const memory = postWarState().peaceHistory.find((item) => item.warId === war.id);
  const participants = winner.members.filter((id) => id !== winner.leaderId);
  const reparationsPool = memory?.term === 'reparations' ? 12 : memory?.term === 'limited_annexation' ? 5 : 7;
  const conference: PeaceConference = {
    id: `postwar-conference-${war.id}`,
    warId: war.id,
    winnerSide: winner.side,
    leaderId: winner.leaderId,
    participantIds: participants,
    availableLocationIds: [...(memory?.transferredLocationIds ?? [])],
    reparationsPool,
    allocations: [],
    status: 'open',
    openedAtElapsedDay: simulation.elapsedDays,
  };
  publish({ ...rootState(), conferences: [conference, ...rootState().conferences].slice(0, 40) });
  return conference;
}

export function expectationsForConference(conference: PeaceConference, war: War, simulation: SimulationState, control: TerritorialControlState): PeaceConferenceExpectation[] {
  const goals = coalitionGoalsForWar(war, simulation, control);
  const promises = coalitionPromises(war.id);
  return conference.participantIds.map((memberId) => {
    const goal = goals.find((item) => item.entityId === memberId);
    const memberPromises = promises.filter((item) => item.memberId === memberId && !item.broken);
    const expectedValue = clamp(26 + (goal?.priority ?? 50) * 0.42 + memberPromises.length * 18 + (100 - (goal?.satisfaction ?? 50)) * 0.12, 20, 100);
    return {
      memberId,
      expectedValue,
      promisedTypes: [...new Set(memberPromises.map((item) => item.type))],
      goalLabel: goal?.label ?? 'Participação na vitória da coalizão',
    };
  });
}

function allocationValue(type: CoalitionRewardType) {
  if (type === 'territory') return 42;
  if (type === 'reparations') return 28;
  if (type === 'influence') return 24;
  return 20;
}

export function allocateConferenceReward(
  conferenceId: string,
  memberId: string,
  type: CoalitionRewardType,
  simulation: SimulationState,
  control: TerritorialControlState,
  locationId?: string,
) {
  const current = rootState();
  const conference = current.conferences.find((item) => item.id === conferenceId);
  if (!conference || conference.status !== 'open') return { accepted: false, simulation, territorialControl: control, message: 'A conferência não está aberta.' };
  if (!conference.participantIds.includes(memberId)) return { accepted: false, simulation, territorialControl: control, message: 'Selecione um membro vencedor elegível.' };
  if (type === 'territory' && (!locationId || !conference.availableLocationIds.includes(locationId))) return { accepted: false, simulation, territorialControl: control, message: 'Selecione um território conquistado ainda disponível para partilha.' };
  if (type === 'reparations') {
    const used = conference.allocations.filter((item) => item.type === 'reparations').reduce((sum, item) => sum + item.value, 0);
    if (used + 3 > conference.reparationsPool) return { accepted: false, simulation, territorialControl: control, message: 'A parcela disponível de reparações já foi distribuída.' };
  }

  const value = type === 'reparations' ? 3 : allocationValue(type);
  const allocation: PeaceConferenceAllocation = {
    id: `allocation-${conference.id}-${memberId}-${type}-${conference.allocations.length + 1}`,
    memberId,
    type,
    value,
    locationId: type === 'territory' ? locationId : undefined,
  };
  const allocations = [...conference.allocations, allocation];
  const availableLocationIds = type === 'territory' && locationId ? conference.availableLocationIds.filter((id) => id !== locationId) : conference.availableLocationIds;
  const nextConference = { ...conference, allocations, availableLocationIds };
  publish({ ...current, conferences: current.conferences.map((item) => item.id === conference.id ? nextConference : item) });

  let nextSimulation = simulation;
  let nextControl = control;
  if (type === 'territory' && locationId) {
    const occupation = control.occupations[locationId];
    if (occupation) {
      nextControl = {
        ...control,
        occupations: {
          ...control.occupations,
          [locationId]: { ...occupation, ownerId: memberId, controllerId: memberId, warId: `conference-${conference.warId}`, progress: 0, contested: false },
        },
      };
    }
    nextSimulation = mutateRelation(nextSimulation, memberId, conference.leaderId, 7, 9, 'Recebeu território na partilha dos ganhos de guerra.');
  } else if (type === 'reparations') {
    const leader = nextSimulation.entities[conference.leaderId];
    const member = nextSimulation.entities[memberId];
    if (leader && member) {
      nextSimulation = {
        ...nextSimulation,
        entities: {
          ...nextSimulation.entities,
          [conference.leaderId]: { ...leader, treasuryIndex: clamp(leader.treasuryIndex - 2.2) },
          [memberId]: { ...member, treasuryIndex: clamp(member.treasuryIndex + 2.2) },
        },
      };
    }
    nextSimulation = mutateRelation(nextSimulation, memberId, conference.leaderId, 5, 6, 'Recebeu participação nas reparações de guerra.');
  } else if (type === 'influence') {
    nextSimulation = mutateRelation(nextSimulation, memberId, conference.leaderId, 5, 7, 'Recebeu participação política e influência no arranjo pós-guerra.');
  } else if (type === 'security') {
    nextSimulation = mutateRelation(nextSimulation, memberId, conference.leaderId, 4, 8, 'Recebeu garantia política de segurança no arranjo pós-guerra.');
  }

  return { accepted: true, simulation: nextSimulation, territorialControl: nextControl, conference: nextConference, message: 'Recompensa adicionada à partilha da conferência.' };
}

export function finalizePostWarConference(
  conferenceId: string,
  war: War,
  simulation: SimulationState,
  control: TerritorialControlState,
) {
  const current = rootState();
  const conference = current.conferences.find((item) => item.id === conferenceId);
  if (!conference || conference.status !== 'open') return { accepted: false, simulation, message: 'A conferência não está aberta.' };
  const expectations = expectationsForConference(conference, war, simulation, control);
  const promises = coalitionPromises(war.id);
  let nextSimulation = simulation;
  const disputes: PeaceConferenceDispute[] = [];
  let totalSatisfaction = 0;
  let dissenters = 0;

  for (const expectation of expectations) {
    const allocations = conference.allocations.filter((item) => item.memberId === expectation.memberId);
    const delivered = allocations.reduce((sum, item) => sum + (item.type === 'reparations' ? item.value * 9 : item.value), 0);
    const promised = promises.filter((item) => item.memberId === expectation.memberId && !item.broken);
    const matchedPromises = promised.filter((promise) => allocations.some((allocation) => allocation.type === promise.type && (!promise.locationId || allocation.locationId === promise.locationId))).length;
    const promiseRatio = promised.length ? matchedPromises / promised.length : 1;
    const satisfaction = clamp((delivered / Math.max(20, expectation.expectedValue)) * 72 + promiseRatio * 28, 0, 100);
    totalSatisfaction += satisfaction;
    if (satisfaction < 48) {
      dissenters += 1;
      const severity = clamp(52 + (48 - satisfaction) * 0.8 + promised.length * 7, 45, 95);
      disputes.push({
        id: `peace-dispute-${war.id}-${expectation.memberId}-${simulation.elapsedDays}`,
        warId: war.id,
        claimantId: expectation.memberId,
        leaderId: conference.leaderId,
        severity,
        reason: promised.length && matchedPromises < promised.length ? 'Promessas de guerra não foram integralmente cumpridas na conferência de paz.' : 'A entidade considera injusta sua parcela dos ganhos da vitória.',
        createdAtElapsedDay: simulation.elapsedDays,
      });
      nextSimulation = mutateRelation(nextSimulation, expectation.memberId, conference.leaderId, -Math.round(severity / 8), -Math.round(severity / 6), 'Saiu da conferência de paz considerando injusta a divisão dos ganhos da guerra.');
    } else if (satisfaction >= 72) {
      nextSimulation = mutateRelation(nextSimulation, expectation.memberId, conference.leaderId, 5, 7, 'Considerou justa a divisão dos ganhos na conferência de paz.');
    }
  }

  const fairness = expectations.length ? totalSatisfaction / expectations.length : 100;
  const settled: PeaceConference = { ...conference, status: 'settled', finalizedAtElapsedDay: simulation.elapsedDays, fairness, dissenters };
  publish({
    conferences: current.conferences.map((item) => item.id === conference.id ? settled : item),
    disputes: [...disputes, ...current.disputes].slice(0, 80),
  });
  return {
    accepted: true,
    simulation: nextSimulation,
    conference: settled,
    disputes,
    message: dissenters
      ? `A conferência terminou com justiça percebida de ${fairness.toFixed(0)}%. ${dissenters} aliado(s) deixaram a mesa insatisfeitos e podem transformar a disputa em crise diplomática.`
      : `A conferência terminou com justiça percebida de ${fairness.toFixed(0)}%. A coalizão aceitou amplamente a partilha.`,
  };
}
