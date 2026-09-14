import { militaryIndustryFor } from './militaryIndustry';
import type { SimulationState, WorldEvent } from './simulation';
import type { WarState } from './war';

export type AirTechnologyStage = 'observation' | 'pioneer' | 'interwar' | 'industrial' | 'jet' | 'digital' | 'networked';
export type AirProgramType = 'production' | 'modernization' | 'pilot-training' | 'maintenance';
export type AirProgramStatus = 'active' | 'completed' | 'cancelled';

export type AirIndustrialProfile = {
  entityId: string;
  stage: AirTechnologyStage;
  productionCapacity: number;
  maintenanceCapacity: number;
  pilotTraining: number;
  modelMaturity: number;
  obsolescence: number;
  scaleEfficiency: number;
  lastProcessedElapsedDay: number;
};

export type AirIndustrialProgram = {
  id: string;
  entityId: string;
  type: AirProgramType;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  cost: number;
  status: AirProgramStatus;
};

export type AirIndustryState = {
  profiles: Record<string, AirIndustrialProfile>;
  programs: AirIndustrialProgram[];
};

type AirIndustryGlobal = typeof globalThis & { __WORLD_STATE_AIR_INDUSTRY__?: AirIndustryState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirIndustryState {
  const root = globalThis as AirIndustryGlobal;
  if (!root.__WORLD_STATE_AIR_INDUSTRY__) root.__WORLD_STATE_AIR_INDUSTRY__ = { profiles: {}, programs: [] };
  return root.__WORLD_STATE_AIR_INDUSTRY__;
}
function publish(state: AirIndustryState) {
  (globalThis as AirIndustryGlobal).__WORLD_STATE_AIR_INDUSTRY__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-industry', { detail: state }));
}
export function resetAirIndustry() { publish({ profiles: {}, programs: [] }); }
export function airIndustryState() {
  const state = rootState();
  return { profiles: Object.fromEntries(Object.entries(state.profiles).map(([id, value]) => [id, { ...value }])), programs: state.programs.map((item) => ({ ...item })) };
}

export function stageFor(year: number, technology: number): AirTechnologyStage {
  if (year < 1903) return 'observation';
  if (year < 1918) return 'pioneer';
  if (year < 1939) return technology >= 58 ? 'industrial' : 'interwar';
  if (year < 1955) return technology >= 72 ? 'jet' : 'industrial';
  if (year < 1985) return technology >= 76 ? 'digital' : 'jet';
  if (year < 2005) return technology >= 82 ? 'networked' : 'digital';
  return technology >= 70 ? 'networked' : 'digital';
}

export function stageLabel(stage: AirTechnologyStage, year: number) {
  if (stage === 'observation') return year < 1903 ? 'Observação aerostática' : 'Aviação experimental';
  if (stage === 'pioneer') return 'Aviação pioneira';
  if (stage === 'interwar') return 'Aviação de transição';
  if (stage === 'industrial') return 'Aviação produzida em escala industrial';
  if (stage === 'jet') return 'Era do jato';
  if (stage === 'digital') return 'Aviação digital integrada';
  return 'Poder aéreo em rede';
}

function stageBaseline(stage: AirTechnologyStage) {
  if (stage === 'observation') return 12;
  if (stage === 'pioneer') return 22;
  if (stage === 'interwar') return 36;
  if (stage === 'industrial') return 54;
  if (stage === 'jet') return 68;
  if (stage === 'digital') return 82;
  return 92;
}

function initialProfile(entityId: string, simulation: SimulationState): AirIndustrialProfile {
  const runtime = simulation.entities[entityId];
  const industry = militaryIndustryFor(entityId, simulation);
  const technology = runtime?.technology ?? 35;
  const stage = stageFor(simulation.date.year, technology);
  const baseline = stageBaseline(stage);
  const productionCapacity = clamp(industry.armamentsCapacity * .52 + industry.supplyCapacity * .16 + technology * .24 + baseline * .08);
  const maintenanceCapacity = clamp(industry.supplyCapacity * .52 + industry.replacementEfficiency * .28 + technology * .2);
  const pilotTraining = clamp((runtime?.militaryReadiness ?? 35) * .42 + technology * .38 + (runtime?.treasuryIndex ?? 35) * .2);
  const modelMaturity = clamp(baseline * .56 + technology * .44);
  const obsolescence = clamp(Math.max(0, baseline - technology) * 1.2 + Math.max(0, 52 - productionCapacity) * .22);
  return { entityId, stage, productionCapacity, maintenanceCapacity, pilotTraining, modelMaturity, obsolescence, scaleEfficiency: clamp(productionCapacity * .56 + modelMaturity * .24 + pilotTraining * .2), lastProcessedElapsedDay: simulation.elapsedDays };
}

function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation);
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}

export function airIndustryFor(entityId: string, simulation: SimulationState) { return { ...ensureProfile(entityId, simulation) }; }

function programDuration(type: AirProgramType, year: number) {
  const base = type === 'modernization' ? 360 : type === 'production' ? 280 : type === 'pilot-training' ? 220 : 180;
  const era = year < 1914 ? 1.5 : year < 1945 ? 1.2 : year < 1980 ? 1 : .84;
  return Math.max(120, Math.round(base * era));
}
function programCost(type: AirProgramType, profile: AirIndustrialProfile) {
  const base = type === 'modernization' ? 13 : type === 'production' ? 11 : type === 'pilot-training' ? 8 : 7;
  return Math.round(base + profile.scaleEfficiency * .055);
}

export function startAirProgram(entityId: string, type: AirProgramType, simulation: SimulationState) {
  if (simulation.date.year < 1794) return { simulation, error: 'A época ainda não permite uma estrutura aérea militar institucionalizada.' };
  const runtime = simulation.entities[entityId];
  if (!runtime) return { simulation, error: 'Entidade não encontrada.' };
  const state = rootState();
  const profile = ensureProfile(entityId, simulation);
  if (state.programs.some((item) => item.entityId === entityId && item.status === 'active')) return { simulation, error: 'Já existe um programa aeronáutico em andamento.' };
  const cost = programCost(type, profile);
  if (runtime.treasuryIndex < cost + 6) return { simulation, error: 'Tesouro insuficiente para iniciar o programa.' };
  const program: AirIndustrialProgram = {
    id: `air-program-${entityId}-${type}-${simulation.elapsedDays}`,
    entityId,
    type,
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + programDuration(type, simulation.date.year),
    cost,
    status: 'active',
  };
  const nextRuntime = { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - cost) };
  const event: WorldEvent = {
    id: `air-program-start-${program.id}`,
    date: simulation.date,
    entityId,
    category: 'military',
    title: 'Programa aeronáutico iniciado',
    text: 'Recursos foram comprometidos para ampliar a capacidade aérea, industrial ou de formação especializada.',
  };
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile }, programs: [program, ...state.programs].slice(0, 100) });
  return { simulation: { ...simulation, entities: { ...simulation.entities, [entityId]: nextRuntime }, events: [event, ...simulation.events].slice(0, 50) }, program };
}

export function processAirIndustry(simulation: SimulationState, warState: WarState) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let programs = state.programs.map((item) => ({ ...item }));
  let nextSimulation = simulation;
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    const runtime = simulation.entities[entityId];
    const industry = militaryIndustryFor(entityId, simulation);
    const previous = profiles[entityId] ?? initialProfile(entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - previous.lastProcessedElapsedDay);
    if (!days) { profiles[entityId] = previous; continue; }
    const stage = stageFor(simulation.date.year, runtime.technology);
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const productionCapacity = clamp(previous.productionCapacity + days * industry.armamentsCapacity / 90000 + (atWar ? days * .002 : days * .003));
    const maintenanceCapacity = clamp(previous.maintenanceCapacity + days * industry.supplyCapacity / 100000);
    const pilotTraining = clamp(previous.pilotTraining + days * (atWar ? .003 : .007));
    const modelMaturity = clamp(previous.modelMaturity + days * runtime.technology / 180000);
    const baseline = stageBaseline(stage);
    const obsolescence = clamp(previous.obsolescence + days * Math.max(0, baseline - modelMaturity) / 12000 - days * modelMaturity / 180000);
    profiles[entityId] = { ...previous, stage, productionCapacity, maintenanceCapacity, pilotTraining, modelMaturity, obsolescence, scaleEfficiency: clamp(productionCapacity * .56 + modelMaturity * .24 + pilotTraining * .2 - obsolescence * .18), lastProcessedElapsedDay: simulation.elapsedDays };
    changed = true;
  }

  programs = programs.map((program) => {
    if (program.status !== 'active' || simulation.elapsedDays < program.completesAtElapsedDay) return program;
    const profile = profiles[program.entityId];
    if (!profile) return program;
    const gain = program.type === 'production'
      ? { productionCapacity: 11, maintenanceCapacity: 2, pilotTraining: 0, modelMaturity: 2, obsolescence: -2 }
      : program.type === 'modernization'
        ? { productionCapacity: 2, maintenanceCapacity: 3, pilotTraining: 2, modelMaturity: 12, obsolescence: -14 }
        : program.type === 'pilot-training'
          ? { productionCapacity: 0, maintenanceCapacity: 2, pilotTraining: 13, modelMaturity: 2, obsolescence: -1 }
          : { productionCapacity: 1, maintenanceCapacity: 12, pilotTraining: 2, modelMaturity: 2, obsolescence: -3 };
    profiles[program.entityId] = {
      ...profile,
      productionCapacity: clamp(profile.productionCapacity + gain.productionCapacity),
      maintenanceCapacity: clamp(profile.maintenanceCapacity + gain.maintenanceCapacity),
      pilotTraining: clamp(profile.pilotTraining + gain.pilotTraining),
      modelMaturity: clamp(profile.modelMaturity + gain.modelMaturity),
      obsolescence: clamp(profile.obsolescence + gain.obsolescence),
      scaleEfficiency: clamp(profile.scaleEfficiency + 5),
    };
    const event: WorldEvent = {
      id: `air-program-complete-${program.id}`,
      date: simulation.date,
      entityId: program.entityId,
      category: 'military',
      title: 'Programa aeronáutico concluído',
      text: 'A nova capacidade foi absorvida pela força aérea e passa a influenciar produção, manutenção, treinamento e modernização.',
    };
    nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    changed = true;
    return { ...program, status: 'completed' as const };
  });

  if (changed) publish({ profiles, programs });
  return { simulation: nextSimulation, changed };
}

export function airIndustrialSupport(entityId: string, simulation: SimulationState) {
  const profile = airIndustryFor(entityId, simulation);
  const modernization = clamp(profile.modelMaturity - profile.obsolescence * .55);
  return {
    production: profile.productionCapacity,
    maintenance: profile.maintenanceCapacity,
    pilotTraining: profile.pilotTraining,
    modernization,
    effectiveness: clamp(profile.scaleEfficiency * .55 + modernization * .45),
    obsolescence: profile.obsolescence,
  };
}
