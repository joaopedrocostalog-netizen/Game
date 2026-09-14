import { navalEscortStrength, navalSeaControlStrength, routeSeaZone } from './navalForces';
import type { SimulationState } from './simulation';
import type { StrategicResourceProfile, StrategicSupplyRoute } from './strategicResources';
import type { WarState } from './war';

type ResourceStateShape = {
  profiles: Record<string, StrategicResourceProfile>;
  routes: StrategicSupplyRoute[];
};

type ResourceGlobal = typeof globalThis & { __WORLD_STATE_STRATEGIC_RESOURCES__?: ResourceStateShape };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function enemiesFor(entityId: string, warState: WarState) {
  const enemies = new Set<string>();
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    if (war.attackers.includes(entityId)) war.defenders.forEach((id) => enemies.add(id));
    if (war.defenders.includes(entityId)) war.attackers.forEach((id) => enemies.add(id));
  }
  return [...enemies];
}

export function maritimeRouteAccess(exporterId: string, importerId: string, simulation: SimulationState, warState: WarState) {
  const zoneId = routeSeaZone(exporterId, importerId, simulation.date.year);
  if (!zoneId) return { zoneId: undefined, access: 1, protection: 0, contest: 0 };

  const protection = navalEscortStrength(importerId, zoneId) + navalEscortStrength(exporterId, zoneId) * .55
    + navalSeaControlStrength(importerId, zoneId) * .28 + navalSeaControlStrength(exporterId, zoneId) * .18;
  const enemies = new Set([...enemiesFor(importerId, warState), ...enemiesFor(exporterId, warState)]);
  const contest = [...enemies].reduce((sum, entityId) => sum + navalSeaControlStrength(entityId, zoneId), 0);
  const net = protection - contest;
  const access = contest <= 1
    ? 1
    : clamp(58 + net * .9, 18, 100) / 100;
  return { zoneId, access, protection, contest };
}

export function applyNavalControlToResources(simulation: SimulationState, warState: WarState) {
  const root = globalThis as ResourceGlobal;
  const state = root.__WORLD_STATE_STRATEGIC_RESOURCES__;
  if (!state) return { changed: false };

  let changed = false;
  const profiles = Object.fromEntries(Object.entries(state.profiles).map(([id, profile]) => [id, {
    ...profile,
    balances: Object.fromEntries(Object.entries(profile.balances).map(([resource, balance]) => [resource, { ...balance }])),
  }]));

  const routes = state.routes.map((route) => {
    const maritime = maritimeRouteAccess(route.exporterId, route.importerId, simulation, warState);
    if (maritime.access >= .995 || !maritime.zoneId) return route;
    changed = true;
    const baseVolume = route.volume;
    const volume = clamp(baseVolume * maritime.access, 0, 100);
    const lost = Math.max(0, baseVolume - volume);
    const profile = profiles[route.importerId];
    const balance = profile?.balances[route.resource];
    if (balance) {
      profile.balances[route.resource] = {
        ...balance,
        imported: clamp(Math.max(0, balance.imported - lost)),
        security: clamp(balance.security - lost * 1.05 - Math.max(0, maritime.contest - maritime.protection) * .05),
      };
    }
    const status = maritime.access < .3 ? 'interdicted' as const : maritime.access < .72 ? 'pressured' as const : route.status;
    return {
      ...route,
      volume,
      status,
      interdictionPressure: clamp(Math.max(route.interdictionPressure, maritime.contest - maritime.protection * .45)),
    };
  });

  if (!changed) return { changed: false };
  root.__WORLD_STATE_STRATEGIC_RESOURCES__ = { profiles, routes };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-strategic-resources', { detail: { profiles, routes } }));
  return { changed: true };
}
