import type { ArmyState } from './army';
import { militaryInstitutionFor } from './militaryLegacy';
import type { SimulationState, WorldEvent } from './simulation';
import type { WarState } from './war';

export type MilitaryReformType =
  | 'officer_education'
  | 'logistics_reorganization'
  | 'professionalization'
  | 'mass_mobilization'
  | 'staff_reform'
  | 'doctrine_revision'
  | 'reserve_system';

export type MilitaryReformStatus = 'active' | 'completed' | 'cancelled';

export type MilitaryReform = {
  id: string;
  entityId: string;
  type: MilitaryReformType;
  label: string;
  description: string;
  startedAtElapsedDay: number;
  completesAtElapsedDay: number;
  cost: number;
  status: MilitaryReformStatus;
  progress: number;
  sourceLesson?: string;
  completedAtElapsedDay?: number;
};

export type MilitaryReformPortfolio = {
  entityId: string;
  completed: Partial<Record<MilitaryReformType, number>>;
  reformCapacity: number;
  lastCompleted?: MilitaryReformType;
};

type MilitaryReformState = {
  reforms: MilitaryReform[];
  portfolios: Record<string, MilitaryReformPortfolio>;
  lastAiReview: Record<string, number>;
};

type MilitaryReformGlobal = typeof globalThis & { __WORLD_STATE_PEACETIME_MILITARY_REFORMS__?: MilitaryReformState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): MilitaryReformState {
  const root = globalThis as MilitaryReformGlobal;
  if (!root.__WORLD_STATE_PEACETIME_MILITARY_REFORMS__) root.__WORLD_STATE_PEACETIME_MILITARY_REFORMS__ = { reforms: [], portfolios: {}, lastAiReview: {} };
  return root.__WORLD_STATE_PEACETIME_MILITARY_REFORMS__;
}

function publish(state: MilitaryReformState) {
  (globalThis as MilitaryReformGlobal).__WORLD_STATE_PEACETIME_MILITARY_REFORMS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-peacetime-military-reforms', { detail: state }));
}

export function peacetimeMilitaryReformState() {
  const state = rootState();
  return {
    reforms: state.reforms.map((item) => ({ ...item })),
    portfolios: Object.fromEntries(Object.entries(state.portfolios).map(([id, value]) => [id, { ...value, completed: { ...value.completed } }])),
    lastAiReview: { ...state.lastAiReview },
  };
}

export function resetPeacetimeMilitaryReforms() {
  publish({ reforms: [], portfolios: {}, lastAiReview: {} });
}

function labels(type: MilitaryReformType, year: number) {
  const early = year < 1800;
  const industrial = year >= 1800 && year < 1945;
  if (type === 'officer_education') return {
    label: early ? 'Escola militar da corte' : industrial ? 'Academia de oficiais' : 'Sistema superior de formação de oficiais',
    description: 'Melhora seleção, formação e continuidade profissional do corpo de comando.',
  };
  if (type === 'logistics_reorganization') return {
    label: early ? 'Reforma de intendência' : industrial ? 'Reorganização logística' : 'Comando logístico integrado',
    description: 'Reorganiza abastecimento, depósitos, transporte e administração de campanha.',
  };
  if (type === 'professionalization') return {
    label: early ? 'Profissionalização do exército permanente' : 'Profissionalização das forças',
    description: 'Aumenta treinamento e disciplina, mas exige maior gasto permanente do Estado.',
  };
  if (type === 'mass_mobilization') return {
    label: early ? 'Reforma de levas e milícias' : industrial ? 'Sistema nacional de conscrição' : 'Estrutura ampliada de mobilização',
    description: 'Amplia a capacidade de mobilizar pessoal, com custo social e administrativo.',
  };
  if (type === 'staff_reform') return {
    label: early ? 'Conselho permanente de guerra' : industrial ? 'Reforma do estado-maior' : 'Comando conjunto e estado-maior integrado',
    description: 'Melhora planejamento, coordenação entre formações e qualidade das decisões superiores.',
  };
  if (type === 'doctrine_revision') return {
    label: early ? 'Revisão dos regulamentos de campanha' : 'Modernização doutrinária',
    description: 'Transforma lições de guerras anteriores em regulamentos, treinamento e prática operacional.',
  };
  return {
    label: early ? 'Reservas territoriais organizadas' : industrial ? 'Sistema de reservas treinadas' : 'Força de reserva estratégica',
    description: 'Mantém forças preparadas fora do núcleo ativo e melhora a capacidade de recomposição em guerra.',
  };
}

function baseDuration(type: MilitaryReformType) {
  if (type === 'officer_education') return 540;
  if (type === 'professionalization') return 720;
  if (type === 'mass_mobilization') return 620;
  if (type === 'staff_reform') return 460;
  if (type === 'doctrine_revision') return 300;
  if (type === 'reserve_system') return 500;
  return 380;
}

function baseCost(type: MilitaryReformType) {
  if (type === 'professionalization') return 15;
  if (type === 'mass_mobilization') return 11;
  if (type === 'officer_education') return 10;
  if (type === 'staff_reform') return 9;
  if (type === 'reserve_system') return 9;
  if (type === 'logistics_reorganization') return 8;
  return 7;
}

function eraDurationFactor(year: number) {
  if (year < 1650) return 1.45;
  if (year < 1850) return 1.25;
  if (year < 1945) return 1.08;
  return .92;
}

function activeWarForEntity(warState: WarState, entityId: string) {
  return warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
}

function activeForEntity(entityId: string) {
  return rootState().reforms.find((reform) => reform.entityId === entityId && reform.status === 'active');
}

export function availableMilitaryReforms(entityId: string, simulation: SimulationState, warState: WarState) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return [];
  const institution = militaryInstitutionFor(entityId);
  const atWar = activeWarForEntity(warState, entityId);
  const current = activeForEntity(entityId);
  const types: MilitaryReformType[] = ['officer_education', 'logistics_reorganization', 'professionalization', 'mass_mobilization', 'staff_reform', 'doctrine_revision', 'reserve_system'];
  return types.map((type) => {
    const text = labels(type, simulation.date.year);
    const cost = baseCost(type);
    const duration = Math.round(baseDuration(type) * eraDurationFactor(simulation.date.year));
    const completedLevel = rootState().portfolios[entityId]?.completed[type] ?? 0;
    let available = !atWar && !current && runtime.treasuryIndex >= cost + 8 && completedLevel < 3;
    let reason = available ? 'Disponível durante a paz.' : atWar ? 'Reformas estruturais devem ser iniciadas fora de uma guerra ativa.' : current ? 'Outra reforma militar já está em andamento.' : runtime.treasuryIndex < cost + 8 ? 'Tesouro insuficiente para sustentar a reforma.' : 'Essa reforma já atingiu o nível máximo previsto.';
    if (type === 'mass_mobilization' && simulation.date.year < 1600) {
      available = false;
      reason = 'A estrutura estatal ainda não permite uma reforma nacional de mobilização nessa escala.';
    }
    return {
      type,
      ...text,
      cost,
      duration,
      available,
      reason,
      completedLevel,
      recommended: type === 'logistics_reorganization' ? institution.logisticsTradition < institution.institutionalExperience * .62
        : type === 'doctrine_revision' ? institution.warsFought > 0
        : type === 'staff_reform' ? institution.commandCulture < institution.institutionalExperience * .58
        : type === 'reserve_system' ? institution.defensiveTradition > institution.offensiveTradition + 8
        : type === 'professionalization' ? institution.warTrauma > 24
        : false,
    };
  });
}

export function startMilitaryReform(entityId: string, type: MilitaryReformType, simulation: SimulationState, warState: WarState) {
  const option = availableMilitaryReforms(entityId, simulation, warState).find((item) => item.type === type);
  const runtime = simulation.entities[entityId];
  if (!option?.available || !runtime) return { simulation, reform: undefined, error: option?.reason ?? 'Reforma indisponível.' };
  const institution = militaryInstitutionFor(entityId);
  const reform: MilitaryReform = {
    id: `military-reform-${entityId}-${type}-${simulation.elapsedDays}`,
    entityId,
    type,
    label: option.label,
    description: option.description,
    startedAtElapsedDay: simulation.elapsedDays,
    completesAtElapsedDay: simulation.elapsedDays + option.duration,
    cost: option.cost,
    status: 'active',
    progress: 0,
    sourceLesson: institution.lastLesson,
  };
  const nextSimulation: SimulationState = {
    ...simulation,
    entities: {
      ...simulation.entities,
      [entityId]: { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - option.cost) },
    },
    events: [{
      id: `military-reform-start-${reform.id}`,
      date: simulation.date,
      entityId,
      category: 'military',
      title: `Reforma iniciada: ${reform.label}`,
      text: reform.sourceLesson ? `${reform.description} A decisão foi influenciada por uma lição anterior: ${reform.sourceLesson}` : reform.description,
    } satisfies WorldEvent, ...simulation.events].slice(0, 50),
  };
  const state = rootState();
  publish({ ...state, reforms: [reform, ...state.reforms].slice(0, 100) });
  return { simulation: nextSimulation, reform };
}

function completionEffects(type: MilitaryReformType, level: number) {
  const scale = 1 + Math.max(0, level - 1) * .55;
  if (type === 'officer_education') return { readiness: 1.4 * scale, technology: .5 * scale, stability: 0, organization: 2.2 * scale, morale: .5 * scale, supply: 0, commanderSkill: 2.2 * scale, commanderLogistics: .6 * scale, commanderInitiative: 1.1 * scale };
  if (type === 'logistics_reorganization') return { readiness: 1 * scale, technology: .2 * scale, stability: 0, organization: .8 * scale, morale: 0, supply: 4.5 * scale, commanderSkill: 0, commanderLogistics: 2.3 * scale, commanderInitiative: .3 * scale };
  if (type === 'professionalization') return { readiness: 3.8 * scale, technology: .2 * scale, stability: -.8 * scale, organization: 3.5 * scale, morale: 2.5 * scale, supply: 1 * scale, commanderSkill: 1 * scale, commanderLogistics: .5 * scale, commanderInitiative: .8 * scale };
  if (type === 'mass_mobilization') return { readiness: 4.4 * scale, technology: 0, stability: -1.6 * scale, organization: -.8 * scale, morale: -.4 * scale, supply: -1 * scale, commanderSkill: 0, commanderLogistics: 0, commanderInitiative: 0 };
  if (type === 'staff_reform') return { readiness: 2.1 * scale, technology: .3 * scale, stability: 0, organization: 2.8 * scale, morale: .5 * scale, supply: 1 * scale, commanderSkill: 1.4 * scale, commanderLogistics: 1.1 * scale, commanderInitiative: 1.8 * scale };
  if (type === 'doctrine_revision') return { readiness: 2 * scale, technology: .6 * scale, stability: 0, organization: 1.8 * scale, morale: 1 * scale, supply: .3 * scale, commanderSkill: .5 * scale, commanderLogistics: .3 * scale, commanderInitiative: 1.4 * scale };
  return { readiness: 2.4 * scale, technology: 0, stability: 0, organization: 1.2 * scale, morale: 1.4 * scale, supply: 1.2 * scale, commanderSkill: 0, commanderLogistics: .5 * scale, commanderInitiative: .5 * scale };
}

function applyEffects(entityId: string, type: MilitaryReformType, level: number, simulation: SimulationState, armyState: ArmyState) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return { simulation, armyState };
  const effect = completionEffects(type, level);
  const nextSimulation: SimulationState = {
    ...simulation,
    entities: {
      ...simulation.entities,
      [entityId]: {
        ...runtime,
        militaryReadiness: clamp(runtime.militaryReadiness + effect.readiness),
        technology: clamp(runtime.technology + effect.technology),
        stability: clamp(runtime.stability + effect.stability),
      },
    },
  };
  const nextArmy: ArmyState = {
    ...armyState,
    units: armyState.units.map((unit) => unit.entityId !== entityId ? unit : {
      ...unit,
      organization: clamp(unit.organization + effect.organization),
      morale: clamp(unit.morale + effect.morale),
      supply: clamp(unit.supply + effect.supply),
      commander: {
        ...unit.commander,
        skill: clamp(unit.commander.skill + effect.commanderSkill),
        logistics: clamp(unit.commander.logistics + effect.commanderLogistics),
        initiative: clamp(unit.commander.initiative + effect.commanderInitiative),
      },
    }),
  };
  return { simulation: nextSimulation, armyState: nextArmy };
}

function portfolioFor(entityId: string): MilitaryReformPortfolio {
  return rootState().portfolios[entityId] ?? { entityId, completed: {}, reformCapacity: 0 };
}

export function processPeacetimeMilitaryReforms(simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  let reforms = state.reforms.map((reform) => ({ ...reform }));
  let portfolios = { ...state.portfolios };
  let lastAiReview = { ...state.lastAiReview };
  let nextSimulation = simulation;
  let nextArmy = armyState;
  let changed = false;

  reforms = reforms.map((reform) => {
    if (reform.status !== 'active') return reform;
    const total = Math.max(1, reform.completesAtElapsedDay - reform.startedAtElapsedDay);
    const progress = clamp((simulation.elapsedDays - reform.startedAtElapsedDay) / total * 100);
    if (simulation.elapsedDays < reform.completesAtElapsedDay) return progress !== reform.progress ? { ...reform, progress } : reform;
    const portfolio = portfolios[reform.entityId] ?? { entityId: reform.entityId, completed: {}, reformCapacity: 0 };
    const level = (portfolio.completed[reform.type] ?? 0) + 1;
    portfolios[reform.entityId] = {
      ...portfolio,
      completed: { ...portfolio.completed, [reform.type]: level },
      reformCapacity: clamp(portfolio.reformCapacity + 8 + level * 2),
      lastCompleted: reform.type,
    };
    const applied = applyEffects(reform.entityId, reform.type, level, nextSimulation, nextArmy);
    nextSimulation = {
      ...applied.simulation,
      events: [{
        id: `military-reform-complete-${reform.id}`,
        date: simulation.date,
        entityId: reform.entityId,
        category: 'military',
        title: `Reforma concluída: ${reform.label}`,
        text: `${reform.label} foi institucionalizada. Seus efeitos agora fazem parte permanente da preparação militar desse Estado.`,
      } satisfies WorldEvent, ...applied.simulation.events].slice(0, 50),
    };
    nextArmy = applied.armyState;
    changed = true;
    return { ...reform, progress: 100, status: 'completed' as const, completedAtElapsedDay: simulation.elapsedDays };
  });

  for (const entityId of Object.keys(simulation.entities)) {
    if (entityId === simulation.playerEntityId || activeWarForEntity(warState, entityId) || activeForEntity(entityId)) continue;
    const last = lastAiReview[entityId] ?? 0;
    if (simulation.elapsedDays - last < 180) continue;
    lastAiReview[entityId] = simulation.elapsedDays;
    const options = availableMilitaryReforms(entityId, nextSimulation, warState).filter((option) => option.available);
    const runtime = nextSimulation.entities[entityId];
    if (!runtime || runtime.treasuryIndex < 48 || !options.length) continue;
    const preferred = options.find((option) => option.recommended) ?? options.sort((a, b) => a.cost - b.cost)[0];
    const result = startMilitaryReform(entityId, preferred.type, nextSimulation, warState);
    if (result.reform) {
      nextSimulation = result.simulation;
      reforms = [result.reform, ...reforms.filter((item) => item.id !== result.reform?.id)].slice(0, 100);
      changed = true;
    }
  }

  const progressed = reforms.some((reform, index) => reform.progress !== state.reforms[index]?.progress || reform.status !== state.reforms[index]?.status);
  if (changed || progressed || JSON.stringify(lastAiReview) !== JSON.stringify(state.lastAiReview)) publish({ reforms, portfolios, lastAiReview });
  return { simulation: nextSimulation, armyState: nextArmy, changed: changed || progressed };
}

export function militaryReformModifiers(entityId: string) {
  const portfolio = portfolioFor(entityId);
  let organization = 0;
  let morale = 0;
  let supply = 0;
  let commanderSkill = 0;
  let commanderLogistics = 0;
  let commanderInitiative = 0;
  for (const [type, levelValue] of Object.entries(portfolio.completed)) {
    const level = levelValue ?? 0;
    for (let current = 1; current <= level; current += 1) {
      const effect = completionEffects(type as MilitaryReformType, current);
      organization += effect.organization * .4;
      morale += effect.morale * .35;
      supply += Math.max(0, effect.supply) * .45;
      commanderSkill += effect.commanderSkill * .45;
      commanderLogistics += effect.commanderLogistics * .45;
      commanderInitiative += effect.commanderInitiative * .45;
    }
  }
  return {
    organization: clamp(organization, -2, 12),
    morale: clamp(morale, -2, 10),
    supply: clamp(supply, 0, 10),
    commanderSkill: clamp(commanderSkill, 0, 7),
    commanderLogistics: clamp(commanderLogistics, 0, 8),
    commanderInitiative: clamp(commanderInitiative, 0, 8),
    reformCapacity: portfolio.reformCapacity,
  };
}
