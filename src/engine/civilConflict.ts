import { locationsForEntity, type ResolvedLocation } from '../data/territories';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState, ArmyUnit } from './army';
import { nationalMoraleFor } from './nationalMorale';
import type { SimulationState, StrategicAIState, WorldEvent } from './simulation';
import type { TerritorialControlState, OccupationState } from './territorialControl';
import type { FrontState, War, WarState } from './war';
import { warPoliticsFor } from './warPolitics';

export type CivilFactionGoal = 'autonomy' | 'independence' | 'government' | 'regime';
export type CivilConflictStatus = 'latent' | 'active' | 'suppressed' | 'victorious' | 'negotiated';

export type RegionalLoyalty = {
  entityId: string;
  locationId: string;
  loyalty: number;
  dissent: number;
  lastProcessedElapsedDay: number;
};

export type CivilFaction = {
  id: string;
  parentEntityId: string;
  name: string;
  goal: CivilFactionGoal;
  capitalLocationId: string;
  controlledLocationIds: string[];
  support: number;
  cohesion: number;
  militaryCapacity: number;
  createdAtElapsedDay: number;
  status: CivilConflictStatus;
  warId?: string;
};

export type CivilConflictState = {
  loyalties: Record<string, RegionalLoyalty>;
  factions: Record<string, CivilFaction>;
  lastBreakawayByEntity: Record<string, number>;
};

type Root = typeof globalThis & { __WORLD_STATE_CIVIL_CONFLICT__?: CivilConflictState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function hash(text: string) { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return Math.abs(h >>> 0); }
function rootState(): CivilConflictState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_CIVIL_CONFLICT__) root.__WORLD_STATE_CIVIL_CONFLICT__ = { loyalties: {}, factions: {}, lastBreakawayByEntity: {} };
  return root.__WORLD_STATE_CIVIL_CONFLICT__;
}
function publish(state: CivilConflictState) {
  (globalThis as Root).__WORLD_STATE_CIVIL_CONFLICT__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-civil-conflict', { detail: state }));
}
export function resetCivilConflict() { publish({ loyalties: {}, factions: {}, lastBreakawayByEntity: {} }); }
export function civilConflictState() {
  const state = rootState();
  return {
    loyalties: Object.fromEntries(Object.entries(state.loyalties).map(([id, item]) => [id, { ...item }])),
    factions: Object.fromEntries(Object.entries(state.factions).map(([id, item]) => [id, { ...item, controlledLocationIds: [...item.controlledLocationIds] }])),
    lastBreakawayByEntity: { ...state.lastBreakawayByEntity },
  };
}

function locationKey(entityId: string, locationId: string) { return `${entityId}:${locationId}`; }
function factionLabel(parent: ScenarioEntity | undefined, location: ResolvedLocation, year: number) {
  const base = location.name;
  if (year < 1700) return `Liga de ${base}`;
  if (year < 1850) return `Junta de ${base}`;
  if (year < 1914) return `Movimento de ${base}`;
  if (year < 1945) return `Administração dissidente de ${base}`;
  return `Autoridade dissidente de ${base}${parent?.name ? ` — ${parent.name}` : ''}`;
}
function goalFor(parent: ScenarioEntity | undefined, politics: ReturnType<typeof warPoliticsFor>, morale: ReturnType<typeof nationalMoraleFor>): CivilFactionGoal {
  const text = `${parent?.government ?? ''} ${parent?.type ?? ''}`.toLowerCase();
  if (politics.politicalOrder === 'regime-transition' && morale.authorityConfidence < 22) return 'regime';
  if (/império|empire|federa|confedera|união|union|sultan/.test(text)) return politics.fragmentationPressure > 82 ? 'independence' : 'autonomy';
  return politics.crisisScore > 90 ? 'government' : 'autonomy';
}
function goalLabel(goal: CivilFactionGoal, year: number) {
  if (goal === 'independence') return 'separação política';
  if (goal === 'autonomy') return year < 1850 ? 'autonomia regional e garantias políticas' : 'autonomia regional';
  if (goal === 'regime') return year < 1850 ? 'substituição da ordem dinástica/política' : 'mudança de regime';
  return year < 1850 ? 'substituição da autoridade central' : 'mudança de governo';
}
export function civilFactionGoalLabel(goal: CivilFactionGoal, year: number) { return goalLabel(goal, year); }

function ensureLoyalties(simulation: SimulationState, entities: ScenarioEntity[], existing: Record<string, RegionalLoyalty>) {
  const loyalties = { ...existing };
  for (const entityId of Object.keys(simulation.entities)) {
    if (entityId.includes('-civil-')) continue;
    const runtime = simulation.entities[entityId];
    if (!runtime) continue;
    const politics = warPoliticsFor(entityId, simulation);
    const morale = nationalMoraleFor(entityId, simulation);
    for (const location of locationsForEntity(entityId, simulation.date.year)) {
      const key = locationKey(entityId, location.id);
      const prior = loyalties[key];
      if (prior) continue;
      const seed = hash(key);
      const capitalBonus = location.kind === 'capital' ? 18 : 0;
      const base = clamp(72 + capitalBonus + runtime.stability * .12 - politics.fragmentationPressure * .22 + (seed % 15) - 7);
      loyalties[key] = { entityId, locationId: location.id, loyalty: base, dissent: clamp(100 - base + morale.protestPressure * .16), lastProcessedElapsedDay: simulation.elapsedDays };
    }
  }
  return loyalties;
}

function updateLoyalties(simulation: SimulationState, loyalties: Record<string, RegionalLoyalty>) {
  const next = { ...loyalties };
  for (const [key, item] of Object.entries(next)) {
    const runtime = simulation.entities[item.entityId];
    if (!runtime) continue;
    const politics = warPoliticsFor(item.entityId, simulation);
    const morale = nationalMoraleFor(item.entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - item.lastProcessedElapsedDay);
    if (!days) continue;
    const pressure = politics.fragmentationPressure * .00055 + politics.crisisScore * .00028 + morale.protestPressure * .00024 + Math.max(0, 35 - runtime.stability) * .00038;
    const recovery = politics.crisisScore < 35 && runtime.stability > 55 ? .018 : politics.crisisScore < 55 ? .006 : 0;
    const loyalty = clamp(item.loyalty + days * (recovery - pressure));
    const dissent = clamp(100 - loyalty + politics.fragmentationPressure * .14 + morale.protestPressure * .1);
    next[key] = { ...item, loyalty, dissent, lastProcessedElapsedDay: simulation.elapsedDays };
  }
  return next;
}

function activeFactionForParent(factions: Record<string, CivilFaction>, entityId: string) {
  return Object.values(factions).find((faction) => faction.parentEntityId === entityId && faction.status === 'active');
}
function candidateLocation(entityId: string, simulation: SimulationState, loyalties: Record<string, RegionalLoyalty>) {
  const locations = locationsForEntity(entityId, simulation.date.year);
  if (locations.length < 2) return undefined;
  const ranked = locations.map((location) => ({ location, loyalty: loyalties[locationKey(entityId, location.id)]?.loyalty ?? 100 }))
    .sort((a, b) => a.loyalty - b.loyalty);
  return ranked.find((item) => item.location.kind !== 'capital') ?? ranked[0];
}
function shouldBreakAway(entityId: string, simulation: SimulationState, loyalties: Record<string, RegionalLoyalty>, factions: Record<string, CivilFaction>, lastBreakaway: Record<string, number>) {
  if (activeFactionForParent(factions, entityId)) return false;
  if ((lastBreakaway[entityId] ?? -9999) + 240 > simulation.elapsedDays) return false;
  const runtime = simulation.entities[entityId];
  if (!runtime) return false;
  const politics = warPoliticsFor(entityId, simulation);
  const morale = nationalMoraleFor(entityId, simulation);
  const candidate = candidateLocation(entityId, simulation, loyalties);
  if (!candidate) return false;
  const severePolitics = politics.fragmentationPressure >= 66 && politics.crisisScore >= 72;
  const collapsingAuthority = runtime.stability <= 24 && morale.authorityConfidence <= 30;
  return candidate.loyalty <= 38 && severePolitics && collapsingAuthority;
}

function rebelRuntime(parentId: string, factionId: string, simulation: SimulationState) {
  const parent = simulation.entities[parentId];
  if (!parent) return undefined;
  return {
    id: factionId,
    populationIndex: clamp(parent.populationIndex * .34, 8, 55),
    economyIndex: clamp(parent.economyIndex * .42, 10, 58),
    stability: 44,
    militaryReadiness: clamp(parent.militaryReadiness * .66 + 8, 24, 72),
    technology: clamp(parent.technology * .94, 10, 100),
    treasuryIndex: clamp(parent.treasuryIndex * .3 + 12, 12, 55),
  };
}
function rebelAI(factionId: string, goal: CivilFactionGoal): StrategicAIState {
  return { entityId: factionId, focus: 'military', aggression: goal === 'independence' || goal === 'regime' ? 76 : 62, openness: 34, riskTolerance: 72, objective: goal === 'independence' ? 'Assegurar sobrevivência e reconhecimento da entidade emergente' : 'Impor uma nova relação política com a autoridade central', reviews: 0 };
}
function rebelUnit(parentId: string, factionId: string, location: ResolvedLocation, simulation: SimulationState): ArmyUnit {
  const parent = simulation.entities[parentId];
  const readiness = parent?.militaryReadiness ?? 50;
  const tech = parent?.technology ?? 50;
  const seed = hash(`${factionId}:${location.id}`);
  return {
    id: `${factionId}-army-1`, entityId: factionId, name: simulation.date.year < 1850 ? 'Força da facção regional' : 'Força dissidente principal', type: 'field-army',
    commander: { id: `${factionId}-cmd-1`, name: simulation.date.year < 1850 ? 'Comandante da facção' : 'Comando dissidente', skill: 42 + seed % 24, logistics: 34 + (seed >> 5) % 24, initiative: 48 + (seed >> 10) % 26 },
    locationId: location.id, order: 'hold', personnel: Math.round(5200 + readiness * 95), strength: clamp(readiness * .68 + tech * .12), morale: 64, organization: 52, supply: 48, equipment: clamp(tech * .55 + 24), movementProgress: 0,
  };
}
function civilFront(factionId: string, parentId: string, location: ResolvedLocation): FrontState {
  return {
    id: `front-civil-${factionId}-${location.id}`, name: `Frente interna — ${location.name}`, locationId: location.id, terrain: location.terrain,
    progress: 0, intensity: 38, attackerPower: 0, defenderPower: 0, attackerFormations: 1, defenderFormations: 0, attackerLogistics: 42, defenderLogistics: 50,
    operationalData: true, attackerPriority: 'main', defenderPriority: 'main', attackerOrder: 'defend', defenderOrder: 'offensive', attackerAssignments: [`${factionId}-army-1`], defenderAssignments: [],
  };
}
function civilWar(faction: CivilFaction, parentId: string, location: ResolvedLocation, simulation: SimulationState): War {
  return {
    id: `civil-war-${faction.id}`, name: `Conflito interno em ${location.name}`, attackerId: faction.id, defenderId: parentId, attackers: [faction.id], defenders: [parentId], goal: faction.goal === 'independence' ? 'independence' : faction.goal === 'regime' ? 'regime' : 'defense',
    startedAt: simulation.date, status: 'active', score: 0, attackerSupport: faction.support, defenderSupport: 62, attackerLosses: 0, defenderLosses: 0, elapsedDays: 0, fronts: [civilFront(faction.id, parentId, location)],
  };
}
function rebelOccupation(faction: CivilFaction, parentId: string, location: ResolvedLocation, simulation: SimulationState): OccupationState {
  return { locationId: location.id, ownerId: parentId, controllerId: faction.id, warId: faction.warId ?? `civil-war-${faction.id}`, progress: 100, contested: false, lastOutcome: 'attacker-advance', battleCount: 0, updatedAt: simulation.date };
}

function createBreakaway(entityId: string, simulation: SimulationState, armyState: ArmyState, warState: WarState, territorialControl: TerritorialControlState, entities: ScenarioEntity[], loyalties: Record<string, RegionalLoyalty>, factions: Record<string, CivilFaction>) {
  const candidate = candidateLocation(entityId, simulation, loyalties);
  const parent = entities.find((item) => item.id === entityId);
  if (!candidate) return undefined;
  const politics = warPoliticsFor(entityId, simulation);
  const morale = nationalMoraleFor(entityId, simulation, armyState);
  const location = candidate.location;
  const suffix = Math.floor(simulation.elapsedDays / 30);
  const factionId = `${entityId}-civil-${location.id.replace('loc-', '')}-${suffix}`;
  const goal = goalFor(parent, politics, morale);
  const faction: CivilFaction = {
    id: factionId, parentEntityId: entityId, name: factionLabel(parent, location, simulation.date.year), goal, capitalLocationId: location.id, controlledLocationIds: [location.id],
    support: clamp(46 + politics.fragmentationPressure * .28 + candidate.loyalty * -.18), cohesion: clamp(52 + politics.fragmentationPressure * .18), militaryCapacity: clamp(36 + politics.fragmentationPressure * .34),
    createdAtElapsedDay: simulation.elapsedDays, status: 'active', warId: `civil-war-${factionId}`,
  };
  const runtime = rebelRuntime(entityId, factionId, simulation);
  if (!runtime) return undefined;
  const event: WorldEvent = { id: `civil-conflict-${factionId}`, date: simulation.date, entityId, category: 'politics', title: `Ruptura interna em ${location.name}`, text: `${faction.name} rompeu com a autoridade central defendendo ${goalLabel(goal, simulation.date.year)}. O controle local e parte das forças disponíveis passaram à facção.` };
  const nextSimulation: SimulationState = { ...simulation, entities: { ...simulation.entities, [factionId]: runtime }, strategicAI: { ...simulation.strategicAI, [factionId]: rebelAI(factionId, goal) }, events: [event, ...simulation.events].slice(0, 50) };
  const nextArmy: ArmyState = { ...armyState, units: [...armyState.units, rebelUnit(entityId, factionId, location, simulation)] };
  const nextWar: WarState = { ...warState, wars: [...warState.wars, civilWar(faction, entityId, location, simulation)] };
  const occupation = rebelOccupation(faction, entityId, location, simulation);
  const nextControl: TerritorialControlState = { ...territorialControl, occupations: { ...territorialControl.occupations, [location.id]: occupation } };
  return { faction, simulation: nextSimulation, armyState: nextArmy, warState: nextWar, territorialControl: nextControl };
}

function reconcileFactionOutcomes(simulation: SimulationState, armyState: ArmyState, warState: WarState, territorialControl: TerritorialControlState, factions: Record<string, CivilFaction>) {
  let nextSimulation = simulation;
  let nextArmy = armyState;
  let nextControl = territorialControl;
  let nextFactions = { ...factions };
  let changed = false;
  for (const faction of Object.values(nextFactions)) {
    if (faction.status !== 'active' || !faction.warId) continue;
    const war = warState.wars.find((item) => item.id === faction.warId);
    if (!war || war.status === 'active') continue;
    const factionWon = war.victor === 'attackers';
    if (factionWon) {
      nextFactions[faction.id] = { ...faction, status: 'victorious' };
      const event: WorldEvent = { id: `civil-victory-${faction.id}-${simulation.elapsedDays}`, date: simulation.date, entityId: faction.id, category: 'politics', title: 'Facção interna consolida sua posição', text: faction.goal === 'independence' ? `${faction.name} sobreviveu ao conflito e passa a agir como entidade política emergente.` : `${faction.name} venceu a disputa interna e impôs uma nova correlação de poder.` };
      nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    } else {
      nextFactions[faction.id] = { ...faction, status: 'suppressed', controlledLocationIds: [] };
      nextArmy = { ...nextArmy, units: nextArmy.units.filter((unit) => unit.entityId !== faction.id) };
      const occupations = { ...nextControl.occupations };
      for (const [locationId, occupation] of Object.entries(occupations)) if (occupation.controllerId === faction.id) occupations[locationId] = { ...occupation, controllerId: faction.parentEntityId, progress: 0, contested: false, lastOutcome: 'defender-hold', updatedAt: simulation.date };
      nextControl = { ...nextControl, occupations };
      const event: WorldEvent = { id: `civil-suppressed-${faction.id}-${simulation.elapsedDays}`, date: simulation.date, entityId: faction.parentEntityId, category: 'politics', title: 'Ruptura interna suprimida', text: `${faction.name} perdeu sua capacidade militar organizada e o controle territorial retornou à autoridade central.` };
      nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    }
    changed = true;
  }
  return { simulation: nextSimulation, armyState: nextArmy, territorialControl: nextControl, factions: nextFactions, changed };
}

export function processCivilConflict(simulation: SimulationState, warState: WarState, armyState: ArmyState, territorialControl: TerritorialControlState, entities: ScenarioEntity[]) {
  const state = rootState();
  let loyalties = ensureLoyalties(simulation, entities, state.loyalties);
  loyalties = updateLoyalties(simulation, loyalties);
  let factions = { ...state.factions };
  let lastBreakawayByEntity = { ...state.lastBreakawayByEntity };
  let nextSimulation = simulation;
  let nextWarState = warState;
  let nextArmy = armyState;
  let nextControl = territorialControl;
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    if (entityId.includes('-civil-')) continue;
    if (!shouldBreakAway(entityId, simulation, loyalties, factions, lastBreakawayByEntity)) continue;
    const result = createBreakaway(entityId, nextSimulation, nextArmy, nextWarState, nextControl, entities, loyalties, factions);
    if (!result) continue;
    factions[result.faction.id] = result.faction;
    lastBreakawayByEntity[entityId] = simulation.elapsedDays;
    nextSimulation = result.simulation; nextArmy = result.armyState; nextWarState = result.warState; nextControl = result.territorialControl;
    changed = true;
  }

  const reconciled = reconcileFactionOutcomes(nextSimulation, nextArmy, nextWarState, nextControl, factions);
  nextSimulation = reconciled.simulation; nextArmy = reconciled.armyState; nextControl = reconciled.territorialControl; factions = reconciled.factions; changed = changed || reconciled.changed;

  const loyaltyChanged = Object.keys(loyalties).some((key) => loyalties[key]?.lastProcessedElapsedDay !== state.loyalties[key]?.lastProcessedElapsedDay);
  if (changed || loyaltyChanged || Object.keys(loyalties).length !== Object.keys(state.loyalties).length) publish({ loyalties, factions, lastBreakawayByEntity });
  return { simulation: nextSimulation, warState: nextWarState, armyState: nextArmy, territorialControl: nextControl, changed: changed || loyaltyChanged };
}

export function civilFactionsForParent(entityId: string) { return Object.values(rootState().factions).filter((faction) => faction.parentEntityId === entityId).map((faction) => ({ ...faction, controlledLocationIds: [...faction.controlledLocationIds] })); }
export function regionalLoyaltyForEntity(entityId: string) { return Object.values(rootState().loyalties).filter((item) => item.entityId === entityId).map((item) => ({ ...item })); }
