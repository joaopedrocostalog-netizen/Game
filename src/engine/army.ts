import { locationsForEntity, locationsForYear } from '../data/territories';
import type { SimulationState } from './simulation';

export type UnitType = 'field-army' | 'garrison' | 'mobile-corps';
export type UnitOrder = 'hold' | 'move' | 'prepare';

export type Commander = {
  id: string;
  name: string;
  skill: number;
  logistics: number;
  initiative: number;
};

export type ArmyUnit = {
  id: string;
  entityId: string;
  name: string;
  type: UnitType;
  commander: Commander;
  locationId: string;
  destinationId?: string;
  order: UnitOrder;
  personnel: number;
  strength: number;
  morale: number;
  organization: number;
  supply: number;
  equipment: number;
  movementProgress: number;
};

export type ArmyState = {
  units: ArmyUnit[];
  lastElapsedDay: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function commander(entityId: string, index: number): Commander {
  const seed = hash(`${entityId}:commander:${index}`);
  return {
    id: `${entityId}-cmd-${index}`,
    name: index === 0 ? 'Comandante do Exército Principal' : index === 1 ? 'Comandante da Reserva' : 'Comandante Regional',
    skill: 42 + (seed % 35),
    logistics: 38 + ((seed >> 5) % 40),
    initiative: 36 + ((seed >> 10) % 43),
  };
}

export function createInitialArmyState(): ArmyState {
  return { units: [], lastElapsedDay: 0 };
}

export function ensureEntityForces(state: ArmyState, simulation: SimulationState, entityId: string, year: number): ArmyState {
  if (!simulation.entities[entityId] || state.units.some((unit) => unit.entityId === entityId)) return state;
  const owned = locationsForEntity(entityId, year);
  if (!owned.length) return state;
  const runtime = simulation.entities[entityId];
  const count = Math.max(1, Math.min(3, Math.ceil(runtime.militaryReadiness / 32)));
  const units: ArmyUnit[] = Array.from({ length: count }, (_, index) => {
    const location = owned[index % owned.length];
    const cmd = commander(entityId, index);
    const basePersonnel = 9000 + Math.round(runtime.militaryReadiness * 170) + index * 2200;
    return {
      id: `${entityId}-army-${index + 1}`,
      entityId,
      name: index === 0 ? 'Exército Principal' : index === 1 ? 'Força de Reserva' : 'Comando Regional',
      type: index === 0 ? 'field-army' : index === 1 ? 'garrison' : 'mobile-corps',
      commander: cmd,
      locationId: location.id,
      order: 'hold',
      personnel: basePersonnel,
      strength: clamp(runtime.militaryReadiness * .82 + runtime.technology * .18),
      morale: clamp(52 + runtime.stability * .34),
      organization: clamp(46 + cmd.skill * .38 + runtime.technology * .18),
      supply: clamp(48 + runtime.treasuryIndex * .46),
      equipment: clamp(44 + runtime.technology * .52),
      movementProgress: 0,
    };
  });
  return { ...state, units: [...state.units, ...units], lastElapsedDay: simulation.elapsedDays };
}

export function issueMove(state: ArmyState, unitId: string, destinationId: string): ArmyState {
  const valid = locationsForYear(9999).some((location) => location.id === destinationId) || destinationId.length > 0;
  if (!valid) return state;
  return {
    ...state,
    units: state.units.map((unit) => unit.id === unitId ? { ...unit, destinationId, order: 'move', movementProgress: 0 } : unit),
  };
}

export function setUnitOrder(state: ArmyState, unitId: string, order: UnitOrder): ArmyState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === unitId ? { ...unit, order, destinationId: order === 'move' ? unit.destinationId : undefined, movementProgress: order === 'move' ? unit.movementProgress : 0 } : unit),
  };
}

export function simulateArmyToElapsed(state: ArmyState, simulation: SimulationState, activeWarEntities: Set<string>): ArmyState {
  const days = Math.max(0, simulation.elapsedDays - state.lastElapsedDay);
  if (!days) return state;
  const units = state.units.map((unit) => {
    const runtime = simulation.entities[unit.entityId];
    if (!runtime) return unit;
    const atWar = activeWarEntities.has(unit.entityId);
    const commandFactor = (unit.commander.logistics + unit.commander.skill) / 200;
    const fiscalFactor = runtime.treasuryIndex / 100;
    let supply = unit.supply;
    let organization = unit.organization;
    let morale = unit.morale;
    let strength = unit.strength;
    let movementProgress = unit.movementProgress;
    let locationId = unit.locationId;
    let destinationId = unit.destinationId;
    let order = unit.order;

    if (order === 'move' && destinationId) {
      movementProgress += days * (1.15 + unit.commander.initiative / 85) * Math.max(.45, supply / 100);
      supply -= days * .085;
      organization -= days * .035;
      if (movementProgress >= 100) {
        locationId = destinationId;
        destinationId = undefined;
        movementProgress = 0;
        order = 'hold';
        organization += 5;
      }
    } else if (order === 'prepare') {
      organization += days * .055 * commandFactor;
      supply += days * .035 * fiscalFactor;
      morale += days * .018;
    } else {
      supply += days * .02 * fiscalFactor;
      organization += days * .018 * commandFactor;
    }

    if (atWar) {
      supply -= days * .055;
      organization -= days * .028;
      morale -= days * .012;
      if (supply < 30) strength -= days * .018;
    }

    return {
      ...unit,
      locationId,
      destinationId,
      order,
      movementProgress: clamp(movementProgress),
      supply: clamp(supply),
      organization: clamp(organization),
      morale: clamp(morale),
      strength: clamp(strength),
    };
  });
  return { units, lastElapsedDay: simulation.elapsedDays };
}

export function forcesForEntity(state: ArmyState, entityId: string) {
  return state.units.filter((unit) => unit.entityId === entityId);
}

export function logisticsScore(state: ArmyState, entityId: string) {
  const units = forcesForEntity(state, entityId);
  if (!units.length) return 0;
  return units.reduce((sum, unit) => sum + unit.supply * .42 + unit.organization * .28 + unit.equipment * .18 + unit.commander.logistics * .12, 0) / units.length;
}
