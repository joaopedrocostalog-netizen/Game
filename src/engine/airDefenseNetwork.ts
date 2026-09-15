import { locationsForYear } from '../data/territories';
import { airCampaignState } from './airCampaign';
import { airDoctrineSupport } from './airDoctrine';
import type { SimulationState } from './simulation';
import type { WarState } from './war';

export type AirDefensePosture = 'balanced' | 'early-warning' | 'base-defense' | 'dispersed';
export type AirDefenseNetworkCondition = 'limited' | 'developing' | 'effective' | 'integrated';

export type AirDefenseNode = {
  id: string;
  entityId: string;
  locationId: string;
  sensorStrength: number;
  interceptionSupport: number;
  groundDefense: number;
  electronicSupport: number;
  coverageKm: number;
  readiness: number;
  lastProcessedElapsedDay: number;
};

export type AirDefenseNetworkState = {
  nodes: Record<string, AirDefenseNode>;
  postureByEntity: Record<string, AirDefensePosture>;
};

type BaseNetworkSnapshot = {
  bases?: Record<string, {
    entityId: string;
    locationId: string;
    infrastructure: number;
    runwayCondition: number;
    maintenanceSupport: number;
    fuel: number;
    condition: string;
  }>;
};

type Root = typeof globalThis & {
  __WORLD_STATE_AIR_DEFENSE_NETWORK__?: AirDefenseNetworkState;
  __WORLD_STATE_AIR_BASE_NETWORK__?: BaseNetworkSnapshot;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirDefenseNetworkState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_AIR_DEFENSE_NETWORK__) root.__WORLD_STATE_AIR_DEFENSE_NETWORK__ = { nodes: {}, postureByEntity: {} };
  return root.__WORLD_STATE_AIR_DEFENSE_NETWORK__;
}
function publish(state: AirDefenseNetworkState) {
  (globalThis as Root).__WORLD_STATE_AIR_DEFENSE_NETWORK__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-defense-network', { detail: state }));
}
export function resetAirDefenseNetwork() { publish({ nodes: {}, postureByEntity: {} }); }
export function airDefenseNetworkState() {
  const state = rootState();
  return {
    nodes: Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => [id, { ...node }])),
    postureByEntity: { ...state.postureByEntity },
  };
}

export function airDefenseEraAvailable(year: number) { return year >= 1914; }
export function airDefenseEraLabel(year: number) {
  if (year < 1914) return 'Sem rede organizada de alerta aéreo';
  if (year < 1935) return 'Observação visual e alerta local';
  if (year < 1945) return 'Radar inicial e controle de interceptação';
  if (year < 1980) return 'Defesa aérea integrada';
  return 'Rede de sensores e defesa aérea integrada';
}
export function electronicWarfareAvailable(year: number) { return year >= 1940; }
export function electronicWarfareLabel(year: number) {
  if (year < 1940) return 'Indisponível nesta época';
  if (year < 1960) return 'Contramedidas e interferência eletrônica inicial';
  if (year < 1990) return 'Guerra eletrônica operacional';
  return 'Guerra eletrônica integrada';
}

function eraFactors(year: number) {
  if (year < 1914) return { sensor: 0, defense: .12, ew: 0, range: 0 };
  if (year < 1935) return { sensor: .28, defense: .42, ew: 0, range: .2 };
  if (year < 1945) return { sensor: .62, defense: .68, ew: .28, range: .48 };
  if (year < 1980) return { sensor: .82, defense: .84, ew: .66, range: .72 };
  return { sensor: 1, defense: 1, ew: 1, range: 1 };
}
function posture(entityId: string) { return rootState().postureByEntity[entityId] ?? 'balanced'; }
function postureSensorFactor(value: AirDefensePosture) {
  if (value === 'early-warning') return 1.16;
  if (value === 'base-defense') return .9;
  if (value === 'dispersed') return .96;
  return 1;
}
function postureDefenseFactor(value: AirDefensePosture) {
  if (value === 'base-defense') return 1.18;
  if (value === 'early-warning') return .92;
  if (value === 'dispersed') return 1.02;
  return 1;
}
function postureEwFactor(value: AirDefensePosture) {
  if (value === 'dispersed') return 1.12;
  if (value === 'early-warning') return 1.05;
  return 1;
}
function nodeConditionFactor(condition?: string) {
  if (condition === 'critical') return .38;
  if (condition === 'damaged') return .58;
  if (condition === 'overloaded') return .76;
  if (condition === 'strained') return .86;
  return 1;
}

function ensureNodes(simulation: SimulationState, existing: Record<string, AirDefenseNode>) {
  if (!airDefenseEraAvailable(simulation.date.year)) return {};
  const bases = (globalThis as Root).__WORLD_STATE_AIR_BASE_NETWORK__?.bases ?? {};
  const campaign = airCampaignState();
  const candidateKeys = new Set<string>(Object.keys(bases));
  for (const formation of campaign.formations) candidateKeys.add(`${formation.entityId}:${formation.baseLocationId}`);
  const nodes: Record<string, AirDefenseNode> = {};
  const era = eraFactors(simulation.date.year);
  const locations = new Map(locationsForYear(simulation.date.year).map((location) => [location.id, location]));

  for (const key of candidateKeys) {
    const base = bases[key];
    const [fallbackEntityId, fallbackLocationId] = key.split(':');
    const entityId = base?.entityId ?? fallbackEntityId;
    const locationId = base?.locationId ?? fallbackLocationId;
    const runtime = simulation.entities[entityId];
    const location = locations.get(locationId);
    if (!runtime || !location) continue;
    const doctrine = airDoctrineSupport(entityId, simulation);
    const previous = existing[key];
    const networkPosture = posture(entityId);
    const infrastructure = base?.infrastructure ?? 42;
    const maintenance = base?.maintenanceSupport ?? 42;
    const runway = base?.runwayCondition ?? 80;
    const condition = nodeConditionFactor(base?.condition);
    const terrainSensor = location.terrain === 'mountains' ? .92 : location.terrain === 'plains' || location.terrain === 'coastal' ? 1.06 : 1;
    const doctrineDefense = doctrine.school === 'air-defense' ? 1.12 : doctrine.school === 'air-superiority' ? 1.05 : 1;
    const sensorStrength = clamp((runtime.technology * .52 + infrastructure * .3 + runtime.militaryReadiness * .18) * era.sensor * terrainSensor * postureSensorFactor(networkPosture) * condition);
    const interceptionSupport = clamp((sensorStrength * .55 + doctrine.mastery * .26 + doctrine.combatCoordination * .19) * condition);
    const groundDefense = clamp((runtime.technology * .4 + runtime.militaryReadiness * .34 + infrastructure * .16 + maintenance * .1) * era.defense * doctrineDefense * postureDefenseFactor(networkPosture) * condition);
    const electronicSupport = electronicWarfareAvailable(simulation.date.year)
      ? clamp((runtime.technology * .56 + doctrine.flexibility * .22 + doctrine.combatCoordination * .22) * era.ew * postureEwFactor(networkPosture) * condition)
      : 0;
    const coverageKm = Math.round((45 + runtime.technology * 8.5 + infrastructure * 3.2) * era.range * postureSensorFactor(networkPosture));
    const recovery = previous ? Math.max(0, simulation.elapsedDays - previous.lastProcessedElapsedDay) * maintenance * .00035 : 0;
    const readiness = clamp((previous?.readiness ?? Math.min(88, 46 + maintenance * .36 + runway * .12)) + recovery);
    nodes[key] = {
      id: key,
      entityId,
      locationId,
      sensorStrength,
      interceptionSupport,
      groundDefense,
      electronicSupport,
      coverageKm,
      readiness,
      lastProcessedElapsedDay: simulation.elapsedDays,
    };
  }
  return nodes;
}

export function processAirDefenseNetwork(simulation: SimulationState, warState?: WarState) {
  const state = rootState();
  let nodes = ensureNodes(simulation, state.nodes);
  let changed = Object.keys(nodes).length !== Object.keys(state.nodes).length;
  if (warState) {
    const atWar = new Set<string>();
    for (const war of warState.wars) if (war.status === 'active') [...war.attackers, ...war.defenders].forEach((id) => atWar.add(id));
    nodes = Object.fromEntries(Object.entries(nodes).map(([id, node]) => {
      if (!atWar.has(node.entityId)) return [id, node];
      const days = Math.max(0, simulation.elapsedDays - (state.nodes[id]?.lastProcessedElapsedDay ?? simulation.elapsedDays));
      if (!days) return [id, node];
      changed = true;
      return [id, { ...node, readiness: clamp(node.readiness - days * .012), lastProcessedElapsedDay: simulation.elapsedDays }];
    }));
  }
  if (changed || Object.keys(nodes).some((id) => JSON.stringify(nodes[id]) !== JSON.stringify(state.nodes[id]))) publish({ ...state, nodes });
  return { changed };
}

export function setAirDefensePosture(entityId: string, next: AirDefensePosture) {
  const state = rootState();
  publish({ ...state, postureByEntity: { ...state.postureByEntity, [entityId]: next } });
}

export function airDefenseNodesForEntity(entityId: string, simulation: SimulationState) {
  const nodes = ensureNodes(simulation, rootState().nodes);
  return Object.values(nodes).filter((node) => node.entityId === entityId).map((node) => ({ ...node }));
}

function averageForEntity(entityId: string, simulation: SimulationState, field: keyof Pick<AirDefenseNode, 'sensorStrength' | 'interceptionSupport' | 'groundDefense' | 'electronicSupport' | 'readiness'>) {
  const nodes = airDefenseNodesForEntity(entityId, simulation);
  if (!nodes.length) return 0;
  return nodes.reduce((sum, node) => sum + Number(node[field]), 0) / nodes.length;
}

export function airDefenseSupport(entityId: string, simulation: SimulationState) {
  const sensor = averageForEntity(entityId, simulation, 'sensorStrength');
  const interception = averageForEntity(entityId, simulation, 'interceptionSupport');
  const defense = averageForEntity(entityId, simulation, 'groundDefense');
  const ew = averageForEntity(entityId, simulation, 'electronicSupport');
  const readiness = averageForEntity(entityId, simulation, 'readiness');
  return { sensor, interception, defense, electronicWarfare: ew, readiness, posture: posture(entityId) };
}

export function airDetectionCombatModifier(observerId: string, opponentId: string, simulation: SimulationState) {
  const observer = airDefenseSupport(observerId, simulation);
  const opponent = airDefenseSupport(opponentId, simulation);
  const detection = observer.sensor * .52 + observer.interception * .28 + observer.readiness * .2;
  const interference = electronicWarfareAvailable(simulation.date.year) ? opponent.electronicWarfare * .38 : 0;
  return clamp(82 + (detection - interference) * .22, 62, 118) / 100;
}

export function airBaseDefenseModifier(defenderId: string, attackerId: string, simulation: SimulationState) {
  const defender = airDefenseSupport(defenderId, simulation);
  const attacker = airDefenseSupport(attackerId, simulation);
  const electronicPenalty = electronicWarfareAvailable(simulation.date.year) ? attacker.electronicWarfare * .24 : 0;
  return clamp(defender.defense + defender.interception * .32 - electronicPenalty, 0, 100);
}

export function airDefenseNetworkCondition(entityId: string, simulation: SimulationState): AirDefenseNetworkCondition {
  const support = airDefenseSupport(entityId, simulation);
  const score = support.sensor * .32 + support.interception * .24 + support.defense * .24 + support.electronicWarfare * .1 + support.readiness * .1;
  if (score < 24) return 'limited';
  if (score < 48) return 'developing';
  if (score < 72) return 'effective';
  return 'integrated';
}

export function estimatedEnemyAirPicture(observerId: string, enemyId: string, simulation: SimulationState) {
  const own = airDefenseSupport(observerId, simulation);
  const enemy = airDefenseSupport(enemyId, simulation);
  const confidence = clamp(18 + own.sensor * .55 + own.electronicWarfare * .18 - enemy.electronicWarfare * .22);
  const signal = enemy.sensor * .28 + enemy.defense * .3 + enemy.electronicWarfare * .22 + enemy.interception * .2;
  const uncertainty = (100 - confidence) * .35;
  return {
    confidence,
    lowerBound: clamp(signal - uncertainty),
    upperBound: clamp(signal + uncertainty),
  };
}
