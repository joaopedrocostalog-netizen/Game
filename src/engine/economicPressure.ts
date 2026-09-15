import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import { sanctionsEvasionRelief } from './sanctionsEvasion';
import type { WarState } from './war';

export type EconomicPressureAction = 'embargo' | 'sanctions' | 'route_pressure' | 'market_restriction';
export type EconomicPressureMeasure = {
  id: string;
  initiatorId: string;
  targetId: string;
  action: EconomicPressureAction;
  startedAtElapsedDay: number;
  active: boolean;
  pressure: number;
};

export type EconomicPressureState = {
  measures: EconomicPressureMeasure[];
  lastProcessedElapsedDay: number;
};

type EconomicPressureGlobal = typeof globalThis & { __WORLD_STATE_ECONOMIC_PRESSURE__?: EconomicPressureState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): EconomicPressureState {
  const root = globalThis as EconomicPressureGlobal;
  if (!root.__WORLD_STATE_ECONOMIC_PRESSURE__) root.__WORLD_STATE_ECONOMIC_PRESSURE__ = { measures: [], lastProcessedElapsedDay: 0 };
  return root.__WORLD_STATE_ECONOMIC_PRESSURE__;
}

function publish(state: EconomicPressureState) {
  (globalThis as EconomicPressureGlobal).__WORLD_STATE_ECONOMIC_PRESSURE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-economic-pressure', { detail: state }));
}

export function resetEconomicPressure() {
  publish({ measures: [], lastProcessedElapsedDay: 0 });
}

export function economicPressureState() {
  const state = rootState();
  return { measures: state.measures.map((measure) => ({ ...measure })), lastProcessedElapsedDay: state.lastProcessedElapsedDay };
}

function atWarWith(a: string, b: string, warState: WarState) {
  return warState.wars.some((war) => war.status === 'active' && ((war.attackers.includes(a) && war.defenders.includes(b)) || (war.attackers.includes(b) && war.defenders.includes(a))));
}

export function economicPressureLabel(action: EconomicPressureAction, year: number) {
  if (action === 'embargo') return year < 1800 ? 'Interdição mercantil' : 'Embargo comercial';
  if (action === 'sanctions') return year < 1800 ? 'Restrições comerciais coordenadas' : 'Sanções comerciais';
  if (action === 'route_pressure') return year < 1800 ? 'Pressão sobre rotas mercantis' : 'Pressão sobre rotas comerciais';
  return year < 1800 ? 'Restrição de acesso a portos e mercados' : 'Restrição de acesso a mercados';
}

function pressureFor(initiatorId: string, targetId: string, action: EconomicPressureAction, simulation: SimulationState, warState: WarState) {
  const initiator = simulation.entities[initiatorId];
  const target = simulation.entities[targetId];
  const relation = simulation.diplomacy[pairKey(initiatorId, targetId)]?.score ?? 0;
  const wartime = atWarWith(initiatorId, targetId, warState);
  const era = simulation.date.year < 1700 ? .68 : simulation.date.year < 1850 ? .82 : simulation.date.year < 1945 ? 1 : 1.08;
  const actionFactor = action === 'route_pressure' ? 1.05 : action === 'market_restriction' ? .96 : action === 'sanctions' ? .9 : .82;
  const base = ((initiator?.economyIndex ?? 40) * .38 + (initiator?.militaryReadiness ?? 35) * .26 + (initiator?.technology ?? 35) * .22 + (initiator?.treasuryIndex ?? 40) * .14) * era * actionFactor;
  const resistance = (target?.economyIndex ?? 40) * .12 + Math.max(0, relation) * .08;
  return clamp(base + (wartime ? 12 : 0) - resistance, 8, 95);
}

export function startEconomicPressure(initiatorId: string, targetId: string, action: EconomicPressureAction, simulation: SimulationState, warState: WarState) {
  if (initiatorId === targetId) return { error: 'A medida precisa ter outra entidade como alvo.' };
  if (!simulation.entities[initiatorId] || !simulation.entities[targetId]) return { error: 'Entidade não encontrada.' };
  const state = rootState();
  if (state.measures.some((measure) => measure.active && measure.initiatorId === initiatorId && measure.targetId === targetId && measure.action === action)) return { error: 'Essa medida já está ativa contra o alvo.' };
  const measure: EconomicPressureMeasure = {
    id: `economic-pressure-${initiatorId}-${targetId}-${action}-${simulation.elapsedDays}`,
    initiatorId,
    targetId,
    action,
    startedAtElapsedDay: simulation.elapsedDays,
    active: true,
    pressure: pressureFor(initiatorId, targetId, action, simulation, warState),
  };
  publish({ ...state, measures: [measure, ...state.measures].slice(0, 160) });
  return { measure };
}

export function endEconomicPressure(measureId: string) {
  const state = rootState();
  if (!state.measures.some((measure) => measure.id === measureId && measure.active)) return false;
  publish({ ...state, measures: state.measures.map((measure) => measure.id === measureId ? { ...measure, active: false } : measure) });
  return true;
}

function alternateMarketAccess(importerId: string, exporterId: string, simulation: SimulationState, warState: WarState) {
  let best = 0;
  for (const treaty of simulation.treaties) {
    if (!treaty.active || treaty.type !== 'trade' || !treaty.parties.includes(importerId)) continue;
    const partnerId = treaty.parties[0] === importerId ? treaty.parties[1] : treaty.parties[0];
    if (partnerId === exporterId || atWarWith(importerId, partnerId, warState)) continue;
    const partner = simulation.entities[partnerId];
    const relation = simulation.diplomacy[pairKey(importerId, partnerId)]?.score ?? 0;
    if (!partner || relation < 10) continue;
    const access = clamp(partner.economyIndex * .45 + partner.technology * .25 + partner.treasuryIndex * .15 + Math.max(0, relation) * .15);
    best = Math.max(best, access);
  }
  return best;
}

export function routeMarketAccess(importerId: string, exporterId: string, simulation: SimulationState, warState: WarState) {
  const active = rootState().measures.filter((measure) => measure.active && measure.targetId === importerId);
  let pressure = 0;
  let directEmbargo = false;
  for (const measure of active) {
    if (measure.action === 'embargo' && measure.initiatorId === exporterId) directEmbargo = true;
    const weight = measure.action === 'route_pressure' ? 1 : measure.action === 'market_restriction' ? .86 : measure.action === 'sanctions' ? .64 : .5;
    pressure += measure.pressure * weight;
  }
  pressure = clamp(pressure);
  const adaptation = sanctionsEvasionRelief(importerId);
  const alternative = clamp(alternateMarketAccess(importerId, exporterId, simulation, warState) * .28 + adaptation.relief * .42, 0, 42);
  const effectivePressure = clamp(pressure - adaptation.relief * .48);
  let access = clamp(1 - effectivePressure / 125 + alternative / 100, .08, 1);
  if (directEmbargo) access *= clamp(.3 + adaptation.relief / 220, .3, .55);
  return { access: clamp(access * 100, 5, 100) / 100, pressure: effectivePressure, rawPressure: pressure, alternative, evasionRelief: adaptation.relief, directEmbargo };
}

export function processEconomicPressure(simulation: SimulationState, warState: WarState) {
  const state = rootState();
  const days = Math.max(0, simulation.elapsedDays - state.lastProcessedElapsedDay);
  if (!days) return { simulation, changed: false };
  const measures = state.measures.map((measure) => measure.active ? { ...measure, pressure: pressureFor(measure.initiatorId, measure.targetId, measure.action, simulation, warState) } : measure);
  const entities = { ...simulation.entities };
  let changed = false;
  for (const targetId of Object.keys(simulation.entities)) {
    const imposed = measures.filter((measure) => measure.active && measure.targetId === targetId);
    if (!imposed.length) continue;
    const runtime = entities[targetId];
    if (!runtime) continue;
    const sanctions = imposed.filter((measure) => measure.action === 'sanctions').reduce((sum, measure) => sum + measure.pressure, 0);
    const market = imposed.filter((measure) => measure.action === 'market_restriction').reduce((sum, measure) => sum + measure.pressure, 0);
    const adaptation = sanctionsEvasionRelief(targetId);
    const reliefFactor = clamp(1 - adaptation.relief / 115, .48, 1);
    const drag = clamp((sanctions * .55 + market * .3) / 100 * reliefFactor, 0, 1.5);
    if (drag <= 0) continue;
    entities[targetId] = { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - days * drag * .012), economyIndex: clamp(runtime.economyIndex - days * drag * .004) };
    changed = true;
  }
  let nextSimulation = simulation;
  if (changed) {
    const affected = [...new Set(measures.filter((measure) => measure.active).map((measure) => measure.targetId))];
    const events: WorldEvent[] = affected.slice(0, 4).map((entityId) => ({ id: `economic-pressure-event-${entityId}-${simulation.elapsedDays}`, date: simulation.date, entityId, category: 'economy', title: 'Pressão econômica externa', text: sanctionsEvasionRelief(entityId).relief > 10 ? 'Restrições comerciais pressionam a economia, mas redes alternativas e substituição doméstica amortecem parte do impacto.' : 'Restrições comerciais e menor acesso a mercados estão pressionando o tesouro e a atividade econômica.' }));
    nextSimulation = { ...simulation, entities, events: [...events, ...simulation.events].slice(0, 50) };
  }
  publish({ measures, lastProcessedElapsedDay: simulation.elapsedDays });
  return { simulation: nextSimulation, changed: true };
}
