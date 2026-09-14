import { routeMarketAccess } from './economicPressure';
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

export function applyEconomicPressureToResources(simulation: SimulationState, warState: WarState) {
  const root = globalThis as ResourceGlobal;
  const state = root.__WORLD_STATE_STRATEGIC_RESOURCES__;
  if (!state) return { changed: false };

  let changed = false;
  const profiles = Object.fromEntries(Object.entries(state.profiles).map(([id, profile]) => [id, {
    ...profile,
    balances: Object.fromEntries(Object.entries(profile.balances).map(([resource, balance]) => [resource, { ...balance }])),
  }]));

  const routes = state.routes.map((route) => {
    const access = routeMarketAccess(route.importerId, route.exporterId, simulation, warState);
    if (access.access >= .995 && access.pressure <= 1) return route;
    changed = true;
    const baseVolume = route.volume;
    const volume = clamp(baseVolume * access.access, 0, 100);
    const effectivePressure = clamp(Math.max(route.interdictionPressure, access.pressure));
    const status = access.access < .24 ? 'interdicted' as const : access.access < .68 ? 'pressured' as const : route.status;
    const profile = profiles[route.importerId];
    const balance = profile?.balances[route.resource];
    if (balance) {
      const lostAccess = Math.max(0, baseVolume - volume);
      profile.balances[route.resource] = {
        ...balance,
        imported: clamp(Math.max(0, balance.imported - lostAccess)),
        security: clamp(balance.security - lostAccess * .9 - access.pressure * .08 + access.alternative * .12),
      };
    }
    return { ...route, volume, status, interdictionPressure: effectivePressure };
  });

  if (!changed) return { changed: false };
  root.__WORLD_STATE_STRATEGIC_RESOURCES__ = { profiles, routes };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-strategic-resources', { detail: { profiles, routes } }));
  return { changed: true };
}
