import { locationsForYear } from '../data/territories';
import type { AirBaseNetworkState, AirBaseNode } from './airBaseNetwork';
import type { AirCampaignState } from './airCampaign';
import type { SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';

export type AirfieldProjectType = 'forward-base' | 'expand' | 'repair';
export type AirfieldProjectStatus = 'building' | 'completed' | 'cancelled';

export type AirfieldProject = {
  id: string;
  entityId: string;
  locationId: string;
  type: AirfieldProjectType;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  status: AirfieldProjectStatus;
};

export type AirfieldCaptureRecord = {
  id: string;
  locationId: string;
  fromEntityId: string;
  toEntityId: string;
  occurredAtElapsedDay: number;
};

export type AirfieldInfrastructureState = {
  projects: AirfieldProject[];
  captures: AirfieldCaptureRecord[];
  controlOverrides: Record<string, string>;
  abandonedKeys: Record<string, true>;
};

type Root = typeof globalThis & {
  __WORLD_STATE_AIRFIELD_INFRASTRUCTURE__?: AirfieldInfrastructureState;
  __WORLD_STATE_AIR_BASE_NETWORK__?: AirBaseNetworkState;
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirfieldInfrastructureState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_AIRFIELD_INFRASTRUCTURE__) {
    root.__WORLD_STATE_AIRFIELD_INFRASTRUCTURE__ = { projects: [], captures: [], controlOverrides: {}, abandonedKeys: {} };
  }
  return root.__WORLD_STATE_AIRFIELD_INFRASTRUCTURE__;
}
function publish(state: AirfieldInfrastructureState) {
  (globalThis as Root).__WORLD_STATE_AIRFIELD_INFRASTRUCTURE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-airfield-infrastructure', { detail: state }));
}
function publishNetwork(state: AirBaseNetworkState) {
  (globalThis as Root).__WORLD_STATE_AIR_BASE_NETWORK__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-base-network', { detail: state }));
}
function publishCampaign(state: AirCampaignState) {
  (globalThis as Root).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}

export function resetAirfieldInfrastructure() {
  publish({ projects: [], captures: [], controlOverrides: {}, abandonedKeys: {} });
}
export function airfieldInfrastructureState() {
  const state = rootState();
  return {
    projects: state.projects.map((item) => ({ ...item })),
    captures: state.captures.map((item) => ({ ...item })),
    controlOverrides: { ...state.controlOverrides },
    abandonedKeys: { ...state.abandonedKeys },
  };
}

export function effectiveLocationController(locationId: string, simulation: SimulationState, territorialControl: TerritorialControlState) {
  const state = rootState();
  const override = state.controlOverrides[locationId];
  if (override) return override;
  const occupation = territorialControl.occupations[locationId];
  if (occupation?.controllerId && occupation.progress >= 100) return occupation.controllerId;
  return locationsForYear(simulation.date.year).find((item) => item.id === locationId)?.controllerId ?? null;
}

function projectDuration(type: AirfieldProjectType, year: number) {
  const base = type === 'forward-base' ? 150 : type === 'expand' ? 220 : 90;
  const era = year < 1903 ? 1.8 : year < 1918 ? 1.45 : year < 1945 ? 1.15 : year < 1980 ? .92 : .72;
  return Math.max(45, Math.round(base * era));
}

function newForwardBase(entityId: string, locationId: string, simulation: SimulationState): AirBaseNode {
  const runtime = simulation.entities[entityId];
  const year = simulation.date.year;
  const era = year < 1903 ? .34 : year < 1918 ? .55 : year < 1945 ? .78 : 1;
  const tech = runtime?.technology ?? 35;
  const infrastructure = clamp((34 + tech * .28) * era, 16, 74);
  const capacity = clamp((7 + tech * .13) * era, 3, 24);
  return {
    id: `${entityId}:${locationId}`,
    entityId,
    locationId,
    capacity,
    fuel: clamp(32 + infrastructure * .4),
    infrastructure,
    runwayCondition: 72,
    maintenanceSupport: clamp(30 + infrastructure * .45),
    basedFormationIds: [],
    condition: 'strained',
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}

export function startAirfieldProject(
  entityId: string,
  locationId: string,
  type: AirfieldProjectType,
  simulation: SimulationState,
  territorialControl: TerritorialControlState,
) {
  if (simulation.date.year < 1794) return { error: 'A época ainda não permite infraestrutura aérea militar institucionalizada.' };
  const controller = effectiveLocationController(locationId, simulation, territorialControl);
  if (controller !== entityId) return { error: 'A localização não está sob seu controle efetivo.' };
  const root = globalThis as Root;
  const network = root.__WORLD_STATE_AIR_BASE_NETWORK__;
  if (!network) return { error: 'A rede de bases aéreas ainda não foi inicializada.' };
  const state = rootState();
  const key = `${entityId}:${locationId}`;
  const base = network.bases[key];
  if (type === 'forward-base' && base) return { error: 'Já existe infraestrutura aérea nessa localização.' };
  if (type !== 'forward-base' && !base) return { error: 'É necessário possuir uma base antes de ampliar ou reparar.' };
  if (state.projects.some((item) => item.locationId === locationId && item.status === 'building')) return { error: 'Já existe uma obra aérea em andamento nessa localização.' };
  if (type === 'repair' && base && base.runwayCondition >= 92) return { error: 'A pista já está em boas condições.' };

  const project: AirfieldProject = {
    id: `airfield-${type}-${entityId}-${locationId}-${simulation.elapsedDays}`,
    entityId,
    locationId,
    type,
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + projectDuration(type, simulation.date.year),
    status: 'building',
  };
  const abandonedKeys = { ...state.abandonedKeys };
  delete abandonedKeys[key];
  publish({ ...state, abandonedKeys, projects: [project, ...state.projects].slice(0, 120) });
  return { project };
}

function relocateDisplacedFormations(lostEntityId: string, lostLocationId: string, network: AirBaseNetworkState, campaign?: AirCampaignState) {
  if (!campaign) return campaign;
  const fallback = Object.values(network.bases).find((base) => base.entityId === lostEntityId && base.locationId !== lostLocationId && base.condition !== 'critical');
  return {
    ...campaign,
    formations: campaign.formations.map((formation) => {
      if (formation.entityId !== lostEntityId || formation.baseLocationId !== lostLocationId) return formation;
      return {
        ...formation,
        baseLocationId: fallback?.locationId ?? formation.baseLocationId,
        mission: 'reserve' as const,
        readiness: clamp(formation.readiness - (fallback ? 12 : 22)),
        supply: clamp(formation.supply - (fallback ? 8 : 18)),
      };
    }),
  };
}

export function processAirfieldInfrastructure(simulation: SimulationState, territorialControl: TerritorialControlState) {
  const root = globalThis as Root;
  const network = root.__WORLD_STATE_AIR_BASE_NETWORK__;
  if (!network) return { changed: false };
  const state = rootState();
  let projects = state.projects.map((item) => ({ ...item }));
  let captures = [...state.captures];
  let controlOverrides = { ...state.controlOverrides };
  const abandonedKeys = { ...state.abandonedKeys };
  let bases = Object.fromEntries(Object.entries(network.bases).map(([key, base]) => [key, { ...base, basedFormationIds: [...base.basedFormationIds] }]));
  let campaign = root.__WORLD_STATE_AIR_CAMPAIGN__;
  let changed = false;

  for (const occupation of Object.values(territorialControl.occupations)) {
    if (occupation.progress < 100 || !occupation.controllerId) continue;
    const oldEntries = Object.entries(bases).filter(([, base]) => base.locationId === occupation.locationId && base.entityId !== occupation.controllerId);
    for (const [oldKey, oldBase] of oldEntries) {
      const newKey = `${occupation.controllerId}:${occupation.locationId}`;
      const capturedBase: AirBaseNode = {
        ...oldBase,
        id: newKey,
        entityId: occupation.controllerId,
        capacity: clamp(oldBase.capacity * .82, 2, 100),
        fuel: clamp(oldBase.fuel * .35),
        infrastructure: clamp(oldBase.infrastructure * .82),
        runwayCondition: clamp(Math.min(oldBase.runwayCondition, 52)),
        maintenanceSupport: clamp(oldBase.maintenanceSupport * .7),
        basedFormationIds: [],
        condition: 'damaged',
        lastProcessedElapsedDay: simulation.elapsedDays,
      };
      campaign = relocateDisplacedFormations(oldBase.entityId, oldBase.locationId, { ...network, bases }, campaign);
      delete bases[oldKey];
      delete abandonedKeys[newKey];
      bases[newKey] = capturedBase;
      controlOverrides[occupation.locationId] = occupation.controllerId;
      captures = [{
        id: `airfield-capture-${occupation.locationId}-${occupation.controllerId}-${simulation.elapsedDays}`,
        locationId: occupation.locationId,
        fromEntityId: oldBase.entityId,
        toEntityId: occupation.controllerId,
        occurredAtElapsedDay: simulation.elapsedDays,
      }, ...captures].slice(0, 80);
      changed = true;
    }
  }

  projects = projects.map((project) => {
    if (project.status !== 'building' || simulation.elapsedDays < project.completesAtElapsedDay) return project;
    const controller = effectiveLocationController(project.locationId, simulation, territorialControl);
    if (controller !== project.entityId) {
      changed = true;
      return { ...project, status: 'cancelled' as const };
    }
    const key = `${project.entityId}:${project.locationId}`;
    const base = bases[key];
    if (project.type === 'forward-base') {
      if (!base) bases[key] = newForwardBase(project.entityId, project.locationId, simulation);
    } else if (base && project.type === 'expand') {
      bases[key] = {
        ...base,
        capacity: clamp(base.capacity + 7, 0, 100),
        infrastructure: clamp(base.infrastructure + 9),
        maintenanceSupport: clamp(base.maintenanceSupport + 7),
        fuel: clamp(base.fuel + 12),
      };
    } else if (base && project.type === 'repair') {
      bases[key] = {
        ...base,
        runwayCondition: clamp(base.runwayCondition + 38),
        infrastructure: clamp(base.infrastructure + 4),
        fuel: clamp(base.fuel + 8),
        condition: base.runwayCondition + 38 >= 60 ? 'operational' : 'strained',
      };
    }
    delete abandonedKeys[key];
    changed = true;
    return { ...project, status: 'completed' as const };
  });

  if (changed) {
    publishNetwork({ ...network, bases });
    if (campaign) publishCampaign(campaign);
    publish({ projects, captures, controlOverrides, abandonedKeys });
  }
  return { changed };
}

export function abandonAirfield(entityId: string, locationId: string, simulation: SimulationState) {
  const root = globalThis as Root;
  const network = root.__WORLD_STATE_AIR_BASE_NETWORK__;
  if (!network) return { error: 'Rede aérea indisponível.' };
  const key = `${entityId}:${locationId}`;
  const base = network.bases[key];
  if (!base) return { error: 'Base aérea não encontrada.' };
  let campaign = root.__WORLD_STATE_AIR_CAMPAIGN__;
  campaign = relocateDisplacedFormations(entityId, locationId, network, campaign);
  const bases = { ...network.bases };
  delete bases[key];
  const state = rootState();
  publishNetwork({ ...network, bases });
  if (campaign) publishCampaign(campaign);
  publish({ ...state, abandonedKeys: { ...state.abandonedKeys, [key]: true } });
  return { success: true, at: simulation.elapsedDays };
}
