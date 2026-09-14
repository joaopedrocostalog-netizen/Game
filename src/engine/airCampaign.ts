import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { ArmyState } from './army';
import type { NavalState } from './navalForces';
import type { SimulationState } from './simulation';
import type { FrontState, WarState } from './war';

export type AirMission = 'reserve' | 'air-superiority' | 'reconnaissance' | 'ground-support' | 'interdiction' | 'maritime-patrol';
export type AirFormation = {
  id: string;
  entityId: string;
  name: string;
  baseLocationId: string;
  mission: AirMission;
  strength: number;
  readiness: number;
  supply: number;
  range: number;
  experience: number;
  lastProcessedElapsedDay: number;
};
export type AirTheaterControl = {
  warId: string;
  frontId: string;
  attackerScore: number;
  defenderScore: number;
  state: 'attacker-dominant' | 'defender-dominant' | 'contested' | 'limited';
};
export type AirCampaignState = {
  formations: AirFormation[];
  theaters: AirTheaterControl[];
};

type AirGlobal = typeof globalThis & {
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
  __WORLD_STATE_NAVAL_FORCES__?: NavalState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirCampaignState {
  const root = globalThis as AirGlobal;
  if (!root.__WORLD_STATE_AIR_CAMPAIGN__) root.__WORLD_STATE_AIR_CAMPAIGN__ = { formations: [], theaters: [] };
  return root.__WORLD_STATE_AIR_CAMPAIGN__;
}
function publish(state: AirCampaignState) {
  (globalThis as AirGlobal).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}
export function resetAirCampaign() { publish({ formations: [], theaters: [] }); }
export function airCampaignState() { const state = rootState(); return { formations: state.formations.map((item) => ({ ...item })), theaters: state.theaters.map((item) => ({ ...item })) }; }

export function airEraAvailable(year: number) { return year >= 1794; }
export function airEraLabel(year: number) {
  if (year < 1794) return 'Sem capacidade aérea militar disponível';
  if (year < 1903) return 'Observação aerostática';
  if (year < 1914) return 'Aviação militar pioneira';
  if (year < 1945) return 'Aviação militar industrial';
  return 'Poder aéreo integrado';
}
export function airMissionLabel(mission: AirMission, year: number) {
  if (mission === 'reserve') return year < 1914 ? 'Reserva de observação' : 'Reserva aérea';
  if (mission === 'air-superiority') return year < 1914 ? 'Proteção do espaço de observação' : 'Superioridade aérea';
  if (mission === 'reconnaissance') return year < 1903 ? 'Observação por balões' : 'Reconhecimento aéreo';
  if (mission === 'ground-support') return year < 1914 ? 'Apoio de observação ao exército' : 'Apoio terrestre';
  if (mission === 'interdiction') return year < 1914 ? 'Observação das linhas inimigas' : 'Interdição operacional';
  return year < 1914 ? 'Observação costeira' : 'Patrulha marítima';
}

function eligibleBases(entityId: string, year: number) {
  return locationsForEntity(entityId, year).filter((location) => location.kind === 'capital' || location.kind === 'city' || location.kind === 'port');
}
function formationName(year: number, index: number) {
  if (year < 1903) return index ? `Destacamento Aerostático ${index + 1}` : 'Corpo de Observação Aerostática';
  if (year < 1914) return index ? `Destacamento Aéreo ${index + 1}` : 'Aviação Militar';
  if (year < 1945) return index ? `Grupo Aéreo ${index + 1}` : 'Comando Aéreo Principal';
  return index ? `Ala Aérea ${index + 1}` : 'Comando de Operações Aéreas';
}
function initialFormation(entityId: string, base: ResolvedLocation, simulation: SimulationState, index: number): AirFormation {
  const runtime = simulation.entities[entityId];
  const tech = runtime?.technology ?? 35;
  const readiness = runtime?.militaryReadiness ?? 35;
  const year = simulation.date.year;
  const era = year < 1903 ? .32 : year < 1914 ? .55 : year < 1945 ? .82 : 1;
  return {
    id: `air-${entityId}-${index + 1}`,
    entityId,
    name: formationName(year, index),
    baseLocationId: base.id,
    mission: index === 0 ? 'reconnaissance' : 'reserve',
    strength: clamp((24 + tech * .46 + readiness * .3) * era),
    readiness: clamp(48 + readiness * .36 + tech * .14),
    supply: clamp(52 + (runtime?.treasuryIndex ?? 35) * .38),
    range: clamp((18 + tech * .7) * (year < 1903 ? .38 : year < 1914 ? .58 : year < 1945 ? .82 : 1)),
    experience: clamp(18 + readiness * .18),
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}
function ensureAirForces(state: AirCampaignState, entityId: string, simulation: SimulationState) {
  if (!airEraAvailable(simulation.date.year) || state.formations.some((item) => item.entityId === entityId)) return state;
  const bases = eligibleBases(entityId, simulation.date.year);
  if (!bases.length) return state;
  const runtime = simulation.entities[entityId];
  if (!runtime) return state;
  const count = simulation.date.year < 1903 ? 1 : runtime.technology >= 68 && runtime.militaryReadiness >= 55 ? 2 : 1;
  return { ...state, formations: [...state.formations, ...Array.from({ length: count }, (_, index) => initialFormation(entityId, bases[index % bases.length], simulation, index))] };
}
function activeWarEnemies(entityId: string, warState: WarState) {
  const set = new Set<string>();
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    if (war.attackers.includes(entityId)) war.defenders.forEach((id) => set.add(id));
    if (war.defenders.includes(entityId)) war.attackers.forEach((id) => set.add(id));
  }
  return set;
}
function missionFactor(mission: AirMission) {
  if (mission === 'air-superiority') return 1.18;
  if (mission === 'reconnaissance') return .72;
  if (mission === 'ground-support') return .88;
  if (mission === 'interdiction') return .82;
  if (mission === 'maritime-patrol') return .74;
  return .28;
}
function formationPower(formation: AirFormation) {
  return formation.strength * formation.readiness / 100 * formation.supply / 100 * (0.82 + formation.experience / 500) * missionFactor(formation.mission);
}
function frontControl(warId: string, front: FrontState, warState: WarState, formations: AirFormation[]): AirTheaterControl {
  const war = warState.wars.find((item) => item.id === warId)!;
  const attackers = new Set(war.attackers);
  const defenders = new Set(war.defenders);
  const attackerScore = formations.filter((item) => attackers.has(item.entityId) && item.mission !== 'reserve').reduce((sum, item) => sum + formationPower(item), 0);
  const defenderScore = formations.filter((item) => defenders.has(item.entityId) && item.mission !== 'reserve').reduce((sum, item) => sum + formationPower(item), 0);
  const total = attackerScore + defenderScore;
  const state: AirTheaterControl['state'] = total < 8 ? 'limited' : attackerScore > defenderScore * 1.35 ? 'attacker-dominant' : defenderScore > attackerScore * 1.35 ? 'defender-dominant' : 'contested';
  return { warId, frontId: front.id, attackerScore, defenderScore, state };
}

export function setAirMission(formationId: string, mission: AirMission) {
  const state = rootState();
  const formation = state.formations.find((item) => item.id === formationId);
  if (!formation) return false;
  publish({ ...state, formations: state.formations.map((item) => item.id === formationId ? { ...item, mission } : item) });
  return true;
}

export function processAirCampaign(simulation: SimulationState, warState: WarState, armyState: ArmyState) {
  let state = rootState();
  for (const entityId of Object.keys(simulation.entities)) state = ensureAirForces(state, entityId, simulation);
  let changed = false;
  let nextArmy: ArmyState = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  const formations = state.formations.map((formation) => {
    const days = Math.max(0, simulation.elapsedDays - formation.lastProcessedElapsedDay);
    if (!days) return formation;
    changed = true;
    const enemies = activeWarEnemies(formation.entityId, warState);
    const active = formation.mission !== 'reserve';
    let readiness = formation.readiness + days * (active ? -.025 : .045);
    let supply = formation.supply + days * (active ? -.038 : .05);
    let strength = formation.strength;
    let experience = formation.experience + (active && enemies.size ? days * .008 : 0);
    if (active && enemies.size && supply < 35) readiness -= days * .018;
    if (active && enemies.size && readiness < 28 && days >= 20) strength -= .8;
    return { ...formation, readiness: clamp(readiness), supply: clamp(supply), strength: clamp(strength), experience: clamp(experience), lastProcessedElapsedDay: simulation.elapsedDays };
  });
  const theaters = warState.wars.filter((war) => war.status === 'active').flatMap((war) => war.fronts.map((front) => frontControl(war.id, front, warState, formations)));

  for (const theater of theaters) {
    const war = warState.wars.find((item) => item.id === theater.warId);
    if (!war) continue;
    const attackerAir = theater.state === 'attacker-dominant';
    const defenderAir = theater.state === 'defender-dominant';
    if (!attackerAir && !defenderAir) continue;
    const advantaged = new Set(attackerAir ? war.attackers : war.defenders);
    const disadvantaged = new Set(attackerAir ? war.defenders : war.attackers);
    nextArmy = {
      ...nextArmy,
      units: nextArmy.units.map((unit) => {
        if (advantaged.has(unit.entityId)) return { ...unit, organization: clamp(unit.organization + .35), morale: clamp(unit.morale + .15) };
        if (disadvantaged.has(unit.entityId)) return { ...unit, supply: clamp(unit.supply - .45), organization: clamp(unit.organization - .28) };
        return unit;
      }),
    };
  }

  const root = globalThis as AirGlobal;
  const naval = root.__WORLD_STATE_NAVAL_FORCES__;
  if (naval && theaters.some((theater) => theater.state === 'attacker-dominant' || theater.state === 'defender-dominant')) {
    const patrolByEntity = new Map<string, number>();
    for (const formation of formations.filter((item) => item.mission === 'maritime-patrol')) patrolByEntity.set(formation.entityId, (patrolByEntity.get(formation.entityId) ?? 0) + formationPower(formation));
    if (patrolByEntity.size) {
      root.__WORLD_STATE_NAVAL_FORCES__ = {
        ...naval,
        fleets: naval.fleets.map((fleet) => {
          const support = patrolByEntity.get(fleet.entityId) ?? 0;
          if (!support || fleet.mission === 'harbor') return fleet;
          return { ...fleet, readiness: clamp(fleet.readiness + Math.min(.5, support / 180)) };
        }),
      };
    }
  }

  if (changed || theaters.length !== state.theaters.length) publish({ formations, theaters });
  return { armyState: nextArmy, changed };
}

export function airFormationsForEntity(entityId: string) { return rootState().formations.filter((item) => item.entityId === entityId).map((item) => ({ ...item })); }
export function airControlForFront(warId: string, frontId: string) { return rootState().theaters.find((item) => item.warId === warId && item.frontId === frontId); }
