import type { ArmyState } from './army';
import type { SimulationState, WorldEvent } from './simulation';
import { wartimeEconomyFor } from './wartimeEconomy';
import type { WarState } from './war';

export type PublicCommunicationPolicy = 'restrained' | 'balanced' | 'mobilizing';
export type PoliticalWarCondition = 'stable' | 'strained' | 'restless' | 'crisis';

export type NationalMoraleProfile = {
  entityId: string;
  popularMorale: number;
  warSupport: number;
  authorityConfidence: number;
  eliteSupport: number;
  peacePressure: number;
  protestPressure: number;
  casualtyBurden: number;
  communicationPolicy: PublicCommunicationPolicy;
  condition: PoliticalWarCondition;
  previousPersonnel: number;
  lastProcessedElapsedDay: number;
  lastCrisisEventElapsedDay: number;
};

export type NationalMoraleState = { profiles: Record<string, NationalMoraleProfile> };

type Root = typeof globalThis & { __WORLD_STATE_NATIONAL_MORALE__?: NationalMoraleState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): NationalMoraleState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_NATIONAL_MORALE__) root.__WORLD_STATE_NATIONAL_MORALE__ = { profiles: {} };
  return root.__WORLD_STATE_NATIONAL_MORALE__;
}
function publish(state: NationalMoraleState) {
  (globalThis as Root).__WORLD_STATE_NATIONAL_MORALE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-national-morale', { detail: state }));
}
export function resetNationalMorale() { publish({ profiles: {} }); }

function personnelFor(entityId: string, armyState: ArmyState) {
  return armyState.units.filter((unit) => unit.entityId === entityId).reduce((sum, unit) => sum + unit.personnel, 0);
}
function initialProfile(entityId: string, simulation: SimulationState, armyState?: ArmyState): NationalMoraleProfile {
  const runtime = simulation.entities[entityId];
  const stability = runtime?.stability ?? 50;
  return {
    entityId,
    popularMorale: clamp(42 + stability * .38),
    warSupport: clamp(35 + stability * .32),
    authorityConfidence: clamp(38 + stability * .48),
    eliteSupport: clamp(42 + (runtime?.treasuryIndex ?? 50) * .24 + stability * .2),
    peacePressure: 8,
    protestPressure: 5,
    casualtyBurden: 0,
    communicationPolicy: 'balanced',
    condition: 'stable',
    previousPersonnel: armyState ? personnelFor(entityId, armyState) : 0,
    lastProcessedElapsedDay: simulation.elapsedDays,
    lastCrisisEventElapsedDay: -9999,
  };
}
function ensureProfile(entityId: string, simulation: SimulationState, armyState?: ArmyState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation, armyState);
  publish({ profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}
export function nationalMoraleFor(entityId: string, simulation: SimulationState, armyState?: ArmyState) {
  return { ...ensureProfile(entityId, simulation, armyState) };
}

export function nationalMoraleEraLabel(year: number) {
  if (year < 1700) return 'Coesão do reino, autoridade e apoio dos corpos políticos';
  if (year < 1850) return 'Moral pública, autoridade e apoio das elites';
  if (year < 1914) return 'Opinião pública, instituições e coesão nacional';
  return 'Moral nacional, apoio à guerra e estabilidade política';
}
export function communicationPolicyLabel(policy: PublicCommunicationPolicy, year: number) {
  if (year < 1850) {
    if (policy === 'restrained') return 'Comunicação limitada da Coroa/Estado';
    if (policy === 'balanced') return 'Proclamações e comunicação regular';
    return 'Mobilização simbólica e proclamações intensivas';
  }
  if (policy === 'restrained') return 'Comunicação pública contida';
  if (policy === 'balanced') return 'Comunicação institucional equilibrada';
  return 'Campanha intensiva de mobilização pública';
}
export function politicalConditionLabel(condition: PoliticalWarCondition, year: number) {
  if (condition === 'stable') return year < 1850 ? 'ORDEM POLÍTICA ESTÁVEL' : 'SITUAÇÃO POLÍTICA ESTÁVEL';
  if (condition === 'strained') return 'PRESSÃO POLÍTICA CRESCENTE';
  if (condition === 'restless') return year < 1850 ? 'DESCONTENTAMENTO E FACÇÕES' : 'PROTESTOS E PRESSÃO POR MUDANÇA';
  return year < 1850 ? 'CRISE DE AUTORIDADE' : 'CRISE POLÍTICA';
}

function warPosition(entityId: string, warState: WarState) {
  let score = 0;
  let fronts = 0;
  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    const attacker = war.attackers.includes(entityId);
    const defender = war.defenders.includes(entityId);
    if (!attacker && !defender) continue;
    for (const front of war.fronts) {
      const progress = Math.max(-100, Math.min(100, front.progress ?? 0));
      score += attacker ? progress : -progress;
      fronts += 1;
    }
  }
  return fronts ? score / fronts : 0;
}
function policyEffects(policy: PublicCommunicationPolicy) {
  if (policy === 'restrained') return { support: -.004, confidence: .003, protest: -.002, strain: -.001 };
  if (policy === 'mobilizing') return { support: .012, confidence: .004, protest: .004, strain: .006 };
  return { support: .003, confidence: .002, protest: 0, strain: .001 };
}
function conditionFor(peacePressure: number, protestPressure: number, authorityConfidence: number): PoliticalWarCondition {
  const risk = peacePressure * .38 + protestPressure * .42 + (100 - authorityConfidence) * .2;
  if (risk >= 72) return 'crisis';
  if (risk >= 52) return 'restless';
  if (risk >= 34) return 'strained';
  return 'stable';
}

export function setPublicCommunicationPolicy(entityId: string, policy: PublicCommunicationPolicy, simulation: SimulationState, armyState?: ArmyState) {
  const state = rootState();
  const profile = ensureProfile(entityId, simulation, armyState);
  publish({ profiles: { ...state.profiles, [entityId]: { ...profile, communicationPolicy: policy } } });
}

export function processNationalMorale(simulation: SimulationState, warState: WarState, armyState: ArmyState) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let entities = { ...simulation.entities };
  let events = [...simulation.events];
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    const current = profiles[entityId] ?? initialProfile(entityId, simulation, armyState);
    const days = Math.max(0, simulation.elapsedDays - current.lastProcessedElapsedDay);
    if (!days) { profiles[entityId] = current; continue; }
    const runtime = entities[entityId];
    if (!runtime) continue;
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const economy = wartimeEconomyFor(entityId, simulation);
    const personnel = personnelFor(entityId, armyState);
    const personnelLoss = current.previousPersonnel > 0 ? Math.max(0, current.previousPersonnel - personnel) : 0;
    const lossRatio = current.previousPersonnel > 0 ? personnelLoss / current.previousPersonnel : 0;
    const casualtyShock = Math.min(18, lossRatio * 180);
    const position = warPosition(entityId, warState);
    const battlefieldMood = Math.max(-1, Math.min(1, position / 55));
    const policy = policyEffects(current.communicationPolicy);
    const strain = economy.civilianStrain;
    const fatigue = economy.warFatigue;

    let casualtyBurden = clamp(current.casualtyBurden + casualtyShock + (atWar ? days * .006 : -days * .018));
    let popularMorale = current.popularMorale + days * (atWar ? battlefieldMood * .011 - fatigue * .00022 - strain * .00017 : .014) - casualtyShock * .65;
    let warSupport = current.warSupport + days * (atWar ? battlefieldMood * .014 - fatigue * .0003 - strain * .00018 + policy.support : .02) - casualtyShock * .8;
    let authorityConfidence = current.authorityConfidence + days * (battlefieldMood * .006 - Math.max(0, strain - 45) * .00016 + policy.confidence + (atWar ? 0 : .006)) - casualtyShock * .28;
    let eliteSupport = current.eliteSupport + days * (battlefieldMood * .007 - Math.max(0, economy.conversion - 55) * .00012 - Math.max(0, 42 - runtime.treasuryIndex) * .00018 + (atWar ? -.001 : .004));
    let peacePressure = current.peacePressure + days * (atWar ? .006 + fatigue * .00035 + casualtyBurden * .00028 + Math.max(0, -battlefieldMood) * .018 : -.035) - Math.max(0, battlefieldMood) * days * .007;
    let protestPressure = current.protestPressure + days * (Math.max(0, strain - 38) * .00028 + Math.max(0, fatigue - 48) * .0002 + Math.max(0, 45 - authorityConfidence) * .00022 + policy.protest - (atWar ? 0 : .012));

    popularMorale = clamp(popularMorale); warSupport = clamp(warSupport); authorityConfidence = clamp(authorityConfidence); eliteSupport = clamp(eliteSupport); peacePressure = clamp(peacePressure); protestPressure = clamp(protestPressure);
    const condition = conditionFor(peacePressure, protestPressure, authorityConfidence);
    const politicalDrain = condition === 'crisis' ? .012 : condition === 'restless' ? .006 : condition === 'strained' ? .002 : 0;
    const stability = clamp(runtime.stability - days * politicalDrain + (!atWar && condition === 'stable' ? days * .003 : 0));
    entities[entityId] = { ...runtime, stability };

    let lastCrisisEventElapsedDay = current.lastCrisisEventElapsedDay;
    if ((condition === 'crisis' || condition === 'restless') && simulation.elapsedDays - lastCrisisEventElapsedDay >= 45) {
      const event: WorldEvent = {
        id: `national-morale-${entityId}-${simulation.elapsedDays}`,
        date: simulation.date,
        entityId,
        category: 'politics',
        title: condition === 'crisis' ? 'Crise política ligada ao esforço de guerra' : 'Pressão interna sobre a condução da guerra',
        text: condition === 'crisis'
          ? 'O desgaste social, as perdas e a pressão por paz estão comprometendo a autoridade e a coesão política do Estado.'
          : 'Grupos sociais e políticos aumentam a pressão sobre o governo para rever custos, objetivos e duração do conflito.',
      };
      events = [event, ...events].slice(0, 50);
      lastCrisisEventElapsedDay = simulation.elapsedDays;
    }

    profiles[entityId] = { ...current, popularMorale, warSupport, authorityConfidence, eliteSupport, peacePressure, protestPressure, casualtyBurden, condition, previousPersonnel: personnel, lastProcessedElapsedDay: simulation.elapsedDays, lastCrisisEventElapsedDay };
    changed = true;
  }

  if (changed) publish({ profiles });
  return { simulation: { ...simulation, entities, events }, changed };
}
