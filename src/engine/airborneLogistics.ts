import { locationsForYear } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import { airCampaignState, type AirCampaignState, type AirFormation } from './airCampaign';
import { airOperationalReach } from './airBaseNetwork';
import { airborneOperationsState, type AirborneOperation } from './airborneOperations';
import type { SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { WarState } from './war';

export type AirborneSupplyState = 'linked' | 'air-supplied' | 'strained' | 'isolated' | 'collapse-risk' | 'collapsed' | 'evacuated';

export type AirborneLodgementLogistics = {
  operationId: string;
  entityId: string;
  unitId: string;
  warId: string;
  locationId: string;
  localReserves: number;
  airSupplyCapacity: number;
  isolationDays: number;
  groundLink: boolean;
  state: AirborneSupplyState;
  lastProcessedElapsedDay: number;
};

export type AirborneLogisticsState = {
  positions: Record<string, AirborneLodgementLogistics>;
};

type Root = typeof globalThis & {
  __WORLD_STATE_AIRBORNE_LOGISTICS__?: AirborneLogisticsState;
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirborneLogisticsState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_AIRBORNE_LOGISTICS__) root.__WORLD_STATE_AIRBORNE_LOGISTICS__ = { positions: {} };
  return root.__WORLD_STATE_AIRBORNE_LOGISTICS__;
}
function publish(state: AirborneLogisticsState) {
  (globalThis as Root).__WORLD_STATE_AIRBORNE_LOGISTICS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-airborne-logistics', { detail: state }));
}
function publishCampaign(state: AirCampaignState) {
  (globalThis as Root).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}
export function resetAirborneLogistics() { publish({ positions: {} }); }
export function airborneLogisticsState() {
  const state = rootState();
  return { positions: Object.fromEntries(Object.entries(state.positions).map(([id, position]) => [id, { ...position }])) };
}

function effectiveController(locationId: string, year: number, control: TerritorialControlState) {
  return control.occupations[locationId]?.controllerId
    ?? locationsForYear(year).find((location) => location.id === locationId)?.controllerId
    ?? locationsForYear(year).find((location) => location.id === locationId)?.ownerId
    ?? null;
}

function hasGroundLink(operation: AirborneOperation, armyState: ArmyState, control: TerritorialControlState, year: number) {
  const friendlyUnits = armyState.units.filter((unit) => unit.entityId === operation.entityId && unit.id !== operation.unitId);
  if (friendlyUnits.some((unit) => unit.locationId === operation.targetLocationId)) return true;
  const controller = effectiveController(operation.targetLocationId, year, control);
  return controller === operation.entityId && friendlyUnits.some((unit) => unit.locationId === operation.targetLocationId);
}

function transportSupport(operation: AirborneOperation, formations: AirFormation[], simulation: SimulationState) {
  const transports = formations.filter((formation) => formation.entityId === operation.entityId && formation.mission === 'air-transport' && formation.strength > 4);
  let capacity = 0;
  for (const transport of transports) {
    const reach = airOperationalReach(transport, operation.targetLocationId, simulation);
    if (!reach.reachable) continue;
    capacity += transport.strength * transport.readiness / 100 * transport.supply / 100 * reach.factor;
  }
  return clamp(capacity * 1.18);
}

function stateFor(groundLink: boolean, airSupply: number, reserves: number, isolationDays: number): AirborneSupplyState {
  if (groundLink) return 'linked';
  if (isolationDays >= 24 && reserves < 12 && airSupply < 15) return 'collapse-risk';
  if (airSupply >= 48 && reserves >= 35) return 'air-supplied';
  if (airSupply >= 24 || reserves >= 28) return 'strained';
  return 'isolated';
}

function establishedOperations() {
  return airborneOperationsState().operations.filter((operation) => operation.status === 'established');
}

export function processAirborneLogistics(
  simulation: SimulationState,
  warState: WarState,
  armyState: ArmyState,
  territorialControl: TerritorialControlState,
) {
  const state = rootState();
  const campaign = airCampaignState();
  let formations = campaign.formations.map((formation) => ({ ...formation }));
  let units = armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } }));
  let wars = warState.wars.map((war) => ({ ...war, fronts: war.fronts.map((front) => ({ ...front, attackerAssignments: [...front.attackerAssignments], defenderAssignments: [...front.defenderAssignments] })) }));
  const positions = { ...state.positions };
  let changed = false;

  for (const operation of establishedOperations()) {
    const unitIndex = units.findIndex((unit) => unit.id === operation.unitId);
    if (unitIndex < 0) continue;
    const unit = units[unitIndex];
    const previous = positions[operation.id];
    const lastProcessed = previous?.lastProcessedElapsedDay ?? operation.lastProcessedElapsedDay;
    const days = Math.max(0, simulation.elapsedDays - lastProcessed);
    const groundLink = hasGroundLink(operation, { ...armyState, units }, territorialControl, simulation.date.year);
    const airSupplyCapacity = transportSupport(operation, formations, simulation);
    let localReserves = previous?.localReserves ?? Math.max(12, 100 - operation.isolation * .65);
    let isolationDays = previous?.isolationDays ?? 0;

    if (days > 0) {
      if (groundLink) {
        localReserves = clamp(localReserves + days * .9);
        isolationDays = 0;
      } else {
        const delivered = days * (airSupplyCapacity / 100) * .72;
        const consumed = days * (1.05 + Math.max(0, 55 - unit.supply) / 90);
        localReserves = clamp(localReserves + delivered - consumed);
        isolationDays += days;

        const supplyDelta = delivered * .34 - consumed * .46;
        units[unitIndex] = {
          ...unit,
          supply: clamp(unit.supply + supplyDelta),
          organization: clamp(unit.organization + delivered * .1 - consumed * .17),
          morale: clamp(unit.morale + delivered * .045 - consumed * .08),
          equipment: clamp(unit.equipment - days * (localReserves < 25 ? .045 : .012)),
          strength: clamp(unit.strength - days * (localReserves < 12 ? .055 : localReserves < 25 ? .018 : 0)),
          personnel: Math.max(200, Math.round(unit.personnel * (1 - days * (localReserves < 10 ? .0014 : .00015)))),
        };

        if (airSupplyCapacity > 8) {
          const participating = formations.filter((formation) => formation.entityId === operation.entityId && formation.mission === 'air-transport' && airOperationalReach(formation, operation.targetLocationId, simulation).reachable);
          const ids = new Set(participating.map((formation) => formation.id));
          formations = formations.map((formation) => ids.has(formation.id)
            ? { ...formation, readiness: clamp(formation.readiness - days * .045), supply: clamp(formation.supply - days * .07), experience: clamp(formation.experience + days * .008) }
            : formation);
        }
      }
      changed = true;
    }

    let positionState = stateFor(groundLink, airSupplyCapacity, localReserves, isolationDays);
    const latestUnit = units[unitIndex];
    const collapse = !groundLink && isolationDays >= 30 && (localReserves < 8 || latestUnit.supply < 8 || latestUnit.organization < 8 || latestUnit.morale < 10);
    if (collapse) {
      positionState = 'collapsed';
      units = units.filter((candidate) => candidate.id !== operation.unitId);
      wars = wars.map((war) => war.id !== operation.warId ? war : {
        ...war,
        fronts: war.fronts
          .map((front) => ({ ...front, attackerAssignments: front.attackerAssignments.filter((id) => id !== operation.unitId), defenderAssignments: front.defenderAssignments.filter((id) => id !== operation.unitId) }))
          .filter((front) => front.attackerAssignments.length || front.defenderAssignments.length || front.locationId !== operation.targetLocationId),
      });
      changed = true;
    }

    positions[operation.id] = {
      operationId: operation.id,
      entityId: operation.entityId,
      unitId: operation.unitId,
      warId: operation.warId,
      locationId: operation.targetLocationId,
      localReserves,
      airSupplyCapacity,
      isolationDays,
      groundLink,
      state: positionState,
      lastProcessedElapsedDay: simulation.elapsedDays,
    };
  }

  if (changed || Object.keys(positions).length !== Object.keys(state.positions).length) {
    publish({ positions });
    publishCampaign({ ...campaign, formations });
  }
  return { armyState: { ...armyState, units }, warState: { ...warState, wars }, changed };
}

export function evacuateAirbornePosition(
  operationId: string,
  simulation: SimulationState,
  armyState: ArmyState,
) {
  const state = rootState();
  const position = state.positions[operationId];
  if (!position || position.state === 'collapsed' || position.state === 'evacuated') return { error: 'Posição aerotransportada indisponível para evacuação.' };
  const operation = airborneOperationsState().operations.find((item) => item.id === operationId && item.status === 'established');
  if (!operation) return { error: 'Operação aerotransportada não encontrada.' };
  const campaign = airCampaignState();
  const capable = campaign.formations.filter((formation) => formation.entityId === operation.entityId && formation.mission === 'air-transport' && airOperationalReach(formation, operation.targetLocationId, simulation).reachable);
  const capacity = capable.reduce((sum, formation) => sum + formation.strength * formation.readiness / 100 * formation.supply / 100, 0);
  if (capacity < 18) return { error: 'Não há capacidade aérea suficiente para uma evacuação organizada.' };
  const unit = armyState.units.find((candidate) => candidate.id === operation.unitId);
  if (!unit) return { error: 'A formação terrestre já não está operacional.' };

  const retreatLoss = position.state === 'collapse-risk' ? .09 : position.state === 'isolated' ? .055 : .03;
  const units = armyState.units.map((candidate) => candidate.id !== unit.id ? candidate : {
    ...candidate,
    locationId: operation.originLocationId,
    destinationId: undefined,
    order: 'hold' as const,
    movementProgress: 0,
    personnel: Math.max(200, Math.round(candidate.personnel * (1 - retreatLoss))),
    strength: clamp(candidate.strength - retreatLoss * 55),
    organization: clamp(candidate.organization - 18),
    morale: clamp(candidate.morale - 10),
    supply: clamp(candidate.supply - 8),
  });
  const participatingIds = new Set(capable.map((formation) => formation.id));
  const formations = campaign.formations.map((formation) => participatingIds.has(formation.id)
    ? { ...formation, readiness: clamp(formation.readiness - 8), supply: clamp(formation.supply - 12) }
    : formation);
  publish({ positions: { ...state.positions, [operationId]: { ...position, state: 'evacuated', lastProcessedElapsedDay: simulation.elapsedDays } } });
  publishCampaign({ ...campaign, formations });
  return { armyState: { ...armyState, units } };
}

export function airborneLogisticsForEntity(entityId: string) {
  return Object.values(rootState().positions).filter((position) => position.entityId === entityId).map((position) => ({ ...position }));
}
