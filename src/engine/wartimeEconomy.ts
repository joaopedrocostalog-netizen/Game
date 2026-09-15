import type { ArmyState } from './army';
import type { MilitaryIndustryState } from './militaryIndustry';
import type { SimulationState } from './simulation';
import type { StrategicInfrastructureState, StrategicInfrastructureType } from './strategicInfrastructure';
import type { WarState } from './war';

export type EconomicMobilization = 'civilian' | 'balanced' | 'war' | 'maximum';
export type RationingLevel = 'none' | 'moderate' | 'strict';
export type ReconstructionPriority = 'balanced' | 'industry' | 'logistics' | 'energy' | 'command';

export type WartimeEconomyProfile = {
  entityId: string;
  mobilization: EconomicMobilization;
  rationing: RationingLevel;
  reconstructionPriority: ReconstructionPriority;
  conversion: number;
  civilianStrain: number;
  warFatigue: number;
  reconstructionEffort: number;
  lastProcessedElapsedDay: number;
};

export type WartimeEconomyState = { profiles: Record<string, WartimeEconomyProfile> };

type Root = typeof globalThis & {
  __WORLD_STATE_WARTIME_ECONOMY__?: WartimeEconomyState;
  __WORLD_STATE_MILITARY_INDUSTRY__?: MilitaryIndustryState;
  __WORLD_STATE_STRATEGIC_INFRASTRUCTURE__?: StrategicInfrastructureState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): WartimeEconomyState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_WARTIME_ECONOMY__) root.__WORLD_STATE_WARTIME_ECONOMY__ = { profiles: {} };
  return root.__WORLD_STATE_WARTIME_ECONOMY__;
}
function publish(state: WartimeEconomyState) {
  (globalThis as Root).__WORLD_STATE_WARTIME_ECONOMY__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-wartime-economy', { detail: state }));
}
export function resetWartimeEconomy() { publish({ profiles: {} }); }

function initialProfile(entityId: string, simulation: SimulationState): WartimeEconomyProfile {
  return { entityId, mobilization: 'civilian', rationing: 'none', reconstructionPriority: 'balanced', conversion: 8, civilianStrain: 4, warFatigue: 0, reconstructionEffort: 18, lastProcessedElapsedDay: simulation.elapsedDays };
}
function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation);
  publish({ profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}
export function wartimeEconomyFor(entityId: string, simulation: SimulationState) { return { ...ensureProfile(entityId, simulation) }; }

export function wartimeEconomyEraLabel(year: number) {
  if (year < 1700) return 'Requisição extraordinária, oficinas e aprovisionamento';
  if (year < 1850) return 'Mobilização fiscal, manufatureira e logística';
  if (year < 1914) return 'Mobilização industrial e financeira';
  if (year < 1945) return 'Economia de guerra e conversão industrial';
  return 'Mobilização econômica e base industrial nacional';
}
export function mobilizationLabel(level: EconomicMobilization, year: number) {
  if (year < 1850) {
    if (level === 'civilian') return 'Administração ordinária';
    if (level === 'balanced') return 'Requisição limitada';
    if (level === 'war') return 'Mobilização extraordinária';
    return 'Esforço máximo do Estado';
  }
  if (level === 'civilian') return 'Economia civil';
  if (level === 'balanced') return 'Mobilização seletiva';
  if (level === 'war') return 'Economia de guerra';
  return 'Mobilização econômica máxima';
}
export function rationingLabel(level: RationingLevel, year: number) {
  if (year < 1850) return level === 'none' ? 'Sem restrições extraordinárias' : level === 'moderate' ? 'Controle de provisões' : 'Racionamento e requisição severos';
  return level === 'none' ? 'Sem racionamento' : level === 'moderate' ? 'Racionamento moderado' : 'Racionamento estrito';
}

function mobilizationTarget(level: EconomicMobilization) { return level === 'civilian' ? 8 : level === 'balanced' ? 32 : level === 'war' ? 62 : 86; }
function mobilizationMilitaryFactor(level: EconomicMobilization) { return level === 'civilian' ? .92 : level === 'balanced' ? 1.04 : level === 'war' ? 1.18 : 1.32; }
function rationingMilitaryFactor(level: RationingLevel) { return level === 'strict' ? 1.11 : level === 'moderate' ? 1.05 : 1; }
function rationingStrain(level: RationingLevel) { return level === 'strict' ? .05 : level === 'moderate' ? .022 : -.015; }
function priorityTypes(priority: ReconstructionPriority): StrategicInfrastructureType[] {
  if (priority === 'industry') return ['industry'];
  if (priority === 'logistics') return ['transport', 'depot', 'port'];
  if (priority === 'energy') return ['energy'];
  if (priority === 'command') return ['command', 'communications'];
  return ['industry', 'transport', 'energy', 'depot', 'port', 'command', 'communications'];
}

export function setEconomicMobilization(entityId: string, level: EconomicMobilization, simulation: SimulationState) {
  const state = rootState(); const profile = ensureProfile(entityId, simulation);
  publish({ profiles: { ...state.profiles, [entityId]: { ...profile, mobilization: level } } });
}
export function setRationing(entityId: string, level: RationingLevel, simulation: SimulationState) {
  const state = rootState(); const profile = ensureProfile(entityId, simulation);
  publish({ profiles: { ...state.profiles, [entityId]: { ...profile, rationing: level } } });
}
export function setReconstructionPriority(entityId: string, priority: ReconstructionPriority, simulation: SimulationState) {
  const state = rootState(); const profile = ensureProfile(entityId, simulation);
  publish({ profiles: { ...state.profiles, [entityId]: { ...profile, reconstructionPriority: priority } } });
}

export function wartimeEconomyModifiers(entityId: string, simulation: SimulationState) {
  const profile = ensureProfile(entityId, simulation);
  const military = mobilizationMilitaryFactor(profile.mobilization) * rationingMilitaryFactor(profile.rationing);
  const civilian = clamp(105 - profile.conversion * .48 - profile.civilianStrain * .28, 48, 105) / 100;
  const reconstruction = clamp(70 + profile.reconstructionEffort * .45 + profile.conversion * .18, 70, 135) / 100;
  return { military, civilian, reconstruction, conversion: profile.conversion, strain: profile.civilianStrain, fatigue: profile.warFatigue };
}

function processInfrastructure(entityId: string, profile: WartimeEconomyProfile, days: number) {
  const root = globalThis as Root;
  const infrastructure = root.__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__;
  if (!infrastructure || days <= 0) return;
  const preferred = new Set(priorityTypes(profile.reconstructionPriority));
  const multiplier = profile.reconstructionPriority === 'balanced' ? 1 : 1.55;
  const nodes = { ...infrastructure.nodes };
  let changed = false;
  for (const [id, node] of Object.entries(nodes)) {
    if (node.entityId !== entityId || node.integrity >= 100) continue;
    const priorityFactor = preferred.has(node.type) ? multiplier : .78;
    const repair = days * node.repairRate * .0014 * (0.75 + profile.reconstructionEffort / 100) * priorityFactor;
    if (repair <= 0) continue;
    const integrity = clamp(node.integrity + repair);
    nodes[id] = { ...node, integrity, condition: integrity < 25 ? 'critical' : integrity < 50 ? 'damaged' : integrity < 75 ? 'strained' : 'operational', lastProcessedElapsedDay: Math.max(node.lastProcessedElapsedDay, profile.lastProcessedElapsedDay + days) };
    changed = true;
  }
  if (changed) root.__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__ = { ...infrastructure, nodes };
}

function processIndustry(entityId: string, profile: WartimeEconomyProfile, days: number) {
  const root = globalThis as Root;
  const industry = root.__WORLD_STATE_MILITARY_INDUSTRY__;
  const current = industry?.profiles?.[entityId];
  if (!industry || !current || days <= 0) return;
  const factor = mobilizationMilitaryFactor(profile.mobilization) * rationingMilitaryFactor(profile.rationing);
  const conversionBoost = profile.conversion / 100;
  const armamentsGain = days * Math.max(0, factor - .9) * current.armamentsCapacity * (0.00032 + conversionBoost * .00012);
  const supplyGain = days * Math.max(0, factor - .9) * current.supplyCapacity * (0.00038 + conversionBoost * .0001);
  root.__WORLD_STATE_MILITARY_INDUSTRY__ = {
    ...industry,
    profiles: { ...industry.profiles, [entityId]: {
      ...current,
      armamentsStockpile: clamp(current.armamentsStockpile + armamentsGain),
      supplyStockpile: clamp(current.supplyStockpile + supplyGain),
      replacementEfficiency: clamp(current.replacementEfficiency + days * Math.max(0, factor - 1) * .006),
    } },
  };
}

export function processWartimeEconomy(simulation: SimulationState, warState: WarState, armyState: ArmyState) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let entities = { ...simulation.entities };
  let units = armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } }));
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    const current = profiles[entityId] ?? initialProfile(entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - current.lastProcessedElapsedDay);
    if (!days) { profiles[entityId] = current; continue; }
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const runtime = entities[entityId];
    if (!runtime) continue;
    const target = mobilizationTarget(current.mobilization);
    const rate = Math.min(1, days / (simulation.date.year < 1850 ? 210 : simulation.date.year < 1945 ? 120 : 80));
    const conversion = clamp(current.conversion + (target - current.conversion) * rate);
    const mobilizationPressure = Math.max(0, conversion - 20) / 100;
    let civilianStrain = clamp(current.civilianStrain + days * (mobilizationPressure * .035 + rationingStrain(current.rationing) + (atWar ? .012 : -.028)));
    let warFatigue = clamp(current.warFatigue + days * (atWar ? (.018 + mobilizationPressure * .02) : -.035));
    const damaged = (globalThis as Root).__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__;
    const ownNodes = damaged ? Object.values(damaged.nodes).filter((node) => node.entityId === entityId) : [];
    const avgIntegrity = ownNodes.length ? ownNodes.reduce((sum, node) => sum + node.integrity, 0) / ownNodes.length : 100;
    const reconstructionNeed = Math.max(0, 100 - avgIntegrity);
    const reconstructionEffort = clamp(18 + reconstructionNeed * .55 + (current.reconstructionPriority === 'balanced' ? 0 : 12) + (atWar ? -5 : 8));

    const militaryFactor = mobilizationMilitaryFactor(current.mobilization) * rationingMilitaryFactor(current.rationing);
    const civilPenalty = mobilizationPressure * .016 + civilianStrain / 100 * .008 + (current.rationing === 'strict' ? .004 : 0);
    const peaceRecovery = atWar ? 0 : Math.max(0, (100 - runtime.economyIndex) * .0007 + reconstructionEffort * .00016);
    const economyIndex = clamp(runtime.economyIndex + days * (peaceRecovery - civilPenalty));
    const stabilityDrain = Math.max(0, civilianStrain - 48) / 100 * .012 + Math.max(0, warFatigue - 58) / 100 * .01;
    const stabilityRecovery = !atWar && civilianStrain < 35 ? .0035 : 0;
    const stability = clamp(runtime.stability + days * (stabilityRecovery - stabilityDrain));
    const treasuryCost = Math.max(0, militaryFactor - .94) * .006 + reconstructionEffort / 100 * reconstructionNeed / 100 * .003;
    const treasuryIndex = clamp(runtime.treasuryIndex - days * treasuryCost + (!atWar && current.mobilization === 'civilian' ? days * .003 : 0));
    entities[entityId] = { ...runtime, economyIndex, stability, treasuryIndex };

    if (atWar && militaryFactor > 1) units = units.map((unit) => unit.entityId !== entityId ? unit : {
      ...unit,
      supply: clamp(unit.supply + days * Math.min(.022, (militaryFactor - 1) * .028)),
      equipment: clamp(unit.equipment + days * Math.min(.015, (militaryFactor - 1) * .018)),
    });

    const profile: WartimeEconomyProfile = { ...current, conversion, civilianStrain, warFatigue, reconstructionEffort, lastProcessedElapsedDay: simulation.elapsedDays };
    profiles[entityId] = profile;
    processIndustry(entityId, profile, days);
    processInfrastructure(entityId, profile, days);
    changed = true;
  }

  if (changed) publish({ profiles });
  return { simulation: { ...simulation, entities }, armyState: { ...armyState, units }, changed };
}
