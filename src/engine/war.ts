import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import type { GameDate, SimulationState } from './simulation';

export type MobilizationLevel = 'none' | 'partial' | 'general';
export type WarGoal = 'territory' | 'reparations' | 'regime' | 'independence' | 'defense';
export type WarStatus = 'active' | 'ended';

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

type ArmyGlobal = typeof globalThis & { __WORLD_STATE_ARMY_STATE__?: ArmyState };

type CoalitionPower = {
  power: number;
  formations: number;
  logistics: number;
  operationalData: boolean;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function operationalArmyState() {
  return (globalThis as ArmyGlobal).__WORLD_STATE_ARMY_STATE__;
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

function terrainMultiplier(terrain: FrontState['terrain'], side: 'attacker' | 'defender') {
  if (!terrain) return 1;
  const attacker: Record<NonNullable<FrontState['terrain']>, number> = {
    plains: 1.04,
    hills: 0.91,
    mountains: 0.78,
    coastal: 0.95,
    forest: 0.88,
    desert: 0.92,
    mixed: 0.97,
  };
  const defender: Record<NonNullable<FrontState['terrain']>, number> = {
    plains: 1,
    hills: 1.08,
    mountains: 1.18,
    coastal: 1.04,
    forest: 1.1,
    desert: 0.98,
    mixed: 1.05,
  };
  return side === 'attacker' ? attacker[terrain] : defender[terrain];
}

function unitCombatPower(unit: ArmyUnit, frontLocation: ResolvedLocation | undefined, locations: Map<string, ResolvedLocation>, side: 'attacker' | 'defender') {
  const currentLocation = locations.get(unit.locationId);
  const distance = distanceKm(currentLocation, frontLocation);
  const distanceFactor = distanceMultiplier(distance);
  const readiness = (
    unit.strength * 0.22 +
    unit.morale * 0.17 +
    unit.organization * 0.2 +
    unit.supply * 0.18 +
    unit.equipment * 0.23
  ) / 100;
  const personnelFactor = clamp(unit.personnel / 12000, 0.35, 2.4);
  const commanderSkill = clamp(unit.commander.skill, 0, 10);
  const commanderLogistics = clamp(unit.commander.logistics, 0, 10);
  const commanderInitiative = clamp(unit.commander.initiative, 0, 10);
  const commanderFactor = 0.88 + commanderSkill * 0.025 + commanderLogistics * 0.012 + commanderInitiative * 0.01;
  const orderFactor = unit.order === 'prepare' ? 1.08 : unit.order === 'move' ? 0.76 : 1;
  const terrain = terrainMultiplier(frontLocation?.terrain, side);
  const power = 20 * personnelFactor * readiness * commanderFactor * orderFactor * distanceFactor * terrain;
  const logistics = clamp((unit.supply * 0.48 + unit.organization * 0.22 + unit.equipment * 0.2 + commanderLogistics * 10 * 0.1) * distanceFactor, 0, 100);
  return { power, logistics };
}

function aggregateNationalPower(simulation: SimulationState, warState: WarState, entityId: string, side: 'attacker' | 'defender', terrain?: FrontState['terrain']) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return { power: 0, logistics: 0 };
  const mobilization = mobilizationMultiplier(warState.mobilization[entityId]);
  const base = runtime.militaryReadiness * 0.46 + runtime.technology * 0.22 + runtime.treasuryIndex * 0.18 + runtime.stability * 0.14;
  return {
    power: base * mobilization * terrainMultiplier(terrain, side),
    logistics: clamp(runtime.treasuryIndex * 0.45 + runtime.militaryReadiness * 0.35 + runtime.technology * 0.2, 0, 100),
  };
}

function coalitionPower(
  simulation: SimulationState,
  warState: WarState,
  members: string[],
  front: FrontState,
  side: 'attacker' | 'defender',
): CoalitionPower {
  if (!members.length) return { power: 0, formations: 0, logistics: 0, operationalData: false };
  const armyState = operationalArmyState();
  const locations = locationMap(simulation.date.year);
  const frontLocation = front.locationId ? locations.get(front.locationId) : undefined;
  let power = 0;
  let formations = 0;
  let logisticsTotal = 0;
  let logisticsSources = 0;
  let operationalData = false;

  for (const id of members) {
    const units = armyState?.units.filter((unit) => unit.entityId === id) ?? [];
    if (units.length) {
      operationalData = true;
      const mobilization = mobilizationMultiplier(warState.mobilization[id]);
      for (const unit of units) {
        const contribution = unitCombatPower(unit, frontLocation, locations, side);
        power += contribution.power * mobilization;
        logisticsTotal += contribution.logistics;
        logisticsSources += 1;
        formations += 1;
      }
    } else {
      const fallback = aggregateNationalPower(simulation, warState, id, side, front.terrain);
      power += fallback.power;
      logisticsTotal += fallback.logistics;
      logisticsSources += 1;
    }
  }

  return {
    power,
    formations,
    logistics: logisticsSources ? logisticsTotal / logisticsSources : 0,
    operationalData,
  };
}

export function declareWar(
  state: WarState,
  simulation: SimulationState,
  attackerId: string,
  defenderId: string,
  goal: WarGoal,
): WarActionResult {
  if (!attackerId || !defenderId || attackerId === defenderId) return { state, error: 'invalid-target', message: 'Selecione uma entidade estrangeira válida.' };
  if (!simulation.entities[attackerId] || !simulation.entities[defenderId]) return { state, error: 'missing-runtime', message: 'Uma das entidades ainda não possui perfil de simulação ativo.' };
  if (pairActive(state, attackerId, defenderId)) return { state, error: 'already-at-war', message: 'Essas entidades já estão em guerra.' };
  if (simulation.entities[attackerId].militaryReadiness < 28) return { state, error: 'low-readiness', message: 'A prontidão militar é baixa demais para iniciar uma guerra organizada.' };

  const attackers = [attackerId, ...alliancePartners(simulation, attackerId, defenderId)];
  const defenders = [defenderId, ...alliancePartners(simulation, defenderId, attackerId)].filter((id) => !attackers.includes(id));
  const id = `war-${attackerId}-${defenderId}-${simulation.date.year}-${simulation.date.month}-${simulation.elapsedDays}`;
  const targetLocation = locationsForEntity(defenderId, simulation.date.year)[0] ?? locationsForEntity(attackerId, simulation.date.year)[0];
  const front: FrontState = {
    id: `${id}-front-1`,
    name: targetLocation ? `Frente de ${targetLocation.name}` : 'Frente principal',
    locationId: targetLocation?.id,
    terrain: targetLocation?.terrain,
    progress: 50,
    intensity: 42,
    attackerPower: 0,
    defenderPower: 0,
    attackerFormations: 0,
    defenderFormations: 0,
    attackerLogistics: 0,
    defenderLogistics: 0,
    operationalData: false,
  };
  const war: War = {
    id,
    name: `${attackerId} × ${defenderId}`,
    attackerId,
    defenderId,
    attackers,
    defenders,
    goal,
    startedAt: simulation.date,
    status: 'active',
    score: 0,
    attackerSupport: 100,
    defenderSupport: 100,
    attackerLosses: 0,
    defenderLosses: 0,
    elapsedDays: 0,
    fronts: [front],
  };

  const mobilization = { ...state.mobilization };
  mobilization[attackerId] = mobilization[attackerId] === 'general' ? 'general' : 'partial';
  mobilization[defenderId] = 'general';
  return {
    state: { ...state, wars: [war, ...state.wars], mobilization },
    message: `Guerra declarada. ${attackers.length - 1} aliado(s) apoiam o atacante e ${defenders.length - 1} aliado(s) apoiam o defensor. A frente principal foi vinculada ao terreno disponível no mapa temporal.`,
  };
}

function dailyNoise(war: War, simulation: SimulationState) {
  const seed = `${war.id}:${simulation.date.year}:${simulation.date.month}:${simulation.date.day}:${war.elapsedDays}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

export function simulateWarDays(state: WarState, simulation: SimulationState, days: number): WarState {
  if (days <= 0 || !state.wars.some((war) => war.status === 'active')) return state;
  const wars = state.wars.map((war) => {
    if (war.status !== 'active') return war;

    const primaryFront = war.fronts[0];
    const attackers = coalitionPower(simulation, state, war.attackers, primaryFront, 'attacker');
    const defenders = coalitionPower(simulation, state, war.defenders, primaryFront, 'defender');
    const attackerPower = Math.max(0.1, attackers.power);
    const defenderPower = Math.max(0.1, defenders.power);
    const total = Math.max(1, attackerPower + defenderPower);
    const edge = (attackerPower - defenderPower) / total;
    const logisticsEdge = (attackers.logistics - defenders.logistics) / 100;
    const random = dailyNoise(war, simulation);
    const scoreDelta = (edge * 1.7 + logisticsEdge * 0.32 + random * 0.2) * Math.max(1, days / 7);
    const intensity = clamp(42 + Math.abs(edge) * 34 + Math.min(12, (attackers.formations + defenders.formations) * 1.5) + random * 9, 18, 96);
    const attackerLossDelta = Math.max(0, (defenderPower / attackerPower) * intensity * days * 0.011 * (1.08 - attackers.logistics / 220));
    const defenderLossDelta = Math.max(0, (attackerPower / defenderPower) * intensity * days * 0.011 * (1.08 - defenders.logistics / 220));
    const attackerSupport = clamp(war.attackerSupport - days * (0.017 + attackerLossDelta * 0.0009), 0, 100);
    const defenderSupport = clamp(war.defenderSupport - days * (0.017 + defenderLossDelta * 0.0009), 0, 100);
    const score = clamp(war.score + scoreDelta, -100, 100);
    const progress = clamp(50 + score * 0.48, 2, 98);

    let status: WarStatus = 'active';
    let victor: War['victor'];
    if (score >= 92 || defenderSupport <= 5) { status = 'ended'; victor = 'attackers'; }
    else if (score <= -92 || attackerSupport <= 5) { status = 'ended'; victor = 'defenders'; }
    else if (war.elapsedDays + days >= 3650 && Math.abs(score) < 25) { status = 'ended'; victor = 'stalemate'; }

    const fronts = war.fronts.map((front, index) => index === 0 ? {
      ...front,
      progress,
      intensity,
      attackerPower,
      defenderPower,
      attackerFormations: attackers.formations,
      defenderFormations: defenders.formations,
      attackerLogistics: attackers.logistics,
      defenderLogistics: defenders.logistics,
      operationalData: attackers.operationalData || defenders.operationalData,
    } : front);

    return {
      ...war,
      score,
      attackerSupport,
      defenderSupport,
      attackerLosses: war.attackerLosses + attackerLossDelta,
      defenderLosses: war.defenderLosses + defenderLossDelta,
      elapsedDays: war.elapsedDays + days,
      status,
      victor,
      fronts,
    };
  });
  return { ...state, wars };
}

export function warsForEntity(state: WarState, entityId: string) {
  return state.wars.filter((war) => war.attackers.includes(entityId) || war.defenders.includes(entityId));
}
