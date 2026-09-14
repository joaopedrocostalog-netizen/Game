import { locationsForYear } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import { amphibiousOperationsState, type AmphibiousOperation } from './amphibiousOperations';
import { navalState } from './navalForces';
import { amphibiousReadiness } from './navalWarfare';
import type { SimulationState, WorldEvent } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { WarState } from './war';

export type BeachheadSupplyStatus = 'secure' | 'strained' | 'isolated' | 'collapsing' | 'evacuated' | 'lost';

export type BeachheadLogisticsRecord = {
  operationId: string;
  entityId: string;
  warId: string;
  unitId: string;
  targetLocationId: string;
  originPortId: string;
  throughput: number;
  reserveDays: number;
  portAccess: 'captured-port' | 'improvised-shore' | 'none';
  status: BeachheadSupplyStatus;
  isolatedDays: number;
  lastProcessedElapsedDay: number;
};

export type BeachheadLogisticsState = {
  records: Record<string, BeachheadLogisticsRecord>;
};

type BeachheadGlobal = typeof globalThis & { __WORLD_STATE_BEACHHEAD_LOGISTICS__?: BeachheadLogisticsState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): BeachheadLogisticsState {
  const root = globalThis as BeachheadGlobal;
  if (!root.__WORLD_STATE_BEACHHEAD_LOGISTICS__) root.__WORLD_STATE_BEACHHEAD_LOGISTICS__ = { records: {} };
  return root.__WORLD_STATE_BEACHHEAD_LOGISTICS__;
}

function publish(state: BeachheadLogisticsState) {
  (globalThis as BeachheadGlobal).__WORLD_STATE_BEACHHEAD_LOGISTICS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-beachhead-logistics', { detail: state }));
}

export function resetBeachheadLogistics() {
  publish({ records: {} });
}

export function beachheadLogisticsState() {
  const state = rootState();
  return { records: Object.fromEntries(Object.entries(state.records).map(([id, record]) => [id, { ...record }])) };
}

function unitDemand(unit: ArmyUnit) {
  return clamp(unit.personnel / 560 + unit.equipment * .13 + unit.strength * .08, 18, 78);
}

function effectivePortAccess(operation: AmphibiousOperation, control: TerritorialControlState, year: number): BeachheadLogisticsRecord['portAccess'] {
  const target = locationsForYear(year).find((location) => location.id === operation.targetLocationId);
  if (!target) return 'none';
  const occupation = control.occupations[target.id];
  const controlled = occupation?.controllerId === operation.entityId || (occupation?.progress ?? 0) >= 78;
  if (target.kind === 'port' && controlled) return 'captured-port';
  if (target.kind === 'port' || target.terrain === 'coastal') return 'improvised-shore';
  return 'none';
}

function maritimeLink(operation: AmphibiousOperation) {
  const readiness = amphibiousReadiness(operation.entityId, operation.zoneId);
  const zone = navalState().zones.find((item) => item.zoneId === operation.zoneId);
  const control = zone?.controllerId === operation.entityId ? 1 : zone?.contested ? .62 : .34;
  return { readiness, control };
}

function throughputFor(operation: AmphibiousOperation, unit: ArmyUnit, control: TerritorialControlState, simulation: SimulationState) {
  const portAccess = effectivePortAccess(operation, control, simulation.date.year);
  const link = maritimeLink(operation);
  const portFactor = portAccess === 'captured-port' ? 1.32 : portAccess === 'improvised-shore' ? .72 : .28;
  const transport = link.readiness.transport * .58;
  const cover = link.readiness.cover * .24;
  const command = (unit.commander.logistics + unit.commander.skill) / 200;
  const throughput = clamp((transport + cover) * link.control * portFactor * (.82 + command * .28));
  return { throughput, portAccess, link };
}

function statusFor(throughput: number, demand: number, reserveDays: number, isolatedDays: number): BeachheadSupplyStatus {
  const ratio = throughput / Math.max(1, demand);
  if (isolatedDays >= 20 && reserveDays <= 3) return 'collapsing';
  if (ratio < .36 || reserveDays <= 2) return 'isolated';
  if (ratio < .72 || reserveDays < 8) return 'strained';
  return 'secure';
}

function activeEstablishedOperations() {
  return amphibiousOperationsState().operations.filter((operation) => operation.status === 'established');
}

function initialRecord(operation: AmphibiousOperation, simulation: SimulationState): BeachheadLogisticsRecord {
  return {
    operationId: operation.id,
    entityId: operation.entityId,
    warId: operation.warId,
    unitId: operation.unitId,
    targetLocationId: operation.targetLocationId,
    originPortId: operation.originPortId,
    throughput: 0,
    reserveDays: operation.result === 'secure-beachhead' ? 12 : 8,
    portAccess: 'improvised-shore',
    status: 'strained',
    isolatedDays: 0,
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}

function removeBeachheadFront(warState: WarState, record: BeachheadLogisticsRecord) {
  return {
    ...warState,
    wars: warState.wars.map((war) => war.id !== record.warId ? war : {
      ...war,
      fronts: war.fronts.filter((front) => !(front.locationId === record.targetLocationId && front.id.includes('amphibious'))),
    }),
  };
}

function evacuateUnit(armyState: ArmyState, record: BeachheadLogisticsRecord, penalty = 0) {
  return {
    ...armyState,
    units: armyState.units.map((unit) => unit.id !== record.unitId ? unit : {
      ...unit,
      locationId: record.originPortId,
      destinationId: undefined,
      order: 'prepare' as const,
      movementProgress: 0,
      personnel: Math.max(400, Math.round(unit.personnel * (1 - penalty))),
      strength: clamp(unit.strength - penalty * 45),
      morale: clamp(unit.morale - 7 - penalty * 30),
      organization: clamp(unit.organization - 12 - penalty * 35),
      supply: clamp(Math.max(18, unit.supply - 8)),
    }),
  };
}

export function requestBeachheadEvacuation(operationId: string, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  const record = state.records[operationId];
  if (!record || !['secure', 'strained', 'isolated', 'collapsing'].includes(record.status)) return { armyState, warState, error: 'Cabeça de praia indisponível para evacuação.' };
  const operation = amphibiousOperationsState().operations.find((item) => item.id === operationId);
  if (!operation) return { armyState, warState, error: 'Operação anfíbia não encontrada.' };
  const link = maritimeLink(operation);
  if (link.readiness.transport < operation.transportRequired * .55) return { armyState, warState, error: 'Capacidade de transporte insuficiente para retirar a formação.' };
  const penalty = link.control < .5 ? .08 : link.control < .75 ? .035 : .015;
  const nextArmy = evacuateUnit(armyState, record, penalty);
  const nextWar = removeBeachheadFront(warState, record);
  const nextRecord = { ...record, status: 'evacuated' as const, reserveDays: 0 };
  publish({ records: { ...state.records, [operationId]: nextRecord } });
  return { armyState: nextArmy, warState: nextWar };
}

export function processBeachheadLogistics(
  simulation: SimulationState,
  armyState: ArmyState,
  warState: WarState,
  territorialControl: TerritorialControlState,
) {
  const state = rootState();
  const records = { ...state.records };
  let nextArmy: ArmyState = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  let nextWar = warState;
  let nextSimulation = simulation;
  let changed = false;

  for (const operation of activeEstablishedOperations()) {
    let record = records[operation.id] ?? initialRecord(operation, simulation);
    const unit = nextArmy.units.find((item) => item.id === operation.unitId);
    const war = nextWar.wars.find((item) => item.id === operation.warId && item.status === 'active');
    if (!unit || !war) {
      if (record.status !== 'lost' && record.status !== 'evacuated') {
        record = { ...record, status: 'lost', reserveDays: 0, lastProcessedElapsedDay: simulation.elapsedDays };
        records[operation.id] = record;
        changed = true;
      }
      continue;
    }
    if (record.status === 'evacuated' || record.status === 'lost') continue;
    const days = Math.max(0, simulation.elapsedDays - record.lastProcessedElapsedDay);
    const logistics = throughputFor(operation, unit, territorialControl, simulation);
    const demand = unitDemand(unit);
    const ratio = logistics.throughput / Math.max(1, demand);
    let reserveDays = record.reserveDays;
    let isolatedDays = record.isolatedDays;
    if (days > 0) {
      reserveDays = clamp(reserveDays + days * (ratio - .78) * .22, 0, 45);
      isolatedDays = ratio < .42 ? isolatedDays + days : Math.max(0, isolatedDays - days * .55);
    }
    const status = statusFor(logistics.throughput, demand, reserveDays, isolatedDays);

    if (days > 0) {
      nextArmy = {
        ...nextArmy,
        units: nextArmy.units.map((item) => {
          if (item.id !== unit.id) return item;
          if (status === 'secure') return { ...item, supply: clamp(item.supply + days * .075), organization: clamp(item.organization + days * .028), morale: clamp(item.morale + days * .012) };
          if (status === 'strained') return { ...item, supply: clamp(item.supply - days * .045), organization: clamp(item.organization - days * .02) };
          if (status === 'isolated') return { ...item, supply: clamp(item.supply - days * .13), organization: clamp(item.organization - days * .085), morale: clamp(item.morale - days * .04), equipment: clamp(item.equipment - days * .025) };
          return { ...item, supply: clamp(item.supply - days * .2), organization: clamp(item.organization - days * .14), morale: clamp(item.morale - days * .09), equipment: clamp(item.equipment - days * .045), strength: clamp(item.strength - days * .035) };
        }),
      };
    }

    record = {
      ...record,
      throughput: logistics.throughput,
      portAccess: logistics.portAccess,
      reserveDays,
      isolatedDays,
      status,
      lastProcessedElapsedDay: simulation.elapsedDays,
    };

    if (status === 'collapsing' && isolatedDays >= 28) {
      const link = maritimeLink(operation);
      const canEvacuate = link.readiness.transport >= operation.transportRequired * .5;
      if (canEvacuate) {
        nextArmy = evacuateUnit(nextArmy, record, .09);
        nextWar = removeBeachheadFront(nextWar, record);
        record = { ...record, status: 'evacuated', reserveDays: 0 };
        const event: WorldEvent = {
          id: `beachhead-evacuated-${operation.id}-${simulation.elapsedDays}`,
          date: simulation.date,
          entityId: operation.entityId,
          category: 'military',
          title: 'Cabeça de praia evacuada',
          text: 'A ligação marítima tornou-se insustentável e a formação foi retirada antes do colapso completo da posição.',
        };
        nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
      } else {
        nextWar = removeBeachheadFront(nextWar, record);
        nextArmy = { ...nextArmy, units: nextArmy.units.filter((item) => item.id !== record.unitId) };
        record = { ...record, status: 'lost', reserveDays: 0 };
        const event: WorldEvent = {
          id: `beachhead-lost-${operation.id}-${simulation.elapsedDays}`,
          date: simulation.date,
          entityId: operation.entityId,
          category: 'military',
          title: 'Cabeça de praia colapsou',
          text: 'A força ficou isolada sem capacidade marítima suficiente para sustentação ou retirada e deixou de operar como formação organizada.',
        };
        nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
      }
    }

    records[operation.id] = record;
    changed = changed || days > 0 || !state.records[operation.id];
  }

  if (changed) publish({ records });
  return { simulation: nextSimulation, armyState: nextArmy, warState: nextWar, changed };
}
