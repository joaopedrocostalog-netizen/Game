import type { AirMission } from './airCampaign';
import type { SimulationState, WorldEvent } from './simulation';

export type AirDoctrineSchool = 'balanced' | 'air-defense' | 'air-superiority' | 'tactical-support' | 'interdiction' | 'maritime-aviation' | 'air-mobility';

export type AirDoctrineProfile = {
  entityId: string;
  school: AirDoctrineSchool;
  mastery: number;
  flexibility: number;
  jointIntegration: number;
  adoptedAtElapsedDay: number;
  lastProcessedElapsedDay: number;
};

export type AirDoctrineState = { profiles: Record<string, AirDoctrineProfile> };
type AirDoctrineGlobal = typeof globalThis & { __WORLD_STATE_AIR_DOCTRINE__?: AirDoctrineState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirDoctrineState {
  const root = globalThis as AirDoctrineGlobal;
  if (!root.__WORLD_STATE_AIR_DOCTRINE__) root.__WORLD_STATE_AIR_DOCTRINE__ = { profiles: {} };
  return root.__WORLD_STATE_AIR_DOCTRINE__;
}
function publish(state: AirDoctrineState) {
  (globalThis as AirDoctrineGlobal).__WORLD_STATE_AIR_DOCTRINE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-doctrine', { detail: state }));
}
export function resetAirDoctrine() { publish({ profiles: {} }); }

export function doctrineAvailable(year: number, school: AirDoctrineSchool) {
  if (year < 1794) return false;
  if (year < 1903) return school === 'balanced' || school === 'air-defense';
  if (year < 1914) return ['balanced', 'air-defense', 'air-superiority', 'tactical-support'].includes(school);
  if (year < 1930) return school !== 'air-mobility';
  return true;
}

export function doctrineLabel(school: AirDoctrineSchool, year: number) {
  if (school === 'balanced') return year < 1914 ? 'Observação e cooperação geral' : 'Emprego aéreo equilibrado';
  if (school === 'air-defense') return year < 1914 ? 'Proteção do espaço de observação' : 'Defesa do espaço aéreo';
  if (school === 'air-superiority') return year < 1914 ? 'Controle da observação aérea' : 'Superioridade aérea';
  if (school === 'tactical-support') return year < 1914 ? 'Cooperação aérea com o exército' : 'Apoio aéreo tático';
  if (school === 'interdiction') return year < 1945 ? 'Ataque às comunicações operacionais' : 'Interdição e profundidade operacional';
  if (school === 'maritime-aviation') return year < 1945 ? 'Aviação de patrulha naval' : 'Aviação marítima e naval integrada';
  return year < 1945 ? 'Transporte aéreo operacional' : 'Mobilidade e transporte aéreo';
}

function initialProfile(entityId: string, simulation: SimulationState): AirDoctrineProfile {
  const runtime = simulation.entities[entityId];
  return {
    entityId,
    school: 'balanced',
    mastery: clamp(28 + (runtime?.militaryReadiness ?? 35) * .32 + (runtime?.technology ?? 35) * .2),
    flexibility: clamp(30 + (runtime?.technology ?? 35) * .35),
    jointIntegration: clamp(24 + (runtime?.militaryReadiness ?? 35) * .28 + (runtime?.technology ?? 35) * .18),
    adoptedAtElapsedDay: simulation.elapsedDays,
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
}

function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation);
  publish({ profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}

export function airDoctrineFor(entityId: string, simulation: SimulationState) { return { ...ensureProfile(entityId, simulation) }; }

export function adoptAirDoctrine(entityId: string, school: AirDoctrineSchool, simulation: SimulationState) {
  if (!doctrineAvailable(simulation.date.year, school)) return { simulation, error: 'Essa escola doutrinária ainda não é compatível com a época.' };
  const runtime = simulation.entities[entityId];
  if (!runtime) return { simulation, error: 'Entidade não encontrada.' };
  const state = rootState();
  const current = ensureProfile(entityId, simulation);
  if (current.school === school) return { simulation, error: 'Essa doutrina já está em vigor.' };
  const cost = Math.round(4 + current.mastery * .035 + (school === 'balanced' ? 0 : 2));
  if (runtime.treasuryIndex < cost + 5) return { simulation, error: 'Capacidade financeira insuficiente para reorganizar treinamento e comando aéreo.' };
  const next: AirDoctrineProfile = {
    ...current,
    school,
    mastery: clamp(current.mastery * .58, 18, 62),
    flexibility: clamp(current.flexibility + (school === 'balanced' ? 4 : -2)),
    adoptedAtElapsedDay: simulation.elapsedDays,
    lastProcessedElapsedDay: simulation.elapsedDays,
  };
  const event: WorldEvent = {
    id: `air-doctrine-${entityId}-${school}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId,
    category: 'military',
    title: 'Doutrina aérea reorganizada',
    text: 'Treinamento, comando e emprego das formações aéreas foram reorganizados. A proficiência cairá temporariamente até a nova escola ser absorvida.',
  };
  publish({ profiles: { ...state.profiles, [entityId]: next } });
  return {
    simulation: {
      ...simulation,
      entities: { ...simulation.entities, [entityId]: { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - cost) } },
      events: [event, ...simulation.events].slice(0, 50),
    },
    profile: next,
  };
}

export function processAirDoctrine(simulation: SimulationState) {
  const state = rootState();
  const profiles = { ...state.profiles };
  let changed = false;
  for (const entityId of Object.keys(simulation.entities)) {
    const previous = profiles[entityId] ?? initialProfile(entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - previous.lastProcessedElapsedDay);
    if (!days) { profiles[entityId] = previous; continue; }
    const runtime = simulation.entities[entityId];
    const masteryGain = days * (.006 + (runtime.technology + runtime.militaryReadiness) / 45000);
    const integrationGain = days * (previous.school === 'tactical-support' || previous.school === 'maritime-aviation' || previous.school === 'air-mobility' ? .006 : .0025);
    profiles[entityId] = {
      ...previous,
      mastery: clamp(previous.mastery + masteryGain),
      flexibility: clamp(previous.flexibility + days * .0015),
      jointIntegration: clamp(previous.jointIntegration + integrationGain),
      lastProcessedElapsedDay: simulation.elapsedDays,
    };
    changed = true;
  }
  if (changed) publish({ profiles });
  return { changed };
}

function preferredMission(school: AirDoctrineSchool, mission: AirMission) {
  if (school === 'balanced') return .02;
  if (school === 'air-defense') return mission === 'air-superiority' || mission === 'reconnaissance' ? .14 : mission === 'air-transport' ? -.06 : -.02;
  if (school === 'air-superiority') return mission === 'air-superiority' ? .18 : mission === 'reconnaissance' ? .06 : -.035;
  if (school === 'tactical-support') return mission === 'ground-support' ? .18 : mission === 'reconnaissance' ? .08 : mission === 'interdiction' ? .05 : -.035;
  if (school === 'interdiction') return mission === 'interdiction' ? .2 : mission === 'reconnaissance' ? .06 : mission === 'ground-support' ? .03 : -.04;
  if (school === 'maritime-aviation') return mission === 'maritime-patrol' ? .2 : mission === 'reconnaissance' ? .05 : -.045;
  return mission === 'air-transport' ? .22 : mission === 'reconnaissance' ? .04 : -.05;
}

export function airDoctrineMissionModifier(entityId: string, mission: AirMission, simulation: SimulationState) {
  const profile = airDoctrineFor(entityId, simulation);
  const specialization = preferredMission(profile.school, mission);
  const mastery = (profile.mastery - 50) / 500;
  const flexibilityPenalty = specialization < 0 ? (100 - profile.flexibility) / 900 : 0;
  return clamp(1 + specialization + mastery - flexibilityPenalty, .82, 1.26);
}

export function airDoctrineSupport(entityId: string, simulation: SimulationState) {
  const profile = airDoctrineFor(entityId, simulation);
  return {
    ...profile,
    combatCoordination: clamp(profile.mastery * .58 + profile.jointIntegration * .3 + profile.flexibility * .12),
  };
}
