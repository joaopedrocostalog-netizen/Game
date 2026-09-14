import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import { amphibiousReadiness } from './navalWarfare';
import { navalState, seaZoneForLocation, type NavalState, type SeaZoneId } from './navalForces';
import type { SimulationState, WorldEvent } from './simulation';
import type { FrontState, WarState } from './war';

export type AmphibiousOperationStatus = 'preparing' | 'delayed' | 'established' | 'failed' | 'cancelled';

export type AmphibiousOperation = {
  id: string;
  entityId: string;
  warId: string;
  unitId: string;
  originPortId: string;
  targetLocationId: string;
  zoneId: SeaZoneId;
  status: AmphibiousOperationStatus;
  startedAtElapsedDay: number;
  plannedLandingElapsedDay: number;
  preparation: number;
  navalReadinessAtStart: number;
  transportRequired: number;
  result?: 'secure-beachhead' | 'contested-landing' | 'repulsed';
  delayReason?: string;
};

export type AmphibiousOperationsState = {
  operations: AmphibiousOperation[];
};

type AmphibiousGlobal = typeof globalThis & {
  __WORLD_STATE_AMPHIBIOUS_OPERATIONS__?: AmphibiousOperationsState;
  __WORLD_STATE_NAVAL_FORCES__?: NavalState;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): AmphibiousOperationsState {
  const root = globalThis as AmphibiousGlobal;
  if (!root.__WORLD_STATE_AMPHIBIOUS_OPERATIONS__) root.__WORLD_STATE_AMPHIBIOUS_OPERATIONS__ = { operations: [] };
  return root.__WORLD_STATE_AMPHIBIOUS_OPERATIONS__;
}

function publish(state: AmphibiousOperationsState) {
  (globalThis as AmphibiousGlobal).__WORLD_STATE_AMPHIBIOUS_OPERATIONS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-amphibious-operations', { detail: state }));
}

export function resetAmphibiousOperations() {
  publish({ operations: [] });
}

export function amphibiousOperationsState() {
  return { operations: rootState().operations.map((operation) => ({ ...operation })) };
}

function isCoastal(location: ResolvedLocation) {
  return location.kind === 'port' || location.terrain === 'coastal';
}

function preparationDays(year: number, unit: ArmyUnit, navalScore: number) {
  const era = year < 1700 ? 70 : year < 1850 ? 55 : year < 1945 ? 40 : 28;
  const command = (unit.commander.logistics + unit.commander.initiative) / 200;
  const modifier = 1.12 - command * .28 - Math.min(.18, navalScore / 500);
  return Math.max(18, Math.round(era * modifier));
}

function transportRequirement(unit: ArmyUnit) {
  return clamp(unit.personnel / 720 + unit.equipment * .08, 14, 62);
}

function activeWar(warState: WarState, warId: string) {
  return warState.wars.find((war) => war.id === warId && war.status === 'active');
}

export function amphibiousTargets(entityId: string, warId: string, simulation: SimulationState, warState: WarState) {
  const war = activeWar(warState, warId);
  if (!war || !war.attackers.includes(entityId)) return [];
  const enemies = new Set(war.defenders);
  return locationsForYear(simulation.date.year)
    .filter((location) => isCoastal(location) && !!location.ownerId && enemies.has(location.ownerId))
    .map((location) => ({ ...location }));
}

export function amphibiousUnits(entityId: string, armyState: ArmyState) {
  return armyState.units
    .filter((unit) => unit.entityId === entityId && unit.personnel > 1200 && unit.strength > 20 && unit.organization > 24)
    .map((unit) => ({ ...unit, commander: { ...unit.commander } }));
}

export function startAmphibiousOperation(
  entityId: string,
  warId: string,
  unitId: string,
  targetLocationId: string,
  simulation: SimulationState,
  armyState: ArmyState,
  warState: WarState,
) {
  const war = activeWar(warState, warId);
  if (!war) return { error: 'Guerra ativa não encontrada.' };
  if (!war.attackers.includes(entityId)) return { error: 'Nesta versão, invasões anfíbias ofensivas são iniciadas pelo lado atacante da guerra.' };
  const unit = armyState.units.find((item) => item.id === unitId && item.entityId === entityId);
  if (!unit) return { error: 'Formação terrestre inválida.' };
  const target = amphibiousTargets(entityId, warId, simulation, warState).find((location) => location.id === targetLocationId);
  if (!target) return { error: 'Costa-alvo inválida ou fora do conflito selecionado.' };
  const ports = locationsForEntity(entityId, simulation.date.year).filter(isCoastal);
  if (!ports.length) return { error: 'Nenhum porto de embarque está disponível.' };
  const zoneId = seaZoneForLocation(target);
  const readiness = amphibiousReadiness(entityId, zoneId);
  const required = transportRequirement(unit);
  if (!readiness.available || readiness.transport < required) return { error: 'Transporte ou cobertura naval insuficientes na zona marítima do alvo.' };
  const state = rootState();
  if (state.operations.some((operation) => operation.unitId === unitId && (operation.status === 'preparing' || operation.status === 'delayed'))) {
    return { error: 'Essa formação já está comprometida com uma operação anfíbia.' };
  }
  const days = preparationDays(simulation.date.year, unit, readiness.score);
  const operation: AmphibiousOperation = {
    id: `amphib-${entityId}-${warId}-${unitId}-${simulation.elapsedDays}`,
    entityId,
    warId,
    unitId,
    originPortId: ports[0].id,
    targetLocationId,
    zoneId,
    status: 'preparing',
    startedAtElapsedDay: simulation.elapsedDays,
    plannedLandingElapsedDay: simulation.elapsedDays + days,
    preparation: 0,
    navalReadinessAtStart: readiness.score,
    transportRequired: required,
  };
  publish({ operations: [operation, ...state.operations].slice(0, 80) });
  return { operation };
}

export function cancelAmphibiousOperation(operationId: string) {
  const state = rootState();
  const operation = state.operations.find((item) => item.id === operationId);
  if (!operation || !['preparing', 'delayed'].includes(operation.status)) return false;
  publish({ operations: state.operations.map((item) => item.id === operationId ? { ...item, status: 'cancelled' as const } : item) });
  return true;
}

function deterministic(seed: string) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return .9 + (Math.abs(h >>> 0) % 21) / 100;
}

function defensivePower(targetId: string, enemyIds: Set<string>, armyState: ArmyState, simulation: SimulationState) {
  const direct = armyState.units.filter((unit) => enemyIds.has(unit.entityId) && unit.locationId === targetId);
  if (direct.length) {
    return direct.reduce((sum, unit) => sum + unit.strength * .28 + unit.organization * .24 + unit.morale * .16 + unit.supply * .14 + unit.equipment * .18, 0) / direct.length;
  }
  const fallback = [...enemyIds].reduce((sum, id) => sum + (simulation.entities[id]?.militaryReadiness ?? 35), 0) / Math.max(1, enemyIds.size);
  return fallback * .7;
}

function landingPower(unit: ArmyUnit, navalScore: number) {
  const unitReadiness = unit.strength * .22 + unit.organization * .25 + unit.morale * .16 + unit.supply * .18 + unit.equipment * .19;
  const command = unit.commander.skill * .12 + unit.commander.logistics * .1 + unit.commander.initiative * .13;
  return unitReadiness * .62 + command * .38 + navalScore * .2;
}

function beachheadFront(operation: AmphibiousOperation, target: ResolvedLocation, unitId: string, defenderAssignments: string[], existingCount: number): FrontState {
  return {
    id: `${operation.warId}-amphibious-${target.id}`,
    name: `Cabeça de praia de ${target.name}`,
    locationId: target.id,
    terrain: target.terrain,
    progress: 52,
    intensity: 58,
    attackerPower: 0,
    defenderPower: 0,
    attackerFormations: 1,
    defenderFormations: defenderAssignments.length,
    attackerLogistics: 42,
    defenderLogistics: 50,
    operationalData: true,
    attackerPriority: existingCount >= 2 ? 'high' : 'main',
    defenderPriority: 'main',
    attackerPriorityManual: true,
    defenderPriorityManual: false,
    attackerOrder: 'cautious',
    defenderOrder: 'defend',
    attackerOrderManual: true,
    defenderOrderManual: false,
    attackerAssignments: [unitId],
    defenderAssignments,
  };
}

function consumeNavalEffort(entityId: string, zoneId: SeaZoneId, severity: number) {
  const root = globalThis as AmphibiousGlobal;
  const naval = root.__WORLD_STATE_NAVAL_FORCES__;
  if (!naval) return;
  const fleets = naval.fleets.map((fleet) => {
    if (fleet.entityId !== entityId || fleet.zoneId !== zoneId || !['transport', 'escort', 'sea-control'].includes(fleet.mission)) return fleet;
    return { ...fleet, readiness: clamp(fleet.readiness - severity * 4), supply: clamp(fleet.supply - severity * 6) };
  });
  root.__WORLD_STATE_NAVAL_FORCES__ = { ...naval, fleets };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-naval-forces', { detail: { ...naval, fleets } }));
}

export function processAmphibiousOperations(
  simulation: SimulationState,
  armyState: ArmyState,
  warState: WarState,
) {
  const state = rootState();
  let nextArmy: ArmyState = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  let nextWar: WarState = { ...warState, wars: warState.wars.map((war) => ({ ...war, fronts: war.fronts.map((front) => ({ ...front, attackerAssignments: [...front.attackerAssignments], defenderAssignments: [...front.defenderAssignments] })) })) };
  let nextSimulation = simulation;
  let changed = false;

  const operations = state.operations.map((operation) => {
    if (!['preparing', 'delayed'].includes(operation.status)) return operation;
    const elapsed = simulation.elapsedDays - operation.startedAtElapsedDay;
    const duration = Math.max(1, operation.plannedLandingElapsedDay - operation.startedAtElapsedDay);
    const preparation = clamp(elapsed / duration * 100);
    if (simulation.elapsedDays < operation.plannedLandingElapsedDay) return preparation !== operation.preparation ? { ...operation, preparation } : operation;

    const war = activeWar(nextWar, operation.warId);
    const unit = nextArmy.units.find((item) => item.id === operation.unitId);
    const target = locationsForYear(simulation.date.year).find((location) => location.id === operation.targetLocationId);
    if (!war || !unit || !target) {
      changed = true;
      return { ...operation, preparation: 100, status: 'failed' as const, result: 'repulsed' as const, delayReason: 'A situação estratégica mudou antes do desembarque.' };
    }

    const readiness = amphibiousReadiness(operation.entityId, operation.zoneId);
    if (!readiness.available || readiness.transport < operation.transportRequired * .82) {
      changed = true;
      return {
        ...operation,
        preparation: 100,
        status: 'delayed' as const,
        plannedLandingElapsedDay: simulation.elapsedDays + 7,
        delayReason: 'Cobertura marítima ou capacidade de transporte caiu abaixo do necessário.',
      };
    }

    const enemyIds = new Set(war.defenders);
    const defenders = nextArmy.units.filter((item) => enemyIds.has(item.entityId) && item.locationId === target.id);
    const defense = defensivePower(target.id, enemyIds, nextArmy, simulation);
    const attack = landingPower(unit, readiness.score) * deterministic(`${operation.id}:${simulation.elapsedDays}`);
    const terrainPenalty = target.terrain === 'coastal' ? .96 : .9;
    const ratio = attack * terrainPenalty / Math.max(1, defense);
    const success = ratio >= .92;
    const secure = ratio >= 1.22;
    const lossRate = clamp((success ? .035 : .085) + Math.max(0, 1.05 - ratio) * .08, .025, .16);

    nextArmy = {
      ...nextArmy,
      units: nextArmy.units.map((item) => {
        if (item.id !== unit.id) return item;
        const personnel = Math.max(400, Math.round(item.personnel * (1 - lossRate)));
        if (!success) return {
          ...item,
          locationId: operation.originPortId,
          order: 'prepare' as const,
          personnel,
          strength: clamp(item.strength - lossRate * 55),
          morale: clamp(item.morale - 13),
          organization: clamp(item.organization - 18),
          supply: clamp(item.supply - 12),
        };
        return {
          ...item,
          locationId: target.id,
          destinationId: undefined,
          order: 'prepare' as const,
          movementProgress: 0,
          personnel,
          strength: clamp(item.strength - lossRate * 36),
          morale: clamp(item.morale - (secure ? 4 : 8)),
          organization: clamp(item.organization - (secure ? 10 : 15)),
          supply: clamp(item.supply - 14),
        };
      }),
    };

    consumeNavalEffort(operation.entityId, operation.zoneId, success ? 1 : 1.5);
    changed = true;

    if (!success) {
      const event: WorldEvent = {
        id: `amphibious-failed-${operation.id}`,
        date: simulation.date,
        entityId: operation.entityId,
        category: 'military',
        title: 'Desembarque anfíbio repelido',
        text: 'A força de desembarque não conseguiu estabelecer uma posição sustentável e retornou ao porto de origem com perdas.',
      };
      nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
      return { ...operation, preparation: 100, status: 'failed' as const, result: 'repulsed' as const };
    }

    nextWar = {
      ...nextWar,
      wars: nextWar.wars.map((item) => {
        if (item.id !== war.id) return item;
        if (item.fronts.some((front) => front.locationId === target.id)) return item;
        const front = beachheadFront(operation, target, unit.id, defenders.map((defender) => defender.id), item.fronts.length);
        return { ...item, fronts: [front, ...item.fronts] };
      }),
    };
    const event: WorldEvent = {
      id: `amphibious-established-${operation.id}`,
      date: simulation.date,
      entityId: operation.entityId,
      category: 'military',
      title: secure ? 'Cabeça de praia estabelecida' : 'Desembarque contestado estabelecido',
      text: secure
        ? 'A força de desembarque consolidou uma cabeça de praia e abriu uma nova frente terrestre na costa-alvo.'
        : 'A força conseguiu permanecer na costa, mas a cabeça de praia continua sob forte pressão defensiva.',
    };
    nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    return { ...operation, preparation: 100, status: 'established' as const, result: secure ? 'secure-beachhead' as const : 'contested-landing' as const };
  });

  if (changed || operations.some((operation, index) => operation.preparation !== state.operations[index]?.preparation)) publish({ operations });
  return { simulation: nextSimulation, armyState: nextArmy, warState: nextWar, changed };
}
