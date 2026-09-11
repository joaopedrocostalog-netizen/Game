import type { ArmyState } from './army';
import { jointForceState } from './jointOrganizationForces';
import type { SimulationState, WorldEvent } from './simulation';
import {
  assignUnitToFront,
  clearUnitFrontAssignment,
  setFrontOrder,
  setFrontPriority,
  type FrontOrder,
  type FrontPriority,
  type WarState,
} from './war';

export type TheaterPosture = 'defensive' | 'balanced' | 'offensive' | 'breakthrough';
export type NationalCaveat = 'full_authority' | 'limited_offensive' | 'defensive_only' | 'national_reserve' | 'withdrawal_requested';

export type TheaterFrontPlan = {
  frontId: string;
  priority: FrontPriority;
  order: FrontOrder;
  objective: string;
  assignedUnitIds: string[];
};

export type NationalCommandRestriction = {
  memberId: string;
  caveat: NationalCaveat;
  imposedAtElapsedDay: number;
  politicalPressure: number;
};

export type CommandDispute = {
  id: string;
  memberId: string;
  reason: string;
  severity: number;
  createdAtElapsedDay: number;
  resolved: boolean;
};

export type MultinationalTheaterHQ = {
  id: string;
  forceId: string;
  warId: string;
  side: 'attackers' | 'defenders';
  commanderEntityId: string;
  headquartersLocationId?: string;
  posture: TheaterPosture;
  authority: number;
  coordination: number;
  frontPlans: TheaterFrontPlan[];
  restrictions: NationalCommandRestriction[];
  disputes: CommandDispute[];
  createdAtElapsedDay: number;
};

type TheaterState = { headquarters: MultinationalTheaterHQ[] };
type TheaterGlobal = typeof globalThis & { __WORLD_STATE_THEATER_HQ__?: TheaterState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): TheaterState {
  const root = globalThis as TheaterGlobal;
  if (!root.__WORLD_STATE_THEATER_HQ__) root.__WORLD_STATE_THEATER_HQ__ = { headquarters: [] };
  return root.__WORLD_STATE_THEATER_HQ__;
}

function publish(state: TheaterState) {
  (globalThis as TheaterGlobal).__WORLD_STATE_THEATER_HQ__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-theater-hq', { detail: state }));
}

export function theaterCommandState() {
  return {
    headquarters: rootState().headquarters.map((hq) => ({
      ...hq,
      frontPlans: hq.frontPlans.map((plan) => ({ ...plan, assignedUnitIds: [...plan.assignedUnitIds] })),
      restrictions: hq.restrictions.map((item) => ({ ...item })),
      disputes: hq.disputes.map((item) => ({ ...item })),
    })),
  };
}

export function resetMultinationalTheaterCommands() {
  publish({ headquarters: [] });
}

function forceById(forceId: string) {
  return jointForceState().forces.find((force) => force.id === forceId && force.status !== 'dissolved');
}

function restrictionFor(hq: MultinationalTheaterHQ, memberId: string) {
  return hq.restrictions.find((item) => item.memberId === memberId)?.caveat ?? 'full_authority';
}

function postureDefaults(posture: TheaterPosture): { priority: FrontPriority; order: FrontOrder } {
  if (posture === 'defensive') return { priority: 'high', order: 'defend' };
  if (posture === 'offensive') return { priority: 'high', order: 'offensive' };
  if (posture === 'breakthrough') return { priority: 'main', order: 'breakthrough' };
  return { priority: 'normal', order: 'cautious' };
}

function permittedOrder(caveat: NationalCaveat, order: FrontOrder) {
  if (caveat === 'withdrawal_requested' || caveat === 'national_reserve') return false;
  if (caveat === 'defensive_only') return order === 'defend' || order === 'cautious' || order === 'reserve' || order === 'withdraw';
  if (caveat === 'limited_offensive') return order !== 'breakthrough';
  return true;
}

function coordinationFor(hq: MultinationalTheaterHQ) {
  const force = forceById(hq.forceId);
  if (!force) return 0;
  const activeRestrictions = hq.restrictions.filter((item) => item.caveat !== 'full_authority').length;
  const unresolved = hq.disputes.filter((item) => !item.resolved).reduce((sum, item) => sum + item.severity, 0);
  const doctrineBonus = force.doctrine === 'unified_command' ? 10 : force.doctrine === 'lead_nation' ? 5 : -2;
  return clamp(force.commandCohesion * .58 + force.readiness * .22 + hq.authority * .2 + doctrineBonus - activeRestrictions * 4 - unresolved * .08);
}

export function createMultinationalTheaterHQ(forceId: string, warId: string, simulation: SimulationState, warState: WarState) {
  const force = forceById(forceId);
  const war = warState.wars.find((item) => item.id === warId && item.status === 'active');
  if (!force || !war || force.status !== 'deployed' || force.deployedWarId !== warId || !force.deployedSide) return undefined;
  const existing = rootState().headquarters.find((item) => item.forceId === forceId && item.warId === warId);
  if (existing) return existing;
  const defaults = postureDefaults('balanced');
  const frontPlans: TheaterFrontPlan[] = war.fronts.map((front) => ({
    frontId: front.id,
    priority: defaults.priority,
    order: defaults.order,
    objective: front.locationId ? `Controlar ${front.name}` : `Estabilizar ${front.name}`,
    assignedUnitIds: [],
  }));
  const hq: MultinationalTheaterHQ = {
    id: `theater-hq-${forceId}-${warId}`,
    forceId,
    warId,
    side: force.deployedSide,
    commanderEntityId: force.commanderEntityId,
    posture: 'balanced',
    authority: clamp(48 + force.commandCohesion * .42),
    coordination: 0,
    frontPlans,
    restrictions: force.contributions.map((item) => ({ memberId: item.memberId, caveat: 'full_authority', imposedAtElapsedDay: simulation.elapsedDays, politicalPressure: 28 })),
    disputes: [],
    createdAtElapsedDay: simulation.elapsedDays,
  };
  hq.coordination = coordinationFor(hq);
  publish({ headquarters: [hq, ...rootState().headquarters].slice(0, 30) });
  return hq;
}

export function setTheaterPosture(hqId: string, posture: TheaterPosture) {
  const state = rootState();
  const hq = state.headquarters.find((item) => item.id === hqId);
  if (!hq) return undefined;
  const defaults = postureDefaults(posture);
  const updated: MultinationalTheaterHQ = {
    ...hq,
    posture,
    frontPlans: hq.frontPlans.map((plan, index) => ({ ...plan, priority: index === 0 ? defaults.priority : plan.priority, order: defaults.order })),
  };
  updated.coordination = coordinationFor(updated);
  publish({ headquarters: state.headquarters.map((item) => item.id === hq.id ? updated : item) });
  return updated;
}

export function setNationalCaveat(hqId: string, memberId: string, caveat: NationalCaveat, simulation: SimulationState) {
  const state = rootState();
  const hq = state.headquarters.find((item) => item.id === hqId);
  const force = hq ? forceById(hq.forceId) : undefined;
  if (!hq || !force || !force.contributions.some((item) => item.memberId === memberId)) return undefined;
  const pressure = caveat === 'withdrawal_requested' ? 88 : caveat === 'national_reserve' ? 65 : caveat === 'defensive_only' ? 54 : caveat === 'limited_offensive' ? 42 : 20;
  let disputes = hq.disputes;
  if (caveat !== 'full_authority') {
    disputes = [{
      id: `command-dispute-${hq.id}-${memberId}-${simulation.elapsedDays}`,
      memberId,
      reason: caveat === 'withdrawal_requested' ? 'O governo nacional exige a retirada de seu contingente.' : caveat === 'national_reserve' ? 'O governo nacional retirou seu contingente da autoridade operacional do teatro.' : 'O governo nacional impôs restrições às ordens do comando multinacional.',
      severity: pressure,
      createdAtElapsedDay: simulation.elapsedDays,
      resolved: false,
    }, ...disputes].slice(0, 30);
  } else {
    disputes = disputes.map((item) => item.memberId === memberId && !item.resolved ? { ...item, resolved: true } : item);
  }
  const updated: MultinationalTheaterHQ = {
    ...hq,
    restrictions: hq.restrictions.map((item) => item.memberId === memberId ? { ...item, caveat, imposedAtElapsedDay: simulation.elapsedDays, politicalPressure: pressure } : item),
    disputes,
  };
  updated.coordination = coordinationFor(updated);
  publish({ headquarters: state.headquarters.map((item) => item.id === hq.id ? updated : item) });
  return updated;
}

export function updateFrontPlan(hqId: string, frontId: string, priority: FrontPriority, order: FrontOrder, objective: string) {
  const state = rootState();
  const hq = state.headquarters.find((item) => item.id === hqId);
  if (!hq) return undefined;
  const updated = {
    ...hq,
    frontPlans: hq.frontPlans.map((plan) => plan.frontId === frontId ? { ...plan, priority, order, objective } : plan),
  };
  publish({ headquarters: state.headquarters.map((item) => item.id === hq.id ? updated : item) });
  return updated;
}

export function applyTheaterPlan(hqId: string, simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  const hq = state.headquarters.find((item) => item.id === hqId);
  const force = hq ? forceById(hq.forceId) : undefined;
  const war = hq ? warState.wars.find((item) => item.id === hq.warId && item.status === 'active') : undefined;
  if (!hq || !force || !war) return { accepted: false, armyState, warState, simulation, message: 'Quartel-general indisponível.' };
  const jointUnitIds = new Set(force.contributions.flatMap((item) => item.unitIds));
  const units = armyState.units.filter((unit) => jointUnitIds.has(unit.id));
  let nextWar = warState;
  for (const plan of hq.frontPlans) {
    nextWar = setFrontPriority(nextWar, war.id, plan.frontId, hq.side === 'attackers' ? 'attacker' : 'defender', plan.priority);
    nextWar = setFrontOrder(nextWar, war.id, plan.frontId, hq.side === 'attackers' ? 'attacker' : 'defender', plan.order);
  }
  for (const unit of units) nextWar = clearUnitFrontAssignment(nextWar, war.id, unit.id);

  const eligible = units.filter((unit) => permittedOrder(restrictionFor(hq, unit.entityId), hq.frontPlans[0]?.order ?? 'cautious'));
  const activePlans = hq.frontPlans.filter((plan) => plan.order !== 'reserve' && plan.order !== 'withdraw');
  eligible.forEach((unit, index) => {
    const allowedPlans = activePlans.filter((plan) => permittedOrder(restrictionFor(hq, unit.entityId), plan.order));
    const plan = allowedPlans[index % Math.max(1, allowedPlans.length)];
    if (plan) nextWar = assignUnitToFront(nextWar, war.id, plan.frontId, hq.side === 'attackers' ? 'attacker' : 'defender', unit.id);
  });

  const blocked = units.filter((unit) => !eligible.some((candidate) => candidate.id === unit.id)).map((unit) => unit.entityId);
  const updated: MultinationalTheaterHQ = {
    ...hq,
    coordination: coordinationFor(hq),
    frontPlans: hq.frontPlans.map((plan) => ({
      ...plan,
      assignedUnitIds: nextWar.wars.find((item) => item.id === war.id)?.fronts.find((front) => front.id === plan.frontId)
        ? [...(hq.side === 'attackers'
          ? nextWar.wars.find((item) => item.id === war.id)!.fronts.find((front) => front.id === plan.frontId)!.attackerAssignments
          : nextWar.wars.find((item) => item.id === war.id)!.fronts.find((front) => front.id === plan.frontId)!.defenderAssignments)].filter((id) => jointUnitIds.has(id))
        : [],
    })),
  };
  publish({ headquarters: state.headquarters.map((item) => item.id === hq.id ? updated : item) });
  const event: WorldEvent = {
    id: `theater-plan-${hq.id}-${simulation.elapsedDays}`,
    date: simulation.date,
    category: 'military',
    title: 'Plano operacional multinacional emitido',
    text: `${force.name} distribuiu ${eligible.length} formação(ões) entre ${activePlans.length} frente(s). ${blocked.length ? `${blocked.length} contingente(s) ficaram limitados por ordens nacionais.` : 'Todos os contingentes aceitaram a autoridade operacional.'}`,
  };
  return { accepted: true, armyState, warState: nextWar, simulation: { ...simulation, events: [event, ...simulation.events].slice(0, 50) }, hq: updated, message: 'Plano operacional aplicado às frentes.' };
}

export function requestContingentWithdrawal(hqId: string, memberId: string, simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  const hq = state.headquarters.find((item) => item.id === hqId);
  const force = hq ? forceById(hq.forceId) : undefined;
  const war = hq ? warState.wars.find((item) => item.id === hq.warId) : undefined;
  const contribution = force?.contributions.find((item) => item.memberId === memberId);
  if (!hq || !force || !war || !contribution) return { accepted: false, armyState, warState, simulation, message: 'Contingente indisponível.' };
  let nextWar = warState;
  for (const unitId of contribution.unitIds) nextWar = clearUnitFrontAssignment(nextWar, war.id, unitId);
  const nextArmy: ArmyState = {
    ...armyState,
    units: armyState.units.map((unit) => contribution.unitIds.includes(unit.id) ? { ...unit, order: 'retreat', destinationId: undefined, movementProgress: 0, morale: clamp(unit.morale - 4) } : unit),
  };
  const updated = setNationalCaveat(hq.id, memberId, 'withdrawal_requested', simulation);
  const event: WorldEvent = {
    id: `theater-withdrawal-${hq.id}-${memberId}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId: memberId,
    category: 'military',
    title: 'Retirada nacional do comando conjunto',
    text: `${memberId} retirou suas formações da linha de frente e solicitou saída da autoridade operacional multinacional.`,
  };
  return { accepted: true, armyState: nextArmy, warState: nextWar, simulation: { ...simulation, events: [event, ...simulation.events].slice(0, 50) }, hq: updated, message: 'O contingente foi retirado das frentes e colocado sob ordem nacional.' };
}

export function headquartersForForce(forceId: string) {
  return rootState().headquarters.filter((hq) => hq.forceId === forceId);
}
