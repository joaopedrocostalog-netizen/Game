import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import type { GameDate, SimulationState } from './simulation';
import {
  createInitialTerritorialControlState,
  simulateTerritorialControl,
  type TerritorialControlState,
} from './territorialControl';

export type MobilizationLevel = 'none' | 'partial' | 'general';
export type WarGoal = 'territory' | 'reparations' | 'regime' | 'independence' | 'defense';
export type WarStatus = 'active' | 'ended';
export type FrontPriority = 'low' | 'normal' | 'high' | 'main';
export type FrontSide = 'attacker' | 'defender';

export type FrontState = {
  id: string;
  name: string;
  locationId?: string;
  terrain?: ResolvedLocation['terrain'];
  progress: number;
  intensity: number;
  attackerPower: number;
  defenderPower: number;
  attackerFormations: number;
  defenderFormations: number;
  attackerLogistics: number;
  defenderLogistics: number;
  operationalData: boolean;
  attackerPriority: FrontPriority;
  defenderPriority: FrontPriority;
  attackerPriorityManual?: boolean;
  defenderPriorityManual?: boolean;
  attackerAssignments: string[];
  defenderAssignments: string[];
};

export type War = {
  id: string;
  name: string;
  attackerId: string;
  defenderId: string;
  attackers: string[];
  defenders: string[];
  goal: WarGoal;
  startedAt: GameDate;
  status: WarStatus;
  score: number;
  attackerSupport: number;
  defenderSupport: number;
  attackerLosses: number;
  defenderLosses: number;
  elapsedDays: number;
  fronts: FrontState[];
  victor?: 'attackers' | 'defenders' | 'stalemate';
};

export type WarState = {
  wars: War[];
  mobilization: Record<string, MobilizationLevel>;
};

export type WarActionResult = {
  state: WarState;
  error?: string;
  message: string;
};

type ArmyGlobal = typeof globalThis & {
  __WORLD_STATE_ARMY_STATE__?: ArmyState;
  __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState;
};

type CoalitionPower = {
  power: number;
  formations: number;
  logistics: number;
  operationalData: boolean;
};

type FrontResolution = {
  front: FrontState;
  scoreDelta: number;
  attackerLossDelta: number;
  defenderLossDelta: number;
};

export function createInitialWarState(): WarState {
  return { wars: [], mobilization: {} };
}

export function mobilizationMultiplier(level: MobilizationLevel | undefined) {
  if (level === 'general') return 1.2;
  if (level === 'partial') return 1.08;
  return 0.92;
}

export function setMobilization(state: WarState, entityId: string, level: MobilizationLevel): WarState {
  return { ...state, mobilization: { ...state.mobilization, [entityId]: level } };
}

export function setFrontPriority(state: WarState, warId: string, frontId: string, side: FrontSide, priority: FrontPriority): WarState {
  return {
    ...state,
    wars: state.wars.map((war) => war.id !== warId ? war : {
      ...war,
      fronts: war.fronts.map((front) => front.id !== frontId ? front : side === 'attacker'
        ? { ...front, attackerPriority: priority, attackerPriorityManual: true }
        : { ...front, defenderPriority: priority, defenderPriorityManual: true }),
    }),
  };
}

export function assignUnitToFront(state: WarState, warId: string, frontId: string, side: FrontSide, unitId: string): WarState {
  return {
    ...state,
    wars: state.wars.map((war) => {
      if (war.id !== warId) return war;
      return {
        ...war,
        fronts: war.fronts.map((front) => {
          const attackerAssignments = front.attackerAssignments.filter((id) => id !== unitId);
          const defenderAssignments = front.defenderAssignments.filter((id) => id !== unitId);
          if (front.id !== frontId) return { ...front, attackerAssignments, defenderAssignments };
          return side === 'attacker'
            ? { ...front, attackerAssignments: [...attackerAssignments, unitId], defenderAssignments }
            : { ...front, attackerAssignments, defenderAssignments: [...defenderAssignments, unitId] };
        }),
      };
    }),
  };
}

export function clearUnitFrontAssignment(state: WarState, warId: string, unitId: string): WarState {
  return {
    ...state,
    wars: state.wars.map((war) => war.id !== warId ? war : {
      ...war,
      fronts: war.fronts.map((front) => ({
        ...front,
        attackerAssignments: front.attackerAssignments.filter((id) => id !== unitId),
        defenderAssignments: front.defenderAssignments.filter((id) => id !== unitId),
      })),
    }),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function operationalArmyState() {
  return (globalThis as ArmyGlobal).__WORLD_STATE_ARMY_STATE__;
}

function territorialControlState() {
  return (globalThis as ArmyGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ ?? createInitialTerritorialControlState();
}

function pairActive(state: WarState, a: string, b: string) {
  return state.wars.some((war) => war.status === 'active' && ((war.attackers.includes(a) && war.defenders.includes(b)) || (war.attackers.includes(b) && war.defenders.includes(a))));
}

function alliancePartners(simulation: SimulationState, entityId: string, enemyId: string) {
  const partners = new Set<string>();
  for (const treaty of simulation.treaties) {
    if (!treaty.active || treaty.type !== 'alliance' || !treaty.parties.includes(entityId)) continue;
    const other = treaty.parties[0] === entityId ? treaty.parties[1] : treaty.parties[0];
    if (other !== enemyId) partners.add(other);
  }
  return [...partners];
}

function locationMap(year: number) {
  return new Map(locationsForYear(year).map((location) => [location.id, location]));
}

function distanceKm(a?: ResolvedLocation, b?: ResolvedLocation) {
  if (!a || !b) return 4000;
  const radius = 6371;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function distanceMultiplier(distance: number) {
  if (distance <= 250) return 1;
  if (distance <= 800) return 0.9;
  if (distance <= 1600) return 0.76;
  if (distance <= 3000) return 0.58;
  return 0.4;
}

function terrainMultiplier(terrain: FrontState['terrain'], side: FrontSide) {
  if (!terrain) return 1;
  const attacker: Record<NonNullable<FrontState['terrain']>, number> = { plains: 1.04, hills: 0.91, mountains: 0.78, coastal: 0.95, forest: 0.88, desert: 0.92, mixed: 0.97 };
  const defender: Record<NonNullable<FrontState['terrain']>, number> = { plains: 1, hills: 1.08, mountains: 1.18, coastal: 1.04, forest: 1.1, desert: 0.98, mixed: 1.05 };
  return side === 'attacker' ? attacker[terrain] : defender[terrain];
}

function priorityMultiplier(priority: FrontPriority) {
  if (priority === 'main') return 1.18;
  if (priority === 'high') return 1.08;
  if (priority === 'low') return 0.84;
  return 1;
}

function priorityDistanceBias(priority: FrontPriority) {
  if (priority === 'main') return 900;
  if (priority === 'high') return 420;
  if (priority === 'low') return -260;
  return 0;
}

function frontPriority(front: FrontState, side: FrontSide) {
  return side === 'attacker' ? front.attackerPriority : front.defenderPriority;
}

function unitCombatPower(unit: ArmyUnit, frontLocation: ResolvedLocation | undefined, locations: Map<string, ResolvedLocation>, side: FrontSide, priority: FrontPriority) {
  const currentLocation = locations.get(unit.locationId);
  const distanceFactor = distanceMultiplier(distanceKm(currentLocation, frontLocation));
  const readiness = (unit.strength * 0.22 + unit.morale * 0.17 + unit.organization * 0.2 + unit.supply * 0.18 + unit.equipment * 0.23) / 100;
  const personnelFactor = clamp(unit.personnel / 12000, 0.35, 2.4);
  const commanderSkill = clamp(unit.commander.skill / 100, 0, 1);
  const commanderLogistics = clamp(unit.commander.logistics / 100, 0, 1);
  const commanderInitiative = clamp(unit.commander.initiative / 100, 0, 1);
  const commanderFactor = 0.88 + commanderSkill * 0.25 + commanderLogistics * 0.12 + commanderInitiative * 0.1;
  const orderFactor = unit.order === 'prepare' ? 1.08 : unit.order === 'move' ? 0.76 : unit.order === 'retreat' ? 0.52 : 1;
  const terrain = terrainMultiplier(frontLocation?.terrain, side);
  const power = 20 * personnelFactor * readiness * commanderFactor * orderFactor * distanceFactor * terrain * priorityMultiplier(priority);
  const logistics = clamp((unit.supply * 0.48 + unit.organization * 0.22 + unit.equipment * 0.2 + unit.commander.logistics * 0.1) * distanceFactor, 0, 100);
  return { power, logistics };
}

function aggregateNationalPower(simulation: SimulationState, warState: WarState, entityId: string, side: FrontSide, terrain?: FrontState['terrain']) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return { power: 0, logistics: 0 };
  const mobilization = mobilizationMultiplier(warState.mobilization[entityId]);
  const base = runtime.militaryReadiness * 0.46 + runtime.technology * 0.22 + runtime.treasuryIndex * 0.18 + runtime.stability * 0.14;
  return { power: base * mobilization * terrainMultiplier(terrain, side), logistics: clamp(runtime.treasuryIndex * 0.45 + runtime.militaryReadiness * 0.35 + runtime.technology * 0.2, 0, 100) };
}

function frontLocation(front: FrontState, locations: Map<string, ResolvedLocation>) {
  return front.locationId ? locations.get(front.locationId) : undefined;
}

function explicitAssignment(unit: ArmyUnit, fronts: FrontState[], side: FrontSide) {
  return fronts.find((front) => (side === 'attacker' ? front.attackerAssignments : front.defenderAssignments).includes(unit.id));
}

function unitAssignedToFront(unit: ArmyUnit, targetFront: FrontState, allFronts: FrontState[], locations: Map<string, ResolvedLocation>, side: FrontSide) {
  if (allFronts.length <= 1) return true;
  const manual = explicitAssignment(unit, allFronts, side);
  if (manual) return manual.id === targetFront.id;
  const unitLocation = locations.get(unit.locationId);
  const ranked = allFronts
    .map((front) => ({ front, score: distanceKm(unitLocation, frontLocation(front, locations)) - priorityDistanceBias(frontPriority(front, side)) }))
    .sort((a, b) => a.score - b.score || a.front.id.localeCompare(b.front.id));
  return ranked[0]?.front.id === targetFront.id;
}

function coalitionPower(simulation: SimulationState, warState: WarState, members: string[], front: FrontState, side: FrontSide, allFronts: FrontState[]): CoalitionPower {
  if (!members.length) return { power: 0, formations: 0, logistics: 0, operationalData: false };
  const armyState = operationalArmyState();
  const locations = locationMap(simulation.date.year);
  const target = frontLocation(front, locations);
  let power = 0, formations = 0, logisticsTotal = 0, logisticsSources = 0;
  let operationalData = false;
  const priority = frontPriority(front, side);

  for (const id of members) {
    const units = armyState?.units.filter((unit) => unit.entityId === id) ?? [];
    if (units.length) {
      operationalData = true;
      const mobilization = mobilizationMultiplier(warState.mobilization[id]);
      const assigned = units.filter((unit) => unitAssignedToFront(unit, front, allFronts, locations, side));
      for (const unit of assigned) {
        const contribution = unitCombatPower(unit, target, locations, side, priority);
        power += contribution.power * mobilization;
        logisticsTotal += contribution.logistics;
        logisticsSources += 1;
        formations += 1;
      }
    } else {
      const fallback = aggregateNationalPower(simulation, warState, id, side, front.terrain);
      const weights = allFronts.reduce((sum, item) => sum + priorityMultiplier(frontPriority(item, side)), 0);
      power += fallback.power * priorityMultiplier(priority) / Math.max(1, weights);
      logisticsTotal += fallback.logistics;
      logisticsSources += 1;
    }
  }
  return { power, formations, logistics: logisticsSources ? logisticsTotal / logisticsSources : 0, operationalData };
}

function makeFront(warId: string, index: number, location?: ResolvedLocation): FrontState {
  return {
    id: `${warId}-front-${index + 1}`,
    name: location ? `Frente de ${location.name}` : `Frente ${index + 1}`,
    locationId: location?.id,
    terrain: location?.terrain,
    progress: 50,
    intensity: 34,
    attackerPower: 0,
    defenderPower: 0,
    attackerFormations: 0,
    defenderFormations: 0,
    attackerLogistics: 0,
    defenderLogistics: 0,
    operationalData: false,
    attackerPriority: index === 0 ? 'main' : 'normal',
    defenderPriority: index === 0 ? 'main' : 'normal',
    attackerAssignments: [],
    defenderAssignments: [],
  };
}

function effectiveController(location: ResolvedLocation, control: TerritorialControlState) {
  return control.occupations[location.id]?.controllerId ?? location.controllerId ?? location.ownerId;
}

function nextTarget(war: War, from: ResolvedLocation | undefined, simulation: SimulationState, control: TerritorialControlState, blockedIds: Set<string>) {
  const candidates = locationsForEntity(war.defenderId, simulation.date.year)
    .filter((location) => !blockedIds.has(location.id) && effectiveController(location, control) !== war.attackerId)
    .map((location) => ({ location, distance: distanceKm(from, location) }))
    .sort((a, b) => a.distance - b.distance || a.location.name.localeCompare(b.location.name));
  return candidates[0]?.location;
}

function operationalFormationCount(ids: string[]) {
  const armyState = operationalArmyState();
  if (!armyState) return 0;
  const members = new Set(ids);
  return armyState.units.filter((unit) => members.has(unit.entityId) && unit.personnel > 500 && unit.strength > 8).length;
}

function autoPriority(front: FrontState, side: FrontSide, control: TerritorialControlState): FrontPriority {
  const occupation = front.locationId ? control.occupations[front.locationId] : undefined;
  if (side === 'defender') {
    if ((occupation?.progress ?? 0) >= 65) return 'main';
    if (front.attackerPower > front.defenderPower * 1.25) return 'high';
    if (front.defenderLogistics < 35) return 'low';
    return 'normal';
  }
  if ((occupation?.progress ?? 0) >= 55 || front.progress >= 68) return 'main';
  if (front.defenderPower > 0 && front.attackerPower > front.defenderPower * 1.2) return 'high';
  if (front.attackerLogistics < 30) return 'low';
  return 'normal';
}

function evolveFrontNetwork(war: War, simulation: SimulationState, control: TerritorialControlState): FrontState[] {
  const locations = locationMap(simulation.date.year);
  const blocked = new Set(war.fronts.map((front) => front.locationId).filter(Boolean) as string[]);
  const evolved = war.fronts.map((front, index) => {
    let nextFront = front;
    if (front.locationId) {
      const occupation = control.occupations[front.locationId];
      if (occupation && occupation.controllerId === war.attackerId && occupation.progress >= 100) {
        const previous = locations.get(front.locationId);
        const target = nextTarget(war, previous, simulation, control, blocked);
        if (target) {
          blocked.delete(front.locationId);
          blocked.add(target.id);
          nextFront = { ...makeFront(war.id, index, target), id: front.id, intensity: 28, attackerAssignments: front.attackerAssignments, defenderAssignments: front.defenderAssignments, attackerPriorityManual: front.attackerPriorityManual, defenderPriorityManual: front.defenderPriorityManual, attackerPriority: front.attackerPriority, defenderPriority: front.defenderPriority };
        }
      }
    }
    return {
      ...nextFront,
      attackerPriority: nextFront.attackerPriorityManual ? nextFront.attackerPriority : autoPriority(nextFront, 'attacker', control),
      defenderPriority: nextFront.defenderPriorityManual ? nextFront.defenderPriority : autoPriority(nextFront, 'defender', control),
    };
  });

  const attackerFormations = operationalFormationCount(war.attackers);
  const runtimeStrength = war.attackers.reduce((sum, id) => sum + (simulation.entities[id]?.militaryReadiness ?? 0), 0);
  const desiredFronts = war.elapsedDays >= 180 && (attackerFormations >= 4 || runtimeStrength >= 135) ? 3 : war.elapsedDays >= 60 && (attackerFormations >= 2 || runtimeStrength >= 75) ? 2 : 1;
  while (evolved.length < desiredFronts) {
    const anchor = evolved[evolved.length - 1]?.locationId ? locations.get(evolved[evolved.length - 1].locationId!) : undefined;
    const target = nextTarget(war, anchor, simulation, control, blocked);
    if (!target) break;
    blocked.add(target.id);
    evolved.push(makeFront(war.id, evolved.length, target));
  }
  return evolved.slice(0, 3);
}

export function declareWar(state: WarState, simulation: SimulationState, attackerId: string, defenderId: string, goal: WarGoal): WarActionResult {
  if (!attackerId || !defenderId || attackerId === defenderId) return { state, error: 'invalid-target', message: 'Selecione uma entidade estrangeira válida.' };
  if (!simulation.entities[attackerId] || !simulation.entities[defenderId]) return { state, error: 'missing-runtime', message: 'Uma das entidades ainda não possui perfil de simulação ativo.' };
  if (pairActive(state, attackerId, defenderId)) return { state, error: 'already-at-war', message: 'Essas entidades já estão em guerra.' };
  if (simulation.entities[attackerId].militaryReadiness < 28) return { state, error: 'low-readiness', message: 'A prontidão militar é baixa demais para iniciar uma guerra organizada.' };
  const attackers = [attackerId, ...alliancePartners(simulation, attackerId, defenderId)];
  const defenders = [defenderId, ...alliancePartners(simulation, defenderId, attackerId)].filter((id) => !attackers.includes(id));
  const id = `war-${attackerId}-${defenderId}-${simulation.date.year}-${simulation.date.month}-${simulation.elapsedDays}`;
  const targetLocation = locationsForEntity(defenderId, simulation.date.year)[0] ?? locationsForEntity(attackerId, simulation.date.year)[0];
  const war: War = { id, name: `${attackerId} × ${defenderId}`, attackerId, defenderId, attackers, defenders, goal, startedAt: simulation.date, status: 'active', score: 0, attackerSupport: 100, defenderSupport: 100, attackerLosses: 0, defenderLosses: 0, elapsedDays: 0, fronts: [makeFront(id, 0, targetLocation)] };
  const mobilization = { ...state.mobilization };
  mobilization[attackerId] = mobilization[attackerId] === 'general' ? 'general' : 'partial';
  mobilization[defenderId] = 'general';
  return { state: { ...state, wars: [war, ...state.wars], mobilization }, message: `Guerra declarada. ${attackers.length - 1} aliado(s) apoiam o atacante e ${defenders.length - 1} aliado(s) apoiam o defensor. A campanha começa com uma frente e pode se dividir conforme forças, tempo e território permitirem.` };
}

function dailyNoise(war: War, simulation: SimulationState, frontId: string) {
  const seed = `${war.id}:${frontId}:${simulation.date.year}:${simulation.date.month}:${simulation.date.day}:${war.elapsedDays}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

function publishTerritorialControl(state: WarState, simulation: SimulationState, days: number) {
  const root = globalThis as ArmyGlobal;
  const current = root.__WORLD_STATE_TERRITORIAL_CONTROL__ ?? createInitialTerritorialControlState();
  const next = simulateTerritorialControl(current, state, simulation.date.year, simulation.date, days);
  root.__WORLD_STATE_TERRITORIAL_CONTROL__ = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-territorial-control', { detail: next }));
}

function resolveFront(war: War, front: FrontState, allFronts: FrontState[], state: WarState, simulation: SimulationState, days: number): FrontResolution {
  const attackers = coalitionPower(simulation, state, war.attackers, front, 'attacker', allFronts);
  const defenders = coalitionPower(simulation, state, war.defenders, front, 'defender', allFronts);
  const attackerPower = Math.max(0.1, attackers.power), defenderPower = Math.max(0.1, defenders.power);
  const total = Math.max(1, attackerPower + defenderPower);
  const edge = (attackerPower - defenderPower) / total;
  const logisticsEdge = (attackers.logistics - defenders.logistics) / 100;
  const random = dailyNoise(war, simulation, front.id);
  const scale = Math.max(0.25, days / 7);
  const scoreDelta = (edge * 1.7 + logisticsEdge * 0.32 + random * 0.2) * scale;
  const intensity = clamp(36 + Math.abs(edge) * 38 + Math.min(14, (attackers.formations + defenders.formations) * 2) + random * 9, 14, 96);
  const attackerLossDelta = Math.max(0, (defenderPower / attackerPower) * intensity * days * 0.009 * (1.08 - attackers.logistics / 220));
  const defenderLossDelta = Math.max(0, (attackerPower / defenderPower) * intensity * days * 0.009 * (1.08 - defenders.logistics / 220));
  const progressDelta = (edge * 7 + logisticsEdge * 2.3 + random * 0.7) * scale;
  return { front: { ...front, progress: clamp(front.progress + progressDelta, 2, 98), intensity, attackerPower, defenderPower, attackerFormations: attackers.formations, defenderFormations: defenders.formations, attackerLogistics: attackers.logistics, defenderLogistics: defenders.logistics, operationalData: attackers.operationalData || defenders.operationalData }, scoreDelta, attackerLossDelta, defenderLossDelta };
}

export function simulateWarDays(state: WarState, simulation: SimulationState, days: number): WarState {
  if (days <= 0 || !state.wars.some((war) => war.status === 'active')) return state;
  const control = territorialControlState();
  const wars = state.wars.map((war) => {
    if (war.status !== 'active') return war;
    const evolvedFronts = evolveFrontNetwork(war, simulation, control);
    const resolutions = evolvedFronts.map((front) => resolveFront(war, front, evolvedFronts, state, simulation, days));
    const frontCount = Math.max(1, resolutions.length);
    const averageScoreDelta = resolutions.reduce((sum, result) => sum + result.scoreDelta, 0) / frontCount;
    const attackerLossDelta = resolutions.reduce((sum, result) => sum + result.attackerLossDelta, 0);
    const defenderLossDelta = resolutions.reduce((sum, result) => sum + result.defenderLossDelta, 0);
    const score = clamp(war.score + averageScoreDelta, -100, 100);
    const attackerSupport = clamp(war.attackerSupport - days * 0.014 - attackerLossDelta * 0.0009, 0, 100);
    const defenderSupport = clamp(war.defenderSupport - days * 0.014 - defenderLossDelta * 0.0009, 0, 100);
    let status: WarStatus = 'active';
    let victor: War['victor'];
    if (score >= 92 || defenderSupport <= 5) { status = 'ended'; victor = 'attackers'; }
    else if (score <= -92 || attackerSupport <= 5) { status = 'ended'; victor = 'defenders'; }
    else if (war.elapsedDays + days >= 3650 && Math.abs(score) < 25) { status = 'ended'; victor = 'stalemate'; }
    return { ...war, score, attackerSupport, defenderSupport, attackerLosses: war.attackerLosses + attackerLossDelta, defenderLosses: war.defenderLosses + defenderLossDelta, elapsedDays: war.elapsedDays + days, status, victor, fronts: resolutions.map((result) => result.front) };
  });
  const next = { ...state, wars };
  publishTerritorialControl(next, simulation, days);
  return next;
}

export function warsForEntity(state: WarState, entityId: string) {
  return state.wars.filter((war) => war.attackers.includes(entityId) || war.defenders.includes(entityId));
}
