import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import { airCampaignState, type AirCampaignState, type AirFormation } from './airCampaign';
import { airIndustrialSupport } from './airIndustry';
import type { SimulationState } from './simulation';

export type AirBaseCondition = 'operational' | 'strained' | 'overloaded' | 'damaged' | 'critical';

export type AirBaseNode = {
  id: string;
  entityId: string;
  locationId: string;
  capacity: number;
  fuel: number;
  infrastructure: number;
  runwayCondition: number;
  maintenanceSupport: number;
  basedFormationIds: string[];
  condition: AirBaseCondition;
  lastProcessedElapsedDay: number;
};

export type AirTransfer = {
  id: string;
  formationId: string;
  entityId: string;
  fromLocationId: string;
  toLocationId: string;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  status: 'moving' | 'completed' | 'cancelled';
};

export type AirBaseNetworkState = {
  bases: Record<string, AirBaseNode>;
  transfers: AirTransfer[];
};

type Root = typeof globalThis & {
  __WORLD_STATE_AIR_BASE_NETWORK__?: AirBaseNetworkState;
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
  __WORLD_STATE_AIR_WARFARE__?: { bases?: Record<string, { damage: number }> };
  __WORLD_STATE_AIRFIELD_INFRASTRUCTURE__?: {
    controlOverrides?: Record<string, string>;
    abandonedKeys?: Record<string, true>;
  };
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirBaseNetworkState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_AIR_BASE_NETWORK__) root.__WORLD_STATE_AIR_BASE_NETWORK__ = { bases: {}, transfers: [] };
  return root.__WORLD_STATE_AIR_BASE_NETWORK__;
}
function publish(state: AirBaseNetworkState) {
  (globalThis as Root).__WORLD_STATE_AIR_BASE_NETWORK__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-base-network', { detail: state }));
}
function publishCampaign(state: AirCampaignState) {
  (globalThis as Root).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}
export function resetAirBaseNetwork() { publish({ bases: {}, transfers: [] }); }
export function airBaseNetworkState() {
  const state = rootState();
  return {
    bases: Object.fromEntries(Object.entries(state.bases).map(([id, base]) => [id, { ...base, basedFormationIds: [...base.basedFormationIds] }])),
    transfers: state.transfers.map((item) => ({ ...item })),
  };
}

function haversineKm(a: ResolvedLocation, b: ResolvedLocation) {
  const r = 6371;
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(q)));
}

function baseCandidate(location: ResolvedLocation, year: number) {
  if (year < 1903) return location.kind === 'capital' || location.kind === 'city';
  return location.kind === 'capital' || location.kind === 'city' || location.kind === 'port';
}
function capacityFor(location: ResolvedLocation, simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  const industry = airIndustrialSupport(entityId, simulation);
  const kind = location.kind === 'capital' ? 14 : location.kind === 'city' ? 10 : 8;
  const era = simulation.date.year < 1903 ? .35 : simulation.date.year < 1918 ? .58 : simulation.date.year < 1945 ? .82 : 1;
  return clamp((kind + (runtime?.technology ?? 35) * .18 + industry.maintenance * .12) * era, 4, 38);
}
function infrastructureFor(location: ResolvedLocation, simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  const industry = airIndustrialSupport(entityId, simulation);
  const terrain = location.terrain === 'plains' ? 8 : location.terrain === 'coastal' ? 5 : location.terrain === 'mountains' ? -8 : 0;
  return clamp(35 + (runtime?.technology ?? 35) * .32 + industry.maintenance * .2 + terrain);
}
function conditionFor(base: Pick<AirBaseNode, 'capacity' | 'basedFormationIds' | 'fuel' | 'runwayCondition'>): AirBaseCondition {
  const load = base.basedFormationIds.length / Math.max(1, base.capacity / 8);
  if (base.runwayCondition < 28 || base.fuel < 12) return 'critical';
  if (base.runwayCondition < 48) return 'damaged';
  if (load > 1.25) return 'overloaded';
  if (load > .9 || base.fuel < 35) return 'strained';
  return 'operational';
}

function ensureBases(simulation: SimulationState, formations: AirFormation[], existing: Record<string, AirBaseNode>) {
  const bases = { ...existing };
  const root = globalThis as Root;
  const warfare = root.__WORLD_STATE_AIR_WARFARE__;
  const infrastructure = root.__WORLD_STATE_AIRFIELD_INFRASTRUCTURE__;
  for (const entityId of Object.keys(simulation.entities)) {
    const locations = locationsForEntity(entityId, simulation.date.year).filter((location) => baseCandidate(location, simulation.date.year));
    for (const location of locations) {
      const key = `${entityId}:${location.id}`;
      const controllerOverride = infrastructure?.controlOverrides?.[location.id];
      if (infrastructure?.abandonedKeys?.[key]) continue;
      if (controllerOverride && controllerOverride !== entityId) continue;
      const based = formations.filter((formation) => formation.entityId === entityId && formation.baseLocationId === location.id).map((formation) => formation.id);
      const externalDamage = warfare?.bases?.[key]?.damage ?? 0;
      const previous = bases[key];
      const capacity = capacityFor(location, simulation, entityId);
      const infrastructureValue = infrastructureFor(location, simulation, entityId);
      const runwayCondition = previous ? Math.min(previous.runwayCondition, clamp(100 - externalDamage)) : clamp(100 - externalDamage);
      const node: AirBaseNode = previous
        ? { ...previous, capacity: Math.max(previous.capacity, capacity), infrastructure: Math.max(previous.infrastructure, infrastructureValue), runwayCondition, basedFormationIds: based }
        : {
            id: key,
            entityId,
            locationId: location.id,
            capacity,
            fuel: clamp(45 + infrastructureValue * .45),
            infrastructure: infrastructureValue,
            runwayCondition,
            maintenanceSupport: clamp(infrastructureValue * .62 + airIndustrialSupport(entityId, simulation).maintenance * .38),
            basedFormationIds: based,
            condition: 'operational',
            lastProcessedElapsedDay: simulation.elapsedDays,
          };
      node.condition = conditionFor(node);
      bases[key] = node;
    }
  }
  return bases;
}

export function processAirBaseNetwork(simulation: SimulationState) {
  const state = rootState();
  const campaign = airCampaignState();
  let bases = ensureBases(simulation, campaign.formations, state.bases);
  let transfers = state.transfers.map((item) => ({ ...item }));
  let formations = campaign.formations.map((item) => ({ ...item }));
  let changed = false;

  for (const [key, base] of Object.entries(bases)) {
    const days = Math.max(0, simulation.elapsedDays - base.lastProcessedElapsedDay);
    if (!days) continue;
    const active = formations.filter((formation) => formation.baseLocationId === base.locationId && formation.entityId === base.entityId && formation.mission !== 'reserve').length;
    const load = base.basedFormationIds.length / Math.max(1, base.capacity / 8);
    const industry = airIndustrialSupport(base.entityId, simulation);
    const consumption = days * (active * .055 + Math.max(0, load - .8) * .05);
    const replenishment = days * (base.infrastructure * .0018 + industry.maintenance * .0015);
    const fuel = clamp(base.fuel - consumption + replenishment);
    const runwayRecovery = days * (base.maintenanceSupport / 100) * .018;
    const runwayCondition = clamp(base.runwayCondition + runwayRecovery);
    const next = { ...base, fuel, runwayCondition, maintenanceSupport: clamp(base.infrastructure * .62 + industry.maintenance * .38), lastProcessedElapsedDay: simulation.elapsedDays };
    next.condition = conditionFor(next);
    bases[key] = next;
    changed = true;
  }

  transfers = transfers.map((transfer) => {
    if (transfer.status !== 'moving' || simulation.elapsedDays < transfer.completesAtElapsedDay) return transfer;
    formations = formations.map((formation) => formation.id === transfer.formationId
      ? { ...formation, baseLocationId: transfer.toLocationId, readiness: clamp(formation.readiness - 6), supply: clamp(formation.supply - 4), lastProcessedElapsedDay: simulation.elapsedDays }
      : formation);
    changed = true;
    return { ...transfer, status: 'completed' as const };
  });

  bases = ensureBases(simulation, formations, bases);
  if (changed || Object.keys(bases).length !== Object.keys(state.bases).length) {
    publish({ bases, transfers });
    publishCampaign({ ...campaign, formations });
  }
  return { changed };
}

export function airBasesForEntity(entityId: string, simulation: SimulationState) {
  const campaign = airCampaignState();
  const bases = ensureBases(simulation, campaign.formations, rootState().bases);
  return Object.values(bases).filter((base) => base.entityId === entityId).map((base) => ({ ...base, basedFormationIds: [...base.basedFormationIds] }));
}

export function startAirTransfer(formationId: string, targetLocationId: string, simulation: SimulationState) {
  processAirBaseNetwork(simulation);
  const state = rootState();
  const campaign = airCampaignState();
  const formation = campaign.formations.find((item) => item.id === formationId);
  if (!formation) return { error: 'Formação aérea não encontrada.' };
  if (state.transfers.some((item) => item.formationId === formationId && item.status === 'moving')) return { error: 'A formação já está em transferência.' };
  const target = state.bases[`${formation.entityId}:${targetLocationId}`];
  if (!target) return { error: 'Base de destino indisponível.' };
  if (target.condition === 'critical') return { error: 'A base de destino está em condição crítica.' };
  const sourceLocation = locationsForYear(simulation.date.year).find((location) => location.id === formation.baseLocationId);
  const targetLocation = locationsForYear(simulation.date.year).find((location) => location.id === targetLocationId);
  if (!sourceLocation || !targetLocation) return { error: 'Não foi possível calcular a transferência.' };
  const distance = haversineKm(sourceLocation, targetLocation);
  const eraSpeed = simulation.date.year < 1914 ? 180 : simulation.date.year < 1945 ? 420 : 780;
  const days = Math.max(2, Math.ceil(distance / eraSpeed));
  const transfer: AirTransfer = {
    id: `air-transfer-${formationId}-${simulation.elapsedDays}`,
    formationId,
    entityId: formation.entityId,
    fromLocationId: formation.baseLocationId,
    toLocationId: targetLocationId,
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + days,
    status: 'moving',
  };
  publish({ ...state, transfers: [transfer, ...state.transfers].slice(0, 100) });
  return { transfer };
}

export function airRangeKm(formation: AirFormation, simulation: SimulationState) {
  const year = simulation.date.year;
  const base = year < 1903 ? 45 : year < 1914 ? 180 : year < 1945 ? 850 : year < 1980 ? 1800 : 3200;
  return Math.max(25, base * (.45 + formation.range / 100));
}

export function airOperationalReach(formation: AirFormation, targetLocationId: string, simulation: SimulationState) {
  processAirBaseNetwork(simulation);
  const state = rootState();
  const source = locationsForYear(simulation.date.year).find((location) => location.id === formation.baseLocationId);
  const target = locationsForYear(simulation.date.year).find((location) => location.id === targetLocationId);
  const base = state.bases[`${formation.entityId}:${formation.baseLocationId}`];
  if (!source || !target || !base) return { reachable: false, factor: 0, distanceKm: 0, rangeKm: airRangeKm(formation, simulation), baseCondition: 'critical' as AirBaseCondition };
  const distanceKm = haversineKm(source, target);
  const rangeKm = airRangeKm(formation, simulation);
  const distanceRatio = distanceKm / Math.max(1, rangeKm);
  const conditionFactor = base.condition === 'operational' ? 1 : base.condition === 'strained' ? .88 : base.condition === 'overloaded' ? .78 : base.condition === 'damaged' ? .66 : .42;
  const fuelFactor = .55 + base.fuel / 220;
  const rangeFactor = distanceRatio <= .55 ? 1 : distanceRatio <= .8 ? .9 : distanceRatio <= 1 ? .72 : 0;
  return {
    reachable: distanceRatio <= 1 && base.fuel > 8 && base.runwayCondition > 20,
    factor: clamp(conditionFactor * fuelFactor * rangeFactor, 0, 1.1),
    distanceKm,
    rangeKm,
    baseCondition: base.condition,
  };
}
