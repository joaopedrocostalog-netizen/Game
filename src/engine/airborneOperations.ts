import { locationsForYear } from '../data/territories';
import type { ArmyState, ArmyUnit } from './army';
import { airCampaignState, airControlForFront, type AirCampaignState, type AirFormation } from './airCampaign';
import { airOperationalReach } from './airBaseNetwork';
import type { SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { FrontState, War, WarState } from './war';

export type AirborneOperationStatus = 'preparing' | 'ready' | 'established' | 'failed' | 'cancelled';
export type AirborneOperationResult = 'secure-lodgement' | 'dispersed-lodgement' | 'repelled';

export type AirborneOperation = {
  id: string;
  entityId: string;
  warId: string;
  unitId: string;
  transportFormationId: string;
  originLocationId: string;
  targetLocationId: string;
  startedAtElapsedDay: number;
  readyAtElapsedDay: number;
  status: AirborneOperationStatus;
  preparation: number;
  isolation: number;
  result?: AirborneOperationResult;
  lastProcessedElapsedDay: number;
};

export type AirborneOperationsState = {
  operations: AirborneOperation[];
};

type AirborneRoot = typeof globalThis & {
  __WORLD_STATE_AIRBORNE_OPERATIONS__?: AirborneOperationsState;
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirborneOperationsState {
  const root = globalThis as AirborneRoot;
  if (!root.__WORLD_STATE_AIRBORNE_OPERATIONS__) root.__WORLD_STATE_AIRBORNE_OPERATIONS__ = { operations: [] };
  return root.__WORLD_STATE_AIRBORNE_OPERATIONS__;
}
function publish(state: AirborneOperationsState) {
  (globalThis as AirborneRoot).__WORLD_STATE_AIRBORNE_OPERATIONS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-airborne-operations', { detail: state }));
}
function publishCampaign(state: AirCampaignState) {
  (globalThis as AirborneRoot).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}
export function resetAirborneOperations() { publish({ operations: [] }); }
export function airborneOperationsState() { return { operations: rootState().operations.map((operation) => ({ ...operation })) }; }

export function airborneEraAvailable(year: number) { return year >= 1935; }
export function airborneEraLabel(year: number) {
  if (year < 1935) return 'Operações aerotransportadas ainda indisponíveis';
  if (year < 1945) return 'Forças aerotransportadas pioneiras';
  if (year < 1980) return 'Operações aerotransportadas';
  return 'Mobilidade aérea e forças aerotransportadas';
}

function activeWarForEntity(warState: WarState, entityId: string, warId: string) {
  return warState.wars.find((war) => war.id === warId && war.status === 'active' && war.attackers.includes(entityId));
}
function targetController(locationId: string, year: number, territorialControl: TerritorialControlState) {
  const occupation = territorialControl.occupations[locationId];
  if (occupation) return occupation.controllerId;
  const location = locationsForYear(year).find((item) => item.id === locationId);
  return location?.controllerId ?? location?.ownerId ?? null;
}
function enemyIds(war: War) { return new Set(war.defenders); }
function eligibleGroundUnit(unit: ArmyUnit) {
  return unit.personnel <= 18000 && unit.organization >= 38 && unit.supply >= 40 && unit.order !== 'retreat';
}
function transportCapacity(formation: AirFormation) {
  return formation.strength * .46 + formation.readiness * .28 + formation.supply * .26;
}
function airSituationFactor(war: War, entityId: string) {
  const controls = war.fronts.map((front) => airControlForFront(war.id, front.id)).filter(Boolean);
  if (!controls.length) return .82;
  let best = .45;
  for (const control of controls) {
    if (!control) continue;
    const entityIsAttacker = war.attackers.includes(entityId);
    const favorable = entityIsAttacker ? control.state === 'attacker-dominant' : control.state === 'defender-dominant';
    const hostile = entityIsAttacker ? control.state === 'defender-dominant' : control.state === 'attacker-dominant';
    best = Math.max(best, favorable ? 1.08 : hostile ? .42 : control.state === 'contested' ? .78 : .64);
  }
  return best;
}
function prepDays(year: number, unit: ArmyUnit, transport: AirFormation) {
  const era = year < 1945 ? 28 : year < 1980 ? 20 : 14;
  const command = (unit.commander.skill + unit.commander.initiative) / 200;
  const transportQuality = (transport.readiness + transport.experience) / 200;
  return Math.max(8, Math.round(era * (1.18 - command * .22 - transportQuality * .16)));
}
function deterministic(seed: string) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (Math.abs(h >>> 0) % 1000) / 1000;
}

export function startAirborneOperation(
  entityId: string,
  warId: string,
  unitId: string,
  transportFormationId: string,
  targetLocationId: string,
  simulation: SimulationState,
  warState: WarState,
  armyState: ArmyState,
  territorialControl: TerritorialControlState,
) {
  if (!airborneEraAvailable(simulation.date.year)) return { error: 'A época ainda não permite operações aerotransportadas organizadas.' };
  const war = activeWarForEntity(warState, entityId, warId);
  if (!war) return { error: 'A operação aerotransportada deve apoiar o lado atacante de uma guerra ativa.' };
  const unit = armyState.units.find((item) => item.id === unitId && item.entityId === entityId);
  if (!unit) return { error: 'Formação terrestre não encontrada.' };
  if (!eligibleGroundUnit(unit)) return { error: 'A formação precisa ser relativamente leve, organizada e abastecida para esta operação.' };
  const campaign = airCampaignState();
  const transport = campaign.formations.find((item) => item.id === transportFormationId && item.entityId === entityId && item.mission === 'air-transport');
  if (!transport) return { error: 'Selecione uma formação aérea dedicada ao transporte.' };
  if (transportCapacity(transport) < 48) return { error: 'A capacidade de transporte está insuficiente para a operação.' };
  const controller = targetController(targetLocationId, simulation.date.year, territorialControl);
  if (!controller || !enemyIds(war).has(controller)) return { error: 'O alvo precisa estar sob controle do lado inimigo desta guerra.' };
  const reach = airOperationalReach(transport, targetLocationId, simulation);
  if (!reach.reachable) return { error: 'O alvo está fora do alcance operacional da formação de transporte.' };
  if (airSituationFactor(war, entityId) < .55) return { error: 'A situação aérea está desfavorável demais para iniciar a operação.' };
  const state = rootState();
  if (state.operations.some((operation) => operation.unitId === unitId && (operation.status === 'preparing' || operation.status === 'ready'))) return { error: 'Esta formação terrestre já está comprometida com uma operação aerotransportada.' };
  const duration = prepDays(simulation.date.year, unit, transport);
  const operation: AirborneOperation = {
    id: `airborne-${warId}-${unitId}-${simulation.elapsedDays}`,
    entityId,
    warId,
    unitId,
    transportFormationId,
    originLocationId: unit.locationId,
    targetLocationId,
    startedAtElapsedDay: simulation.elapsedDays,
    readyAtElapsedDay: simulation.elapsedDays + duration,
    status: 'preparing',
    preparation: 0,
    isolation: 0,
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
  publish({ operations: [operation, ...state.operations].slice(0, 80) });
  return { operation };
}

function airborneFront(targetLocationId: string, unit: ArmyUnit, existingCount: number): FrontState {
  const location = locationsForYear(9999).find((item) => item.id === targetLocationId);
  return {
    id: `airborne-front-${targetLocationId}-${existingCount + 1}`,
    name: `Posição aerotransportada — ${location?.name ?? targetLocationId}`,
    locationId: targetLocationId,
    terrain: location?.terrain,
    progress: 0,
    intensity: 52,
    attackerPower: 0,
    defenderPower: 0,
    attackerFormations: 1,
    defenderFormations: 0,
    attackerLogistics: 28,
    defenderLogistics: 55,
    operationalData: true,
    attackerPriority: 'high',
    defenderPriority: 'high',
    attackerOrder: 'defend',
    defenderOrder: 'offensive',
    attackerAssignments: [unit.id],
    defenderAssignments: [],
  };
}

export function processAirborneOperations(
  simulation: SimulationState,
  warState: WarState,
  armyState: ArmyState,
  territorialControl: TerritorialControlState,
) {
  const state = rootState();
  if (!state.operations.length) return { armyState, warState, changed: false };
  const campaign = airCampaignState();
  let formations = campaign.formations.map((item) => ({ ...item }));
  let units = armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } }));
  let wars = warState.wars.map((war) => ({ ...war, fronts: war.fronts.map((front) => ({ ...front, attackerAssignments: [...front.attackerAssignments], defenderAssignments: [...front.defenderAssignments] })) }));
  let changed = false;

  const operations = state.operations.map((operation) => {
    if (operation.status !== 'preparing' && operation.status !== 'ready') return operation;
    const war = wars.find((item) => item.id === operation.warId && item.status === 'active');
    const unit = units.find((item) => item.id === operation.unitId);
    const transport = formations.find((item) => item.id === operation.transportFormationId);
    if (!war || !unit || !transport) return { ...operation, status: 'cancelled' as const, lastProcessedElapsedDay: simulation.elapsedDays };

    const elapsed = Math.max(0, simulation.elapsedDays - operation.startedAtElapsedDay);
    const totalPrep = Math.max(1, operation.readyAtElapsedDay - operation.startedAtElapsedDay);
    const preparation = clamp(elapsed / totalPrep * 100);
    if (simulation.elapsedDays < operation.readyAtElapsedDay) {
      if (preparation !== operation.preparation) changed = true;
      return { ...operation, preparation, lastProcessedElapsedDay: simulation.elapsedDays };
    }

    const controller = targetController(operation.targetLocationId, simulation.date.year, territorialControl);
    const reach = airOperationalReach(transport, operation.targetLocationId, simulation);
    const airFactor = airSituationFactor(war, operation.entityId);
    if (!controller || !enemyIds(war).has(controller) || !reach.reachable || airFactor < .45) {
      changed = true;
      return { ...operation, preparation: 100, status: 'ready' as const, lastProcessedElapsedDay: simulation.elapsedDays };
    }

    const transportQuality = clamp(transportCapacity(transport)) / 100;
    const groundQuality = (unit.organization + unit.morale + unit.supply + unit.commander.skill) / 400;
    const terrain = locationsForYear(simulation.date.year).find((item) => item.id === operation.targetLocationId)?.terrain;
    const terrainPenalty = terrain === 'mountains' ? .16 : terrain === 'forest' ? .09 : terrain === 'desert' ? .06 : 0;
    const successScore = groundQuality * .36 + transportQuality * .28 + reach.factor * .2 + airFactor * .22 - terrainPenalty;
    const roll = deterministic(`${operation.id}:${simulation.elapsedDays}`) * .22;
    const finalScore = successScore + roll;
    const result: AirborneOperationResult = finalScore >= .78 ? 'secure-lodgement' : finalScore >= .61 ? 'dispersed-lodgement' : 'repelled';

    const lossRate = result === 'secure-lodgement' ? .035 : result === 'dispersed-lodgement' ? .085 : .14;
    const organizationLoss = result === 'secure-lodgement' ? 16 : result === 'dispersed-lodgement' ? 29 : 38;
    units = units.map((item) => item.id !== unit.id ? item : result === 'repelled'
      ? { ...item, personnel: Math.max(250, Math.round(item.personnel * (1 - lossRate))), strength: clamp(item.strength - lossRate * 65), organization: clamp(item.organization - organizationLoss), morale: clamp(item.morale - 14), supply: clamp(item.supply - 10) }
      : { ...item, locationId: operation.targetLocationId, destinationId: undefined, order: 'hold' as const, movementProgress: 0, personnel: Math.max(250, Math.round(item.personnel * (1 - lossRate))), strength: clamp(item.strength - lossRate * 52), organization: clamp(item.organization - organizationLoss), morale: clamp(item.morale - (result === 'secure-lodgement' ? 6 : 11)), supply: clamp(item.supply - (result === 'secure-lodgement' ? 22 : 30)) });

    formations = formations.map((item) => item.id !== transport.id ? item : { ...item, readiness: clamp(item.readiness - 14), supply: clamp(item.supply - 18), experience: clamp(item.experience + 2.5) });

    if (result !== 'repelled') {
      wars = wars.map((item) => {
        if (item.id !== war.id) return item;
        const existing = item.fronts.find((front) => front.locationId === operation.targetLocationId);
        if (existing) return { ...item, fronts: item.fronts.map((front) => front.id !== existing.id ? front : { ...front, attackerPriority: 'high' as const, attackerAssignments: [...new Set([...front.attackerAssignments, unit.id])] }) };
        return { ...item, fronts: [...item.fronts, airborneFront(operation.targetLocationId, unit, item.fronts.length)] };
      });
    }
    changed = true;
    return {
      ...operation,
      preparation: 100,
      status: result === 'repelled' ? 'failed' as const : 'established' as const,
      result,
      isolation: result === 'secure-lodgement' ? 48 : result === 'dispersed-lodgement' ? 68 : 100,
      lastProcessedElapsedDay: simulation.elapsedDays,
    };
  });

  if (changed) {
    publish({ operations });
    publishCampaign({ ...campaign, formations });
  }
  return { armyState: { ...armyState, units }, warState: { ...warState, wars }, changed };
}

export function airborneOperationsForEntity(entityId: string) {
  return rootState().operations.filter((operation) => operation.entityId === entityId).map((operation) => ({ ...operation }));
}
