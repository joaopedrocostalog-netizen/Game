import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import type { WarState } from './war';

export type StrategicResourceType = 'saltpeter' | 'metals' | 'timber' | 'coal' | 'steel' | 'oil' | 'rubber' | 'components';
export type SupplyRouteStatus = 'open' | 'pressured' | 'interdicted';

export type StrategicResourceBalance = {
  resource: StrategicResourceType;
  domesticOutput: number;
  stockpile: number;
  demand: number;
  imported: number;
  security: number;
};

export type StrategicResourceProfile = {
  entityId: string;
  balances: Record<string, StrategicResourceBalance>;
  lastProcessedElapsedDay: number;
  initializedAtYear: number;
};

export type StrategicSupplyRoute = {
  id: string;
  importerId: string;
  exporterId: string;
  resource: StrategicResourceType;
  volume: number;
  status: SupplyRouteStatus;
  interdictionPressure: number;
};

export type StrategicResourceState = {
  profiles: Record<string, StrategicResourceProfile>;
  routes: StrategicSupplyRoute[];
};

type ResourceGlobal = typeof globalThis & { __WORLD_STATE_STRATEGIC_RESOURCES__?: StrategicResourceState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function rootState(): StrategicResourceState {
  const root = globalThis as ResourceGlobal;
  if (!root.__WORLD_STATE_STRATEGIC_RESOURCES__) root.__WORLD_STATE_STRATEGIC_RESOURCES__ = { profiles: {}, routes: [] };
  return root.__WORLD_STATE_STRATEGIC_RESOURCES__;
}

function publish(state: StrategicResourceState) {
  (globalThis as ResourceGlobal).__WORLD_STATE_STRATEGIC_RESOURCES__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-strategic-resources', { detail: state }));
}

export function resetStrategicResources() {
  publish({ profiles: {}, routes: [] });
}

export function strategicResourceState() {
  const state = rootState();
  return {
    profiles: Object.fromEntries(Object.entries(state.profiles).map(([id, profile]) => [id, {
      ...profile,
      balances: Object.fromEntries(Object.entries(profile.balances).map(([resource, balance]) => [resource, { ...balance }])),
    }])),
    routes: state.routes.map((route) => ({ ...route })),
  };
}

export function resourcesForEra(year: number): StrategicResourceType[] {
  if (year < 1700) return ['saltpeter', 'metals', 'timber'];
  if (year < 1850) return ['saltpeter', 'metals', 'timber', 'coal'];
  if (year < 1880) return ['metals', 'coal', 'steel', 'timber'];
  if (year < 1914) return ['coal', 'steel', 'oil', 'timber'];
  if (year < 1945) return ['coal', 'steel', 'oil', 'rubber'];
  if (year < 1990) return ['steel', 'oil', 'rubber', 'components'];
  return ['steel', 'oil', 'components'];
}

export function resourceLabel(resource: StrategicResourceType, year: number) {
  const labels: Record<StrategicResourceType, string> = {
    saltpeter: year < 1800 ? 'Salitre e insumos de pólvora' : 'Nitratos e propelentes',
    metals: 'Metais estratégicos',
    timber: year < 1850 ? 'Madeira naval e militar' : 'Madeira e materiais estruturais',
    coal: 'Carvão',
    steel: year < 1900 ? 'Ferro e aço industrial' : 'Aço',
    oil: year < 1914 ? 'Petróleo emergente' : 'Petróleo e combustíveis',
    rubber: 'Borracha',
    components: year < 1970 ? 'Componentes industriais avançados' : 'Componentes tecnológicos',
  };
  return labels[resource];
}

function initialBalance(entityId: string, resource: StrategicResourceType, simulation: SimulationState): StrategicResourceBalance {
  const runtime = simulation.entities[entityId];
  const economy = runtime?.economyIndex ?? 40;
  const tech = runtime?.technology ?? 35;
  const seed = hash(`${entityId}:${resource}:${Math.floor(simulation.date.year / 25)}`);
  const endowment = 18 + seed % 56;
  const development = economy * .34 + tech * .16;
  const domesticOutput = clamp(endowment * .66 + development * .34);
  return {
    resource,
    domesticOutput,
    stockpile: clamp(28 + domesticOutput * .45 + ((seed >> 8) % 18)),
    demand: clamp(32 + economy * .24 + tech * .18),
    imported: 0,
    security: clamp(35 + domesticOutput * .52),
  };
}

function initialProfile(entityId: string, simulation: SimulationState): StrategicResourceProfile {
  const balances: Record<string, StrategicResourceBalance> = {};
  for (const resource of resourcesForEra(simulation.date.year)) balances[resource] = initialBalance(entityId, resource, simulation);
  return { entityId, balances, lastProcessedElapsedDay: simulation.elapsedDays, initializedAtYear: simulation.date.year };
}

function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  const existing = state.profiles[entityId];
  const active = resourcesForEra(simulation.date.year);
  if (existing) {
    let changed = false;
    const balances = { ...existing.balances };
    for (const resource of active) {
      if (!balances[resource]) {
        balances[resource] = initialBalance(entityId, resource, simulation);
        changed = true;
      }
    }
    if (!changed) return existing;
    const next = { ...existing, balances };
    publish({ ...state, profiles: { ...state.profiles, [entityId]: next } });
    return next;
  }
  const profile = initialProfile(entityId, simulation);
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}

function enemyPressure(entityId: string, simulation: SimulationState, warState: WarState) {
  const enemies = new Set<string>();
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    if (war.attackers.includes(entityId)) war.defenders.forEach((id) => enemies.add(id));
    if (war.defenders.includes(entityId)) war.attackers.forEach((id) => enemies.add(id));
  }
  if (!enemies.size) return 0;
  const maritimeEra = simulation.date.year < 1700 ? .62 : simulation.date.year < 1850 ? .76 : simulation.date.year < 1945 ? 1 : 1.12;
  const pressure = [...enemies].reduce((sum, id) => {
    const runtime = simulation.entities[id];
    return sum + ((runtime?.militaryReadiness ?? 35) * .58 + (runtime?.technology ?? 35) * .42) * maritimeEra;
  }, 0) / enemies.size;
  return clamp(pressure);
}

function routeStatus(pressure: number, tradeRelation: number): SupplyRouteStatus {
  const effective = pressure - Math.max(0, tradeRelation) * .12;
  if (effective >= 72) return 'interdicted';
  if (effective >= 44) return 'pressured';
  return 'open';
}

function buildRoutes(profiles: Record<string, StrategicResourceProfile>, simulation: SimulationState, warState: WarState) {
  const routes: StrategicSupplyRoute[] = [];
  for (const treaty of simulation.treaties) {
    if (!treaty.active || treaty.type !== 'trade') continue;
    const [a, b] = treaty.parties;
    const aProfile = profiles[a];
    const bProfile = profiles[b];
    if (!aProfile || !bProfile) continue;
    const relation = simulation.diplomacy[pairKey(a, b)]?.score ?? 0;
    for (const resource of resourcesForEra(simulation.date.year)) {
      const aBal = aProfile.balances[resource];
      const bBal = bProfile.balances[resource];
      if (!aBal || !bBal) continue;
      const directions: Array<[string, string, StrategicResourceBalance, StrategicResourceBalance]> = aBal.domesticOutput > bBal.domesticOutput
        ? [[a, b, aBal, bBal]]
        : [[b, a, bBal, aBal]];
      for (const [exporterId, importerId, exporter, importer] of directions) {
        const surplus = Math.max(0, exporter.domesticOutput + exporter.stockpile * .22 - exporter.demand);
        const deficit = Math.max(0, importer.demand - importer.domesticOutput);
        if (surplus < 4 || deficit < 3) continue;
        const pressure = enemyPressure(importerId, simulation, warState);
        const status = routeStatus(pressure, relation);
        const access = status === 'interdicted' ? .18 : status === 'pressured' ? .58 : 1;
        const volume = clamp(Math.min(surplus, deficit) * (.24 + Math.max(0, relation + 30) / 260) * access, 0, 28);
        if (volume < 1) continue;
        routes.push({ id: `resource-route-${exporterId}-${importerId}-${resource}`, importerId, exporterId, resource, volume, status, interdictionPressure: pressure });
      }
    }
  }
  return routes;
}

function resourceDemandMultiplier(resource: StrategicResourceType, year: number, atWar: boolean) {
  const war = atWar ? 1.75 : 1;
  if (resource === 'oil' && year >= 1914) return 1.18 * war;
  if (resource === 'components' && year >= 1945) return 1.12 * war;
  if (resource === 'saltpeter') return 1.1 * war;
  return war;
}

export function processStrategicResources(simulation: SimulationState, warState: WarState) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let changed = false;
  for (const entityId of Object.keys(simulation.entities)) profiles[entityId] = profiles[entityId] ?? initialProfile(entityId, simulation);
  const routes = buildRoutes(profiles, simulation, warState);

  for (const entityId of Object.keys(simulation.entities)) {
    const profile = profiles[entityId];
    const days = Math.max(0, simulation.elapsedDays - profile.lastProcessedElapsedDay);
    if (!days) continue;
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const balances = { ...profile.balances };
    for (const resource of resourcesForEra(simulation.date.year)) {
      const current = balances[resource] ?? initialBalance(entityId, resource, simulation);
      const incoming = routes.filter((route) => route.importerId === entityId && route.resource === resource).reduce((sum, route) => sum + route.volume, 0);
      const outgoing = routes.filter((route) => route.exporterId === entityId && route.resource === resource).reduce((sum, route) => sum + route.volume, 0);
      const production = days * current.domesticOutput / 900;
      const imports = days * incoming / 780;
      const exports = days * outgoing / 920;
      const consumption = days * current.demand * resourceDemandMultiplier(resource, simulation.date.year, atWar) / 980;
      const stockpile = clamp(current.stockpile + production + imports - exports - consumption);
      const importShare = incoming / Math.max(1, current.domesticOutput + incoming);
      const routeRisk = routes.filter((route) => route.importerId === entityId && route.resource === resource)
        .reduce((max, route) => Math.max(max, route.interdictionPressure), 0);
      const security = clamp(current.domesticOutput * .55 + stockpile * .3 + (1 - importShare) * 25 - routeRisk * importShare * .35);
      balances[resource] = { ...current, stockpile, imported: clamp(incoming), security };
    }
    profiles[entityId] = { ...profile, balances, lastProcessedElapsedDay: simulation.elapsedDays };
    changed = true;
  }

  if (changed || routes.length !== state.routes.length) publish({ profiles, routes });
  return { changed };
}

export function strategicResourcesForEntity(entityId: string, simulation: SimulationState) {
  const profile = ensureProfile(entityId, simulation);
  return resourcesForEra(simulation.date.year).map((resource) => profile.balances[resource] ?? initialBalance(entityId, resource, simulation));
}

export function supplyRoutesForEntity(entityId: string) {
  return rootState().routes.filter((route) => route.importerId === entityId || route.exporterId === entityId).map((route) => ({ ...route }));
}

export function strategicResourceSecurity(entityId: string, simulation: SimulationState) {
  const balances = strategicResourcesForEntity(entityId, simulation);
  if (!balances.length) return 100;
  return balances.reduce((sum, balance) => sum + balance.security, 0) / balances.length;
}

export function strategicResourceIndustryModifiers(entityId: string, simulation: SimulationState) {
  const balances = new Map(strategicResourcesForEntity(entityId, simulation).map((balance) => [balance.resource, balance]));
  const avg = (...types: StrategicResourceType[]) => {
    const active = types.map((type) => balances.get(type)?.security).filter((value): value is number => value !== undefined);
    return active.length ? active.reduce((sum, value) => sum + value, 0) / active.length : 65;
  };
  const year = simulation.date.year;
  const armamentSecurity = year < 1850 ? avg('saltpeter', 'metals', 'timber') : year < 1914 ? avg('coal', 'steel', 'metals') : year < 1945 ? avg('steel', 'oil', 'rubber') : avg('steel', 'oil', 'components');
  const supplySecurity = year < 1850 ? avg('timber', 'metals', 'coal') : year < 1945 ? avg('coal', 'oil', 'steel') : avg('oil', 'rubber', 'components');
  const navalSecurity = year < 1850 ? avg('timber', 'metals') : year < 1945 ? avg('steel', 'coal', 'oil') : avg('steel', 'oil', 'components');
  return {
    armaments: clamp(.45 + armamentSecurity / 180, .45, 1.05),
    supply: clamp(.48 + supplySecurity / 185, .48, 1.05),
    naval: clamp(.42 + navalSecurity / 175, .42, 1.05),
    overallSecurity: (armamentSecurity + supplySecurity + navalSecurity) / 3,
  };
}

export function strategicResourceEvents(entityId: string, simulation: SimulationState): WorldEvent | undefined {
  const security = strategicResourceSecurity(entityId, simulation);
  if (security >= 24) return undefined;
  return {
    id: `strategic-shortage-${entityId}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId,
    category: 'economy',
    title: 'Escassez de recursos estratégicos',
    text: 'A segurança de abastecimento estratégico caiu a um nível crítico, limitando a capacidade de sustentar produção e reposição militar.',
  };
}
