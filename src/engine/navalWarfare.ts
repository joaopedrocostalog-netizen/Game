import { locationsForEntity } from '../data/territories';
import { militaryIndustryFor } from './militaryIndustry';
import { navalState, seaZoneForLocation, type NavalFleet, type NavalState, type SeaZoneId } from './navalForces';
import type { SimulationState, WorldEvent } from './simulation';
import type { WarState } from './war';

export type NavalConstructionStatus = 'building' | 'completed' | 'cancelled';
export type NavalBattleOutcome = 'decisive' | 'advantage' | 'inconclusive';

export type NavalConstructionOrder = {
  id: string;
  entityId: string;
  portId: string;
  label: string;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  cost: number;
  vessels: number;
  power: number;
  transportCapacity: number;
  status: NavalConstructionStatus;
};

export type NavalBattleRecord = {
  id: string;
  zoneId: SeaZoneId;
  occurredAtElapsedDay: number;
  sideA: string[];
  sideB: string[];
  lossesA: number;
  lossesB: number;
  outcome: NavalBattleOutcome;
  winnerId?: string;
};

export type NavalWarfareState = {
  construction: NavalConstructionOrder[];
  battles: NavalBattleRecord[];
  lastBattleByZone: Record<string, number>;
};

type NavalGlobal = typeof globalThis & { __WORLD_STATE_NAVAL_FORCES__?: NavalState; __WORLD_STATE_NAVAL_WARFARE__?: NavalWarfareState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): NavalWarfareState {
  const root = globalThis as NavalGlobal;
  if (!root.__WORLD_STATE_NAVAL_WARFARE__) root.__WORLD_STATE_NAVAL_WARFARE__ = { construction: [], battles: [], lastBattleByZone: {} };
  return root.__WORLD_STATE_NAVAL_WARFARE__;
}

function publish(state: NavalWarfareState) {
  (globalThis as NavalGlobal).__WORLD_STATE_NAVAL_WARFARE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-naval-warfare', { detail: state }));
}

function publishNaval(state: NavalState) {
  (globalThis as NavalGlobal).__WORLD_STATE_NAVAL_FORCES__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-naval-forces', { detail: state }));
}

export function resetNavalWarfare() {
  publish({ construction: [], battles: [], lastBattleByZone: {} });
}

export function navalWarfareState() {
  const state = rootState();
  return {
    construction: state.construction.map((item) => ({ ...item })),
    battles: state.battles.map((item) => ({ ...item, sideA: [...item.sideA], sideB: [...item.sideB] })),
    lastBattleByZone: { ...state.lastBattleByZone },
  };
}

function eraBuildLabel(year: number) {
  if (year < 1700) return 'Nova esquadra oceânica';
  if (year < 1850) return 'Nova esquadra naval';
  if (year < 1945) return 'Novo grupo de combate naval';
  return 'Novo grupo-tarefa naval';
}

function buildDuration(year: number, navalCapacity: number) {
  const era = year < 1700 ? 1.6 : year < 1850 ? 1.35 : year < 1945 ? 1.05 : .88;
  return Math.max(150, Math.round((380 - navalCapacity * 1.9) * era));
}

export function startNavalConstruction(entityId: string, simulation: SimulationState) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return { simulation, error: 'Entidade não encontrada.' };
  const ports = locationsForEntity(entityId, simulation.date.year).filter((location) => location.kind === 'port' || location.terrain === 'coastal');
  if (!ports.length) return { simulation, error: 'Nenhum porto elegível está disponível.' };
  const industry = militaryIndustryFor(entityId, simulation);
  if (industry.navalCapacity < 20) return { simulation, error: 'Capacidade naval insuficiente para sustentar uma nova formação.' };
  const state = rootState();
  if (state.construction.some((order) => order.entityId === entityId && order.status === 'building')) return { simulation, error: 'Já existe uma formação naval em construção.' };
  const cost = Math.round(10 + industry.navalCapacity * .14);
  if (runtime.treasuryIndex < cost + 8) return { simulation, error: 'Tesouro insuficiente para a encomenda naval.' };
  const vessels = Math.max(3, Math.round(4 + industry.navalCapacity / 11));
  const order: NavalConstructionOrder = {
    id: `naval-build-${entityId}-${simulation.elapsedDays}`,
    entityId,
    portId: ports[0].id,
    label: eraBuildLabel(simulation.date.year),
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + buildDuration(simulation.date.year, industry.navalCapacity),
    cost,
    vessels,
    power: clamp(28 + industry.navalCapacity * .58),
    transportCapacity: clamp(14 + industry.navalCapacity * .32),
    status: 'building',
  };
  const nextRuntime = { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - cost) };
  const event: WorldEvent = {
    id: `naval-build-start-${order.id}`,
    date: simulation.date,
    entityId,
    category: 'military',
    title: 'Construção naval iniciada',
    text: 'Uma nova formação naval foi encomendada e entrou em construção nos estaleiros disponíveis.',
  };
  publish({ ...state, construction: [order, ...state.construction].slice(0, 80) });
  return { simulation: { ...simulation, entities: { ...simulation.entities, [entityId]: nextRuntime }, events: [event, ...simulation.events].slice(0, 50) }, order };
}

function opposingInWar(a: string, b: string, warState: WarState) {
  return warState.wars.some((war) => war.status === 'active' && ((war.attackers.includes(a) && war.defenders.includes(b)) || (war.attackers.includes(b) && war.defenders.includes(a))));
}

function battlePower(fleet: NavalFleet) {
  const mission = fleet.mission === 'sea-control' ? 1.12 : fleet.mission === 'escort' ? .9 : fleet.mission === 'transport' ? .62 : fleet.mission === 'reserve' ? .46 : .15;
  return fleet.power * (fleet.readiness / 100) * (fleet.supply / 100) * mission;
}

function deterministicFactor(seed: string) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return .9 + (Math.abs(h >>> 0) % 21) / 100;
}

function resolveZoneBattle(zoneId: SeaZoneId, fleets: NavalFleet[], warState: WarState, elapsedDays: number) {
  const active = fleets.filter((fleet) => fleet.zoneId === zoneId && fleet.mission !== 'harbor' && fleet.mission !== 'reserve' && fleet.vessels > 0);
  const pair = active.flatMap((a) => active.map((b) => [a, b] as const)).find(([a, b]) => a.entityId !== b.entityId && opposingInWar(a.entityId, b.entityId, warState));
  if (!pair) return undefined;
  const [first, opponent] = pair;
  const sideAIds = new Set([first.entityId]);
  const sideBIds = new Set([opponent.entityId]);
  for (const fleet of active) {
    if (fleet.entityId === first.entityId) sideAIds.add(fleet.entityId);
    if (fleet.entityId === opponent.entityId) sideBIds.add(fleet.entityId);
  }
  const sideA = active.filter((fleet) => sideAIds.has(fleet.entityId));
  const sideB = active.filter((fleet) => sideBIds.has(fleet.entityId));
  const powerA = sideA.reduce((sum, fleet) => sum + battlePower(fleet), 0) * deterministicFactor(`${zoneId}:a:${elapsedDays}`);
  const powerB = sideB.reduce((sum, fleet) => sum + battlePower(fleet), 0) * deterministicFactor(`${zoneId}:b:${elapsedDays}`);
  const total = Math.max(1, powerA + powerB);
  const ratioA = powerA / total;
  const lossesA = clamp(Math.round((.16 + (1 - ratioA) * .42) * sideA.reduce((sum, fleet) => sum + fleet.vessels, 0)), 0, 12);
  const lossesB = clamp(Math.round((.16 + ratioA * .42) * sideB.reduce((sum, fleet) => sum + fleet.vessels, 0)), 0, 12);
  const gap = Math.abs(powerA - powerB) / Math.max(powerA, powerB, 1);
  const outcome: NavalBattleOutcome = gap > .42 ? 'decisive' : gap > .18 ? 'advantage' : 'inconclusive';
  const winnerId = gap > .12 ? (powerA > powerB ? first.entityId : opponent.entityId) : undefined;
  return { sideA, sideB, lossesA, lossesB, outcome, winnerId };
}

function applyLosses(fleets: NavalFleet[], participants: NavalFleet[], losses: number) {
  if (!participants.length || losses <= 0) return fleets;
  let remaining = losses;
  return fleets.map((fleet) => {
    if (!participants.some((item) => item.id === fleet.id) || remaining <= 0) return fleet;
    const share = Math.min(fleet.vessels, Math.max(0, Math.round(losses * (fleet.vessels / Math.max(1, participants.reduce((sum, item) => sum + item.vessels, 0))))));
    const applied = Math.min(remaining, share || 1);
    remaining -= applied;
    const vessels = Math.max(0, fleet.vessels - applied);
    const readiness = clamp(fleet.readiness - applied * 4 - 7);
    const power = vessels <= 0 ? 0 : clamp(fleet.power * (vessels / Math.max(1, fleet.vessels)));
    return { ...fleet, vessels, power, readiness, supply: clamp(fleet.supply - applied * 2.2), mission: readiness < 26 || vessels <= 1 ? 'harbor' : fleet.mission };
  });
}

function commissionedFleet(order: NavalConstructionOrder, simulation: SimulationState, index: number): NavalFleet {
  const port = locationsForEntity(order.entityId, simulation.date.year).find((location) => location.id === order.portId) ?? locationsForEntity(order.entityId, simulation.date.year)[0];
  return {
    id: `fleet-${order.entityId}-built-${order.startedAtElapsedDay}`,
    entityId: order.entityId,
    name: simulation.date.year < 1850 ? `Esquadra ${index + 1}` : simulation.date.year < 1945 ? `Frota ${index + 1}` : `Grupo-Tarefa ${index + 1}`,
    homePortId: order.portId,
    zoneId: port ? seaZoneForLocation(port) : 'north-atlantic',
    mission: 'harbor',
    vessels: order.vessels,
    power: order.power,
    readiness: 58,
    supply: 70,
    range: clamp(42 + (simulation.entities[order.entityId]?.technology ?? 35) * .48),
    transportCapacity: order.transportCapacity,
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}

export function processNavalWarfare(simulation: SimulationState, warState: WarState) {
  const state = rootState();
  const naval = navalState();
  let fleets = naval.fleets.map((fleet) => ({ ...fleet }));
  let construction = state.construction.map((order) => ({ ...order }));
  let battles = [...state.battles];
  const lastBattleByZone = { ...state.lastBattleByZone };
  let nextSimulation = simulation;
  let changed = false;

  construction = construction.map((order) => {
    if (order.status !== 'building' || simulation.elapsedDays < order.completesAtElapsedDay) return order;
    const fleet = commissionedFleet(order, simulation, fleets.filter((item) => item.entityId === order.entityId).length);
    fleets.push(fleet);
    changed = true;
    const event: WorldEvent = {
      id: `naval-build-complete-${order.id}`,
      date: simulation.date,
      entityId: order.entityId,
      category: 'military',
      title: 'Nova formação naval comissionada',
      text: 'A construção foi concluída e a nova formação está disponível no porto-base para receber missão.',
    };
    nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    return { ...order, status: 'completed' as const };
  });

  const zones = [...new Set(fleets.map((fleet) => fleet.zoneId))];
  for (const zoneId of zones) {
    const last = lastBattleByZone[zoneId] ?? -9999;
    if (simulation.elapsedDays - last < 14) continue;
    const result = resolveZoneBattle(zoneId, fleets, warState, simulation.elapsedDays);
    if (!result) continue;
    fleets = applyLosses(fleets, result.sideA, result.lossesA);
    fleets = applyLosses(fleets, result.sideB, result.lossesB);
    const record: NavalBattleRecord = {
      id: `naval-battle-${zoneId}-${simulation.elapsedDays}`,
      zoneId,
      occurredAtElapsedDay: simulation.elapsedDays,
      sideA: [...new Set(result.sideA.map((fleet) => fleet.entityId))],
      sideB: [...new Set(result.sideB.map((fleet) => fleet.entityId))],
      lossesA: result.lossesA,
      lossesB: result.lossesB,
      outcome: result.outcome,
      winnerId: result.winnerId,
    };
    battles = [record, ...battles].slice(0, 80);
    lastBattleByZone[zoneId] = simulation.elapsedDays;
    changed = true;
  }

  if (changed) {
    publishNaval({ fleets, zones: naval.zones });
    publish({ construction, battles, lastBattleByZone });
  }
  return { simulation: nextSimulation, changed };
}

export function sendFleetForRepairs(fleetId: string) {
  const root = globalThis as NavalGlobal;
  const naval = root.__WORLD_STATE_NAVAL_FORCES__;
  if (!naval) return false;
  const fleets = naval.fleets.map((fleet) => fleet.id === fleetId ? { ...fleet, mission: 'harbor' as const, readiness: clamp(fleet.readiness + 4), supply: clamp(fleet.supply + 6) } : fleet);
  publishNaval({ ...naval, fleets });
  return true;
}

export function amphibiousReadiness(entityId: string, zoneId: SeaZoneId) {
  const naval = navalState();
  const fleets = naval.fleets.filter((fleet) => fleet.entityId === entityId && fleet.zoneId === zoneId);
  const transport = fleets.filter((fleet) => fleet.mission === 'transport').reduce((sum, fleet) => sum + fleet.transportCapacity * fleet.readiness / 100, 0);
  const cover = fleets.filter((fleet) => fleet.mission === 'sea-control' || fleet.mission === 'escort').reduce((sum, fleet) => sum + fleet.power * fleet.readiness / 100, 0);
  const zone = naval.zones.find((item) => item.zoneId === zoneId);
  const controlFactor = zone?.controllerId === entityId ? 1 : zone?.contested ? .62 : .38;
  const score = clamp(transport * .55 + cover * .35) * controlFactor;
  return { score, available: score >= 34 && transport >= 18, transport, cover };
}
