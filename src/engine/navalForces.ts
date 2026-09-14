import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { SimulationState } from './simulation';
import { militaryIndustryFor } from './militaryIndustry';
import type { WarState } from './war';

export type SeaZoneId = 'north-atlantic' | 'south-atlantic' | 'mediterranean' | 'baltic' | 'indian-ocean' | 'west-pacific' | 'east-pacific';
export type NavalMission = 'harbor' | 'sea-control' | 'escort' | 'transport' | 'reserve';

export type NavalFleet = {
  id: string;
  entityId: string;
  name: string;
  homePortId: string;
  zoneId: SeaZoneId;
  mission: NavalMission;
  vessels: number;
  power: number;
  readiness: number;
  supply: number;
  range: number;
  transportCapacity: number;
  lastProcessedElapsedDay: number;
};

export type MaritimeZoneControl = {
  zoneId: SeaZoneId;
  controllerId?: string;
  leadingPower: number;
  contested: boolean;
  powers: Record<string, number>;
};

export type NavalState = {
  fleets: NavalFleet[];
  zones: MaritimeZoneControl[];
};

type NavalGlobal = typeof globalThis & { __WORLD_STATE_NAVAL_FORCES__?: NavalState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): NavalState {
  const root = globalThis as NavalGlobal;
  if (!root.__WORLD_STATE_NAVAL_FORCES__) root.__WORLD_STATE_NAVAL_FORCES__ = { fleets: [], zones: [] };
  return root.__WORLD_STATE_NAVAL_FORCES__;
}

function publish(state: NavalState) {
  (globalThis as NavalGlobal).__WORLD_STATE_NAVAL_FORCES__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-naval-forces', { detail: state }));
}

export function resetNavalForces() {
  publish({ fleets: [], zones: [] });
}

export function navalState() {
  const state = rootState();
  return { fleets: state.fleets.map((fleet) => ({ ...fleet })), zones: state.zones.map((zone) => ({ ...zone, powers: { ...zone.powers } })) };
}

export function seaZoneForLocation(location: Pick<ResolvedLocation, 'lat' | 'lon'>): SeaZoneId {
  if (location.lon >= -6 && location.lon <= 42 && location.lat >= 28 && location.lat <= 48) return 'mediterranean';
  if (location.lon >= 8 && location.lon <= 32 && location.lat >= 53) return 'baltic';
  if (location.lon >= 42 && location.lon <= 120 && location.lat < 30 && location.lat > -45) return 'indian-ocean';
  if (location.lon >= 105 && location.lon <= 180) return 'west-pacific';
  if (location.lon <= -70 && location.lat < 15) return 'east-pacific';
  if (location.lon < -10 && location.lat < 12) return 'south-atlantic';
  return 'north-atlantic';
}

export function seaZoneLabel(zone: SeaZoneId) {
  const labels: Record<SeaZoneId, string> = {
    'north-atlantic': 'Atlântico Norte',
    'south-atlantic': 'Atlântico Sul',
    mediterranean: 'Mediterrâneo',
    baltic: 'Báltico',
    'indian-ocean': 'Oceano Índico',
    'west-pacific': 'Pacífico Ocidental',
    'east-pacific': 'Pacífico Oriental',
  };
  return labels[zone];
}

export function navalMissionLabel(mission: NavalMission, year: number) {
  if (mission === 'harbor') return year < 1850 ? 'Em porto' : 'Atracada';
  if (mission === 'sea-control') return year < 1850 ? 'Patrulha e domínio marítimo' : 'Controle marítimo';
  if (mission === 'escort') return year < 1850 ? 'Proteção de comboios mercantes' : 'Escolta de comboios';
  if (mission === 'transport') return year < 1850 ? 'Transporte de tropas e provisões' : 'Transporte estratégico';
  return year < 1850 ? 'Esquadra de reserva' : 'Reserva naval';
}

function fleetName(year: number, index: number) {
  if (year < 1700) return index ? `Esquadra de Reserva ${index + 1}` : 'Esquadra Principal';
  if (year < 1900) return index ? `Esquadra Naval ${index + 1}` : 'Frota Principal';
  if (year < 1945) return index ? `Força Naval ${index + 1}` : 'Frota de Batalha';
  return index ? `Grupo Naval ${index + 1}` : 'Grupo-Tarefa Principal';
}

function coastalLocations(entityId: string, year: number) {
  return locationsForEntity(entityId, year).filter((location) => location.kind === 'port' || location.terrain === 'coastal');
}

function initialFleet(entityId: string, port: ResolvedLocation, index: number, simulation: SimulationState): NavalFleet {
  const runtime = simulation.entities[entityId];
  const industry = militaryIndustryFor(entityId, simulation);
  const navalBase = clamp(industry.navalCapacity * .48 + (runtime?.militaryReadiness ?? 35) * .24 + (runtime?.technology ?? 35) * .28);
  const eraScale = simulation.date.year < 1700 ? .62 : simulation.date.year < 1850 ? .78 : simulation.date.year < 1945 ? 1 : 1.08;
  const vessels = Math.max(3, Math.round((4 + navalBase / 7) * eraScale / Math.max(1, index + .7)));
  return {
    id: `fleet-${entityId}-${index + 1}`,
    entityId,
    name: fleetName(simulation.date.year, index),
    homePortId: port.id,
    zoneId: seaZoneForLocation(port),
    mission: index === 0 ? 'sea-control' : 'reserve',
    vessels,
    power: clamp(navalBase * (index === 0 ? 1 : .72)),
    readiness: clamp(58 + navalBase * .32),
    supply: clamp(62 + industry.supplyCapacity * .28),
    range: clamp(36 + (runtime?.technology ?? 35) * .56 + industry.supplyCapacity * .18),
    transportCapacity: clamp(18 + industry.navalCapacity * .34 + (runtime?.technology ?? 35) * .12),
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}

function ensureEntityFleets(state: NavalState, entityId: string, simulation: SimulationState) {
  if (state.fleets.some((fleet) => fleet.entityId === entityId)) return state;
  const ports = coastalLocations(entityId, simulation.date.year);
  if (!ports.length) return state;
  const industry = militaryIndustryFor(entityId, simulation);
  const count = industry.navalCapacity >= 68 && ports.length >= 2 ? 2 : 1;
  return { ...state, fleets: [...state.fleets, ...Array.from({ length: count }, (_, index) => initialFleet(entityId, ports[index % ports.length], index, simulation))] };
}

function warEnemySet(entityId: string, warState: WarState) {
  const enemies = new Set<string>();
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    if (war.attackers.includes(entityId)) war.defenders.forEach((id) => enemies.add(id));
    if (war.defenders.includes(entityId)) war.attackers.forEach((id) => enemies.add(id));
  }
  return enemies;
}

function missionPower(fleet: NavalFleet) {
  if (fleet.mission === 'harbor') return 0;
  if (fleet.mission === 'reserve') return fleet.power * .24;
  if (fleet.mission === 'transport') return fleet.power * .38;
  if (fleet.mission === 'escort') return fleet.power * .72;
  return fleet.power;
}

function rebuildZoneControl(fleets: NavalFleet[]): MaritimeZoneControl[] {
  const zones = new Map<SeaZoneId, Record<string, number>>();
  for (const fleet of fleets) {
    const contribution = missionPower(fleet) * (fleet.readiness / 100) * (fleet.supply / 100);
    if (contribution <= 0) continue;
    const powers = zones.get(fleet.zoneId) ?? {};
    powers[fleet.entityId] = (powers[fleet.entityId] ?? 0) + contribution;
    zones.set(fleet.zoneId, powers);
  }
  return [...zones.entries()].map(([zoneId, powers]) => {
    const ranked = Object.entries(powers).sort((a, b) => b[1] - a[1]);
    const first = ranked[0];
    const second = ranked[1];
    const contested = !!second && second[1] >= first[1] * .68;
    return { zoneId, controllerId: contested ? undefined : first?.[0], leadingPower: first?.[1] ?? 0, contested, powers };
  });
}

export function processNavalForces(simulation: SimulationState, warState: WarState) {
  let state = rootState();
  for (const entityId of Object.keys(simulation.entities)) state = ensureEntityFleets(state, entityId, simulation);
  let changed = false;
  const ports = new Map(locationsForYear(simulation.date.year).map((location) => [location.id, location]));
  const fleets = state.fleets.map((fleet) => {
    const days = Math.max(0, simulation.elapsedDays - fleet.lastProcessedElapsedDay);
    if (!days) return fleet;
    changed = true;
    const inHarbor = fleet.mission === 'harbor' || fleet.mission === 'reserve';
    const enemies = warEnemySet(fleet.entityId, warState);
    const hostilePresence = state.fleets.some((other) => enemies.has(other.entityId) && other.zoneId === fleet.zoneId && other.mission !== 'harbor' && other.mission !== 'reserve');
    let readiness = fleet.readiness + days * (inHarbor ? .045 : -.018);
    let supply = fleet.supply + days * (inHarbor ? .05 : -.036);
    let power = fleet.power;
    let vessels = fleet.vessels;
    if (!inHarbor && hostilePresence && enemies.size) {
      readiness -= days * .012;
      supply -= days * .008;
      if (readiness < 28 && days >= 30) power -= 1.2;
      if (power < 18 && vessels > 3 && days >= 45) vessels -= 1;
    }
    const home = ports.get(fleet.homePortId);
    if (!home || (home.controllerId ?? home.ownerId) !== fleet.entityId) {
      supply -= days * .055;
      readiness -= days * .03;
    }
    return { ...fleet, vessels, power: clamp(power), readiness: clamp(readiness), supply: clamp(supply), lastProcessedElapsedDay: simulation.elapsedDays };
  });
  const zones = rebuildZoneControl(fleets);
  if (changed || fleets.length !== state.fleets.length || zones.length !== state.zones.length) publish({ fleets, zones });
  return { changed };
}

export function setNavalMission(fleetId: string, mission: NavalMission) {
  const state = rootState();
  const fleet = state.fleets.find((item) => item.id === fleetId);
  if (!fleet) return false;
  publish({ ...state, fleets: state.fleets.map((item) => item.id === fleetId ? { ...item, mission } : item) });
  return true;
}

export function moveFleetToZone(fleetId: string, zoneId: SeaZoneId) {
  const state = rootState();
  const fleet = state.fleets.find((item) => item.id === fleetId);
  if (!fleet) return false;
  if (fleet.range < 32 && fleet.zoneId !== zoneId) return false;
  publish({ ...state, fleets: state.fleets.map((item) => item.id === fleetId ? { ...item, zoneId, readiness: clamp(item.readiness - 4), supply: clamp(item.supply - 6) } : item) });
  return true;
}

export function fleetsForEntity(entityId: string) {
  return rootState().fleets.filter((fleet) => fleet.entityId === entityId).map((fleet) => ({ ...fleet }));
}

export function maritimeControlForZone(zoneId: SeaZoneId) {
  const zone = rootState().zones.find((item) => item.zoneId === zoneId);
  return zone ? { ...zone, powers: { ...zone.powers } } : undefined;
}

export function navalEscortStrength(entityId: string, zoneId?: SeaZoneId) {
  return rootState().fleets
    .filter((fleet) => fleet.entityId === entityId && (!zoneId || fleet.zoneId === zoneId) && fleet.mission === 'escort')
    .reduce((sum, fleet) => sum + fleet.power * fleet.readiness / 100 * fleet.supply / 100, 0);
}

export function navalSeaControlStrength(entityId: string, zoneId?: SeaZoneId) {
  return rootState().fleets
    .filter((fleet) => fleet.entityId === entityId && (!zoneId || fleet.zoneId === zoneId) && fleet.mission === 'sea-control')
    .reduce((sum, fleet) => sum + fleet.power * fleet.readiness / 100 * fleet.supply / 100, 0);
}

export function routeSeaZone(exporterId: string, importerId: string, year: number): SeaZoneId | undefined {
  const exporterPort = coastalLocations(exporterId, year)[0];
  const importerPort = coastalLocations(importerId, year)[0];
  if (!importerPort && !exporterPort) return undefined;
  if (!exporterPort) return seaZoneForLocation(importerPort!);
  if (!importerPort) return seaZoneForLocation(exporterPort);
  const a = seaZoneForLocation(exporterPort);
  const b = seaZoneForLocation(importerPort);
  return a === b ? a : seaZoneForLocation({ lat: (exporterPort.lat + importerPort.lat) / 2, lon: (exporterPort.lon + importerPort.lon) / 2 });
}
