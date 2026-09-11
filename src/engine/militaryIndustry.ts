import type { ArmyState } from './army';
import type { SimulationState, WorldEvent } from './simulation';
import type { WarState } from './war';

export type MilitaryIndustrySector = 'armaments' | 'supply' | 'naval';
export type IndustrialProjectStatus = 'building' | 'completed' | 'cancelled';

export type MilitaryIndustryProfile = {
  entityId: string;
  armamentsCapacity: number;
  supplyCapacity: number;
  navalCapacity: number;
  armamentsStockpile: number;
  supplyStockpile: number;
  importDependence: number;
  replacementEfficiency: number;
  lastProcessedElapsedDay: number;
  initializedAtYear: number;
};

export type IndustrialExpansionProject = {
  id: string;
  entityId: string;
  sector: MilitaryIndustrySector;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  cost: number;
  capacityGain: number;
  status: IndustrialProjectStatus;
};

export type MilitaryIndustryState = {
  profiles: Record<string, MilitaryIndustryProfile>;
  projects: IndustrialExpansionProject[];
};

type IndustryGlobal = typeof globalThis & { __WORLD_STATE_MILITARY_INDUSTRY__?: MilitaryIndustryState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): MilitaryIndustryState {
  const root = globalThis as IndustryGlobal;
  if (!root.__WORLD_STATE_MILITARY_INDUSTRY__) root.__WORLD_STATE_MILITARY_INDUSTRY__ = { profiles: {}, projects: [] };
  return root.__WORLD_STATE_MILITARY_INDUSTRY__;
}

function publish(state: MilitaryIndustryState) {
  (globalThis as IndustryGlobal).__WORLD_STATE_MILITARY_INDUSTRY__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-military-industry', { detail: state }));
}

export function militaryIndustryState() {
  const state = rootState();
  return {
    profiles: Object.fromEntries(Object.entries(state.profiles).map(([id, profile]) => [id, { ...profile }])),
    projects: state.projects.map((project) => ({ ...project })),
  };
}

export function resetMilitaryIndustry() {
  publish({ profiles: {}, projects: [] });
}

function eraIndustrialFactor(year: number) {
  if (year < 1700) return .52;
  if (year < 1850) return .68;
  if (year < 1914) return .86;
  if (year < 1945) return 1.04;
  if (year < 1990) return 1.12;
  return 1.2;
}

function initialProfile(entityId: string, simulation: SimulationState): MilitaryIndustryProfile {
  const runtime = simulation.entities[entityId];
  const factor = eraIndustrialFactor(simulation.date.year);
  const economy = runtime?.economyIndex ?? 40;
  const tech = runtime?.technology ?? 35;
  const treasury = runtime?.treasuryIndex ?? 40;
  const base = clamp((economy * .5 + tech * .3 + treasury * .2) * factor);
  return {
    entityId,
    armamentsCapacity: clamp(base * .92),
    supplyCapacity: clamp(base * 1.05),
    navalCapacity: clamp(base * (simulation.date.year < 1800 ? .72 : .88)),
    armamentsStockpile: clamp(38 + base * .34),
    supplyStockpile: clamp(44 + base * .38),
    importDependence: clamp(62 - base * .52),
    replacementEfficiency: clamp(32 + base * .58),
    lastProcessedElapsedDay: simulation.elapsedDays,
    initializedAtYear: simulation.date.year,
  };
}

function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation);
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}

export function militaryIndustryFor(entityId: string, simulation: SimulationState) {
  return { ...ensureProfile(entityId, simulation) };
}

export function eraIndustryLabels(year: number) {
  if (year < 1700) return {
    armaments: 'Arsenais, fundições e oficinas',
    supply: 'Intendência, depósitos e aprovisionamento',
    naval: 'Estaleiros e arsenais navais',
    expansion: 'Expandir capacidade artesanal-militar',
  };
  if (year < 1850) return {
    armaments: 'Arsenais e manufaturas militares',
    supply: 'Depósitos e sistema de intendência',
    naval: 'Estaleiros e docas militares',
    expansion: 'Expandir manufaturas militares',
  };
  if (year < 1945) return {
    armaments: 'Indústria de armamentos e munição',
    supply: 'Indústria de suprimentos e transporte',
    naval: 'Complexo de construção naval',
    expansion: 'Expandir indústria de guerra',
  };
  return {
    armaments: 'Base industrial de defesa',
    supply: 'Logística e produção de suprimentos',
    naval: 'Indústria naval militar',
    expansion: 'Expandir capacidade industrial militar',
  };
}

function projectCost(sector: MilitaryIndustrySector, level: number) {
  const base = sector === 'naval' ? 13 : sector === 'armaments' ? 10 : 8;
  return base + level * 3.2;
}

function projectDuration(year: number, sector: MilitaryIndustrySector) {
  const era = year < 1700 ? 1.65 : year < 1850 ? 1.35 : year < 1945 ? 1.05 : .9;
  const base = sector === 'naval' ? 420 : sector === 'armaments' ? 300 : 240;
  return Math.max(120, Math.round(base * era));
}

export function startMilitaryIndustryExpansion(entityId: string, sector: MilitaryIndustrySector, simulation: SimulationState, warState: WarState) {
  if (warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)))) {
    return { simulation, error: 'Grandes expansões estruturais precisam ser iniciadas em tempo de paz.' };
  }
  const state = rootState();
  const profile = ensureProfile(entityId, simulation);
  if (state.projects.some((project) => project.entityId === entityId && project.status === 'building')) {
    return { simulation, error: 'Já existe uma expansão industrial militar em andamento.' };
  }
  const runtime = simulation.entities[entityId];
  if (!runtime) return { simulation, error: 'Entidade não encontrada.' };
  const current = sector === 'armaments' ? profile.armamentsCapacity : sector === 'supply' ? profile.supplyCapacity : profile.navalCapacity;
  const level = Math.max(1, Math.ceil(current / 25));
  const cost = projectCost(sector, level);
  if (runtime.treasuryIndex < cost + 8) return { simulation, error: 'Tesouro insuficiente para iniciar a expansão.' };
  const project: IndustrialExpansionProject = {
    id: `mil-industry-${entityId}-${sector}-${simulation.elapsedDays}`,
    entityId,
    sector,
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + projectDuration(simulation.date.year, sector),
    cost,
    capacityGain: clamp(8 + runtime.technology * .05, 8, 14),
    status: 'building',
  };
  const nextRuntime = { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - cost) };
  const event: WorldEvent = {
    id: `mil-industry-start-${project.id}`,
    date: simulation.date,
    entityId,
    category: 'economy',
    title: 'Expansão da base militar iniciada',
    text: 'Recursos foram comprometidos para ampliar a capacidade doméstica de sustentação militar.',
  };
  const nextSimulation = { ...simulation, entities: { ...simulation.entities, [entityId]: nextRuntime }, events: [event, ...simulation.events].slice(0, 50) };
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile }, projects: [project, ...state.projects].slice(0, 120) });
  return { simulation: nextSimulation, project };
}

function tradeImportSupport(entityId: string, simulation: SimulationState) {
  const tradeTreaties = simulation.treaties.filter((treaty) => treaty.active && treaty.type === 'trade' && treaty.parties.includes(entityId)).length;
  return clamp(tradeTreaties * 8, 0, 28);
}

export function processMilitaryIndustry(simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let projects = state.projects.map((project) => ({ ...project }));
  let nextArmy = { ...armyState, units: armyState.units.map((unit) => ({ ...unit })) };
  let nextSimulation = simulation;
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    const profile = profiles[entityId] ?? initialProfile(entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - profile.lastProcessedElapsedDay);
    if (!days) {
      profiles[entityId] = profile;
      continue;
    }
    const units = nextArmy.units.filter((unit) => unit.entityId === entityId);
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const importSupport = tradeImportSupport(entityId, simulation) * (profile.importDependence / 100);
    const armamentsProduction = days * (profile.armamentsCapacity + importSupport) / 900;
    const supplyProduction = days * (profile.supplyCapacity + importSupport * .8) / 760;
    const armamentsConsumption = atWar ? days * units.length * .035 : days * units.length * .008;
    const supplyConsumption = atWar ? days * units.length * .052 : days * units.length * .012;
    let armamentsStockpile = clamp(profile.armamentsStockpile + armamentsProduction - armamentsConsumption);
    let supplyStockpile = clamp(profile.supplyStockpile + supplyProduction - supplyConsumption);

    const replacementEfficiency = clamp(
      profile.replacementEfficiency * .72 + profile.armamentsCapacity * .16 + profile.supplyCapacity * .12 + importSupport * .25,
    );

    if (units.length) {
      nextArmy.units = nextArmy.units.map((unit) => {
        if (unit.entityId !== entityId) return unit;
        if (atWar) {
          if (armamentsStockpile < 18) return { ...unit, equipment: clamp(unit.equipment - days * .018), organization: clamp(unit.organization - days * .007) };
          if (supplyStockpile < 18) return { ...unit, supply: clamp(unit.supply - days * .026), morale: clamp(unit.morale - days * .006) };
        }
        const equipmentNeed = Math.max(0, 100 - unit.equipment);
        const supplyNeed = Math.max(0, 100 - unit.supply);
        const equipRecovery = Math.min(equipmentNeed, days * replacementEfficiency / 520, armamentsStockpile * .05);
        const supplyRecovery = Math.min(supplyNeed, days * replacementEfficiency / 430, supplyStockpile * .055);
        armamentsStockpile = clamp(armamentsStockpile - equipRecovery * .12);
        supplyStockpile = clamp(supplyStockpile - supplyRecovery * .1);
        return { ...unit, equipment: clamp(unit.equipment + equipRecovery), supply: clamp(unit.supply + supplyRecovery) };
      });
    }

    profiles[entityId] = {
      ...profile,
      armamentsStockpile,
      supplyStockpile,
      replacementEfficiency,
      importDependence: clamp(profile.importDependence - days * profile.armamentsCapacity / 60000),
      lastProcessedElapsedDay: simulation.elapsedDays,
    };
    changed = true;
  }

  projects = projects.map((project) => {
    if (project.status !== 'building' || simulation.elapsedDays < project.completesAtElapsedDay) return project;
    const profile = profiles[project.entityId];
    if (!profile) return project;
    profiles[project.entityId] = project.sector === 'armaments'
      ? { ...profile, armamentsCapacity: clamp(profile.armamentsCapacity + project.capacityGain), replacementEfficiency: clamp(profile.replacementEfficiency + 3) }
      : project.sector === 'supply'
        ? { ...profile, supplyCapacity: clamp(profile.supplyCapacity + project.capacityGain), replacementEfficiency: clamp(profile.replacementEfficiency + 2.5) }
        : { ...profile, navalCapacity: clamp(profile.navalCapacity + project.capacityGain) };
    const event: WorldEvent = {
      id: `mil-industry-complete-${project.id}`,
      date: simulation.date,
      entityId: project.entityId,
      category: 'economy',
      title: 'Expansão da base militar concluída',
      text: 'A nova capacidade produtiva e logística entrou em operação e poderá sustentar campanhas futuras.',
    };
    nextSimulation = { ...nextSimulation, events: [event, ...nextSimulation.events].slice(0, 50) };
    changed = true;
    return { ...project, status: 'completed' as const };
  });

  if (changed) publish({ profiles, projects });
  return { simulation: nextSimulation, armyState: nextArmy, changed };
}

export function militaryIndustryPressure(entityId: string, simulation: SimulationState) {
  const profile = militaryIndustryFor(entityId, simulation);
  const stock = (profile.armamentsStockpile + profile.supplyStockpile) / 2;
  if (stock < 18) return 'critical';
  if (stock < 35) return 'strained';
  if (stock < 62) return 'adequate';
  return 'strong';
}
