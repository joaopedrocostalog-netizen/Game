import type { ArmyState, ArmyUnit, Commander } from './army';
import { diplomaticOrganizationState } from './diplomaticOrganizations';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import { setMobilization, type WarState } from './war';

export type JointForceStatus = 'forming' | 'ready' | 'deployed' | 'dissolved';
export type JointCommandDoctrine = 'consensus' | 'lead_nation' | 'unified_command';

export type JointForceContribution = {
  memberId: string;
  personnel: number;
  unitIds: string[];
  budgetShare: number;
  politicalSupport: number;
};

export type JointOrganizationForce = {
  id: string;
  organizationId: string;
  name: string;
  commanderEntityId: string;
  commander: Commander;
  doctrine: JointCommandDoctrine;
  status: JointForceStatus;
  contributions: JointForceContribution[];
  sharedBudget: number;
  readiness: number;
  commandCohesion: number;
  createdAtElapsedDay: number;
  deployedWarId?: string;
  deployedSide?: 'attackers' | 'defenders';
};

type JointForceState = { forces: JointOrganizationForce[] };
type JointForceGlobal = typeof globalThis & { __WORLD_STATE_JOINT_FORCES__?: JointForceState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): JointForceState {
  const root = globalThis as JointForceGlobal;
  if (!root.__WORLD_STATE_JOINT_FORCES__) root.__WORLD_STATE_JOINT_FORCES__ = { forces: [] };
  return root.__WORLD_STATE_JOINT_FORCES__;
}

function publish(state: JointForceState) {
  (globalThis as JointForceGlobal).__WORLD_STATE_JOINT_FORCES__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-joint-forces', { detail: state }));
}

export function jointForceState() {
  return { forces: rootState().forces.map((force) => ({ ...force, contributions: force.contributions.map((item) => ({ ...item, unitIds: [...item.unitIds] })) })) };
}

export function resetJointOrganizationForces() {
  publish({ forces: [] });
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function commandProfile(organizationId: string, commanderEntityId: string): Commander {
  const seed = hash(`${organizationId}:${commanderEntityId}:joint-command`);
  return {
    id: `${organizationId}-joint-commander`,
    name: 'Comandante do Comando Multinacional',
    skill: 54 + (seed % 25),
    logistics: 50 + ((seed >> 5) % 28),
    initiative: 48 + ((seed >> 10) % 30),
  };
}

function organizationById(id: string) {
  return diplomaticOrganizationState().organizations.find((item) => item.id === id && item.active);
}

function memberRelation(simulation: SimulationState, a: string, b: string) {
  const relation = simulation.diplomacy[pairKey(a, b)];
  if (!relation) return 45;
  return clamp(50 + relation.score * .28 + (relation.trust - 50) * .45 - relation.threat * .18);
}

function recompute(force: JointOrganizationForce, simulation: SimulationState, armyState: ArmyState): JointOrganizationForce {
  const units = armyState.units.filter((unit) => force.contributions.some((item) => item.unitIds.includes(unit.id)));
  const personnel = units.reduce((sum, unit) => sum + unit.personnel, 0);
  const material = units.length ? units.reduce((sum, unit) => sum + unit.strength + unit.morale + unit.organization + unit.supply + unit.equipment, 0) / (units.length * 5) : 0;
  const support = force.contributions.length ? force.contributions.reduce((sum, item) => sum + item.politicalSupport, 0) / force.contributions.length : 0;
  const budgetFactor = clamp(force.sharedBudget / Math.max(1, force.contributions.length * 8) * 100);
  const readiness = clamp(material * .58 + budgetFactor * .22 + support * .2 + Math.min(12, personnel / 2500));
  const relations: number[] = [];
  for (let i = 0; i < force.contributions.length; i += 1) {
    for (let j = i + 1; j < force.contributions.length; j += 1) relations.push(memberRelation(simulation, force.contributions[i].memberId, force.contributions[j].memberId));
  }
  const relationAverage = relations.length ? relations.reduce((sum, value) => sum + value, 0) / relations.length : 60;
  const doctrineBonus = force.doctrine === 'unified_command' ? 8 : force.doctrine === 'lead_nation' ? 4 : -2;
  const commandCohesion = clamp(relationAverage * .55 + support * .3 + force.commander.skill * .15 + doctrineBonus);
  return { ...force, readiness, commandCohesion, status: force.status === 'forming' && units.length >= 2 && readiness >= 42 ? 'ready' : force.status };
}

export function createJointOrganizationForce(organizationId: string, commanderEntityId: string, simulation: SimulationState, doctrine: JointCommandDoctrine = 'lead_nation') {
  const organization = organizationById(organizationId);
  if (!organization || !organization.memberIds.includes(commanderEntityId)) return undefined;
  if (!['security', 'stability', 'influence'].includes(organization.agenda) && organization.type === 'commercial_bloc') return undefined;
  if (rootState().forces.some((force) => force.organizationId === organizationId && force.status !== 'dissolved')) return undefined;
  const force: JointOrganizationForce = {
    id: `joint-force-${organizationId}-${simulation.elapsedDays}`,
    organizationId,
    name: simulation.date.year < 1800 ? `Força da ${organization.name}` : `Comando Multinacional — ${organization.name}`,
    commanderEntityId,
    commander: commandProfile(organizationId, commanderEntityId),
    doctrine,
    status: 'forming',
    contributions: [],
    sharedBudget: 0,
    readiness: 0,
    commandCohesion: organization.cohesion,
    createdAtElapsedDay: simulation.elapsedDays,
  };
  publish({ forces: [force, ...rootState().forces].slice(0, 30) });
  return force;
}

export function contributeFormation(forceId: string, memberId: string, simulation: SimulationState, armyState: ArmyState) {
  const state = rootState();
  const force = state.forces.find((item) => item.id === forceId && item.status !== 'dissolved');
  const organization = force ? organizationById(force.organizationId) : undefined;
  if (!force || !organization || !organization.memberIds.includes(memberId)) return { accepted: false, armyState, simulation, message: 'Contribuição indisponível.' };
  if (force.contributions.some((item) => item.memberId === memberId)) return { accepted: false, armyState, simulation, message: 'Este membro já contribui para a força conjunta.' };
  const donor = armyState.units.filter((unit) => unit.entityId === memberId && unit.personnel >= 3500 && !force.contributions.some((entry) => entry.unitIds.includes(unit.id))).sort((a, b) => b.personnel - a.personnel)[0];
  if (!donor) return { accepted: false, armyState, simulation, message: 'Não há formação nacional com efetivo suficiente para destacar.' };
  const runtime = simulation.entities[memberId];
  if (!runtime) return { accepted: false, armyState, simulation, message: 'Perfil militar do membro indisponível.' };
  const personnel = Math.max(1200, Math.min(5200, Math.round(donor.personnel * .28)));
  const unitId = `${force.id}-${memberId}-expeditionary`;
  const expeditionary: ArmyUnit = {
    ...donor,
    id: unitId,
    name: simulation.date.year < 1800 ? `Contingente de ${memberId}` : `Força Expedicionária de ${memberId}`,
    commander: force.commander,
    personnel,
    strength: clamp(donor.strength - 2 + force.commander.skill * .04),
    organization: clamp(donor.organization * .9 + force.commandCohesion * .1),
    supply: clamp(donor.supply + 4),
    movementProgress: 0,
    destinationId: undefined,
    order: 'prepare',
  };
  const units = armyState.units.map((unit) => unit.id === donor.id ? { ...unit, personnel: Math.max(500, unit.personnel - personnel), organization: clamp(unit.organization - 3) } : unit);
  units.push(expeditionary);
  const budgetShare = clamp(4 + runtime.treasuryIndex * .08, 3, 12);
  const politicalSupport = clamp(45 + organization.cohesion * .35 + memberRelation(simulation, memberId, force.commanderEntityId) * .2);
  const contribution: JointForceContribution = { memberId, personnel, unitIds: [unitId], budgetShare, politicalSupport };
  let updated = { ...force, contributions: [...force.contributions, contribution], sharedBudget: force.sharedBudget + budgetShare };
  const nextArmyState = { ...armyState, units };
  updated = recompute(updated, simulation, nextArmyState);
  publish({ forces: state.forces.map((item) => item.id === force.id ? updated : item) });
  const member = simulation.entities[memberId];
  const contributionEvent: WorldEvent = {
    id: `joint-contribution-${force.id}-${memberId}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId: memberId,
    category: 'military',
    title: 'Contingente destacado para comando multinacional',
    text: `${memberId} destacou ${personnel.toLocaleString('pt-BR')} militares e recursos para ${force.name}.`,
  };
  const nextSimulation: SimulationState = {
    ...simulation,
    entities: { ...simulation.entities, [memberId]: { ...member, treasuryIndex: clamp(member.treasuryIndex - budgetShare * .12), militaryReadiness: clamp(member.militaryReadiness - 1.2) } },
    events: [contributionEvent, ...simulation.events].slice(0, 50),
  };
  return { accepted: true, armyState: nextArmyState, simulation: nextSimulation, force: updated, message: 'Contingente transferido para o comando multinacional.' };
}

export function deployJointForce(forceId: string, warId: string, side: 'attackers' | 'defenders', simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  const force = state.forces.find((item) => item.id === forceId && (item.status === 'ready' || item.status === 'deployed'));
  const war = warState.wars.find((item) => item.id === warId && item.status === 'active');
  if (!force || !war) return { accepted: false, armyState, warState, simulation, message: 'Força ou guerra indisponível.' };
  const members = force.contributions.map((item) => item.memberId);
  const opponent = side === 'attackers' ? war.defenders : war.attackers;
  if (members.some((memberId) => opponent.includes(memberId))) return { accepted: false, armyState, warState, simulation, message: 'Um contribuinte já combate no lado adversário.' };
  const nextWars = warState.wars.map((item) => item.id !== war.id ? item : side === 'attackers'
    ? { ...item, attackers: [...new Set([...item.attackers, ...members])] }
    : { ...item, defenders: [...new Set([...item.defenders, ...members])] });
  let nextWarState: WarState = { ...warState, wars: nextWars };
  for (const memberId of members) nextWarState = setMobilization(nextWarState, memberId, 'partial');
  const updated = { ...force, status: 'deployed' as const, deployedWarId: war.id, deployedSide: side };
  publish({ forces: state.forces.map((item) => item.id === force.id ? updated : item) });
  const event: WorldEvent = { id: `joint-deploy-${force.id}-${simulation.elapsedDays}`, date: simulation.date, category: 'military', title: 'Comando multinacional destacado', text: `${force.name} foi destacado para o lado ${side === 'attackers' ? 'atacante' : 'defensor'} de ${war.name}, reunindo contingentes de ${members.length} membros.` };
  return { accepted: true, armyState, warState: nextWarState, simulation: { ...simulation, events: [event, ...simulation.events].slice(0, 50) }, force: updated, message: 'Força conjunta destacada para a guerra.' };
}

export function changeJointCommand(forceId: string, requesterId: string, commanderEntityId: string, doctrine: JointCommandDoctrine, simulation: SimulationState, armyState: ArmyState) {
  const state = rootState();
  const force = state.forces.find((item) => item.id === forceId && item.status !== 'dissolved');
  const organization = force ? organizationById(force.organizationId) : undefined;
  if (!force || !organization || requesterId !== organization.leaderId || !organization.memberIds.includes(commanderEntityId)) return undefined;
  const priorCommander = force.commanderEntityId;
  let commandCohesion = force.commandCohesion;
  for (const contribution of force.contributions) {
    if (contribution.memberId === commanderEntityId) commandCohesion += 4;
    else if (contribution.memberId === priorCommander && priorCommander !== commanderEntityId) commandCohesion -= 5;
    else commandCohesion += (memberRelation(simulation, contribution.memberId, commanderEntityId) - 50) * .035;
  }
  let updated: JointOrganizationForce = { ...force, commanderEntityId, commander: commandProfile(force.organizationId, commanderEntityId), doctrine, commandCohesion: clamp(commandCohesion) };
  updated = recompute(updated, simulation, armyState);
  publish({ forces: state.forces.map((item) => item.id === force.id ? updated : item) });
  return updated;
}

export function dissolveJointForce(forceId: string, simulation: SimulationState, armyState: ArmyState) {
  const state = rootState();
  const force = state.forces.find((item) => item.id === forceId && item.status !== 'dissolved');
  if (!force) return { accepted: false, simulation, armyState, message: 'Força conjunta indisponível.' };
  const jointIds = new Set(force.contributions.flatMap((item) => item.unitIds));
  const survivingJoint = armyState.units.filter((unit) => jointIds.has(unit.id));
  let units = armyState.units.filter((unit) => !jointIds.has(unit.id));
  for (const contribution of force.contributions) {
    const personnel = survivingJoint.filter((unit) => contribution.unitIds.includes(unit.id)).reduce((sum, unit) => sum + unit.personnel, 0);
    const national = units.filter((unit) => unit.entityId === contribution.memberId).sort((a, b) => b.personnel - a.personnel)[0];
    if (national && personnel > 0) units = units.map((unit) => unit.id === national.id ? { ...unit, personnel: unit.personnel + personnel, morale: clamp(unit.morale + 2) } : unit);
  }
  publish({ forces: state.forces.map((item) => item.id === force.id ? { ...item, status: 'dissolved' } : item) });
  const dissolveEvent: WorldEvent = {
    id: `joint-dissolve-${force.id}-${simulation.elapsedDays}`,
    date: simulation.date,
    category: 'military',
    title: 'Comando multinacional dissolvido',
    text: `${force.name} foi dissolvido e seus contingentes sobreviventes retornaram às estruturas nacionais.`,
  };
  return { accepted: true, simulation: { ...simulation, events: [dissolveEvent, ...simulation.events].slice(0, 50) }, armyState: { ...armyState, units }, message: 'Força conjunta dissolvida.' };
}

export function forcesForOrganization(organizationId: string) {
  return rootState().forces.filter((force) => force.organizationId === organizationId && force.status !== 'dissolved');
}
