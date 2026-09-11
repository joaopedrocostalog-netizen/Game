import type { ArmyState } from './army';
import type { SimulationState, WorldEvent } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { War, WarState } from './war';

export type MilitaryInstitutionMemory = {
  entityId: string;
  warsFought: number;
  victories: number;
  defeats: number;
  institutionalExperience: number;
  logisticsTradition: number;
  offensiveTradition: number;
  defensiveTradition: number;
  resilience: number;
  commandCulture: number;
  warTrauma: number;
  lastWarElapsedDay?: number;
  lastLesson?: string;
};

export type FormationExperience = {
  unitId: string;
  entityId: string;
  campaigns: number;
  experience: number;
  veteranStatus: 'green' | 'seasoned' | 'veteran' | 'elite';
  commanderExperience: number;
  lastWarId?: string;
};

export type MilitaryLegacyState = {
  institutions: Record<string, MilitaryInstitutionMemory>;
  formations: Record<string, FormationExperience>;
  processedWarIds: string[];
};

type MilitaryLegacyGlobal = typeof globalThis & { __WORLD_STATE_MILITARY_LEGACY__?: MilitaryLegacyState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): MilitaryLegacyState {
  const root = globalThis as MilitaryLegacyGlobal;
  if (!root.__WORLD_STATE_MILITARY_LEGACY__) root.__WORLD_STATE_MILITARY_LEGACY__ = { institutions: {}, formations: {}, processedWarIds: [] };
  return root.__WORLD_STATE_MILITARY_LEGACY__;
}

function publish(state: MilitaryLegacyState) {
  (globalThis as MilitaryLegacyGlobal).__WORLD_STATE_MILITARY_LEGACY__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-military-legacy', { detail: state }));
}

export function militaryLegacyState() {
  const state = rootState();
  return {
    institutions: Object.fromEntries(Object.entries(state.institutions).map(([id, value]) => [id, { ...value }])),
    formations: Object.fromEntries(Object.entries(state.formations).map(([id, value]) => [id, { ...value }])),
    processedWarIds: [...state.processedWarIds],
  };
}

export function resetMilitaryLegacy() {
  publish({ institutions: {}, formations: {}, processedWarIds: [] });
}

function defaultInstitution(entityId: string): MilitaryInstitutionMemory {
  return {
    entityId,
    warsFought: 0,
    victories: 0,
    defeats: 0,
    institutionalExperience: 0,
    logisticsTradition: 0,
    offensiveTradition: 0,
    defensiveTradition: 0,
    resilience: 0,
    commandCulture: 0,
    warTrauma: 0,
  };
}

function participantResult(war: War, entityId: string) {
  const attacker = war.attackers.includes(entityId);
  const defender = war.defenders.includes(entityId);
  const side = attacker ? 'attackers' as const : defender ? 'defenders' as const : undefined;
  if (!side) return undefined;
  const won = war.victor === side;
  const lost = war.victor && war.victor !== 'stalemate' && war.victor !== side;
  const losses = side === 'attackers' ? war.attackerLosses : war.defenderLosses;
  const support = side === 'attackers' ? war.attackerSupport : war.defenderSupport;
  const fronts = war.fronts;
  const ownLogistics = fronts.length
    ? fronts.reduce((sum, front) => sum + (side === 'attackers' ? front.attackerLogistics : front.defenderLogistics), 0) / fronts.length
    : 50;
  const offensiveOrders = fronts.filter((front) => {
    const order = side === 'attackers' ? front.attackerOrder : front.defenderOrder;
    return order === 'offensive' || order === 'breakthrough';
  }).length;
  const defensiveOrders = fronts.filter((front) => {
    const order = side === 'attackers' ? front.attackerOrder : front.defenderOrder;
    return order === 'defend' || order === 'cautious';
  }).length;
  return { side, won, lost, losses, support, ownLogistics, offensiveOrders, defensiveOrders };
}

function lessonText(result: NonNullable<ReturnType<typeof participantResult>>, war: War) {
  if (result.won && result.ownLogistics >= 65) return 'A campanha reforçou a confiança em preparação logística e sustentação operacional.';
  if (result.won && result.offensiveOrders > result.defensiveOrders) return 'A vitória fortaleceu a tradição de iniciativa e ação ofensiva.';
  if (result.won) return 'A vitória consolidou confiança institucional e métodos empregados durante a campanha.';
  if (result.lost && result.losses > 18) return 'As perdas expuseram fragilidades e deixaram forte trauma institucional, estimulando reformas.';
  if (result.lost) return 'A derrota desencadeou revisão de comando, doutrina e preparação militar.';
  return war.victor === 'stalemate'
    ? 'O impasse reforçou a importância de resistência, reservas e sustentação de longo prazo.'
    : 'A campanha acrescentou experiência prática sem produzir uma conclusão doutrinária dominante.';
}

function veteranStatus(experience: number): FormationExperience['veteranStatus'] {
  if (experience >= 78) return 'elite';
  if (experience >= 52) return 'veteran';
  if (experience >= 24) return 'seasoned';
  return 'green';
}

function learningForWar(war: War, entityId: string, territorialControl: TerritorialControlState) {
  const result = participantResult(war, entityId);
  if (!result) return undefined;
  const battles = territorialControl.battles.filter((battle) => battle.warId === war.id);
  const durationFactor = clamp(war.elapsedDays / 720 * 100, 8, 100);
  const battleFactor = clamp(battles.length * 7, 0, 55);
  const experienceGain = clamp(5 + durationFactor * .17 + battleFactor * .28 + (result.won ? 8 : 3), 4, 32);
  const traumaGain = clamp(result.losses * .34 + (result.lost ? 9 : 0) + Math.max(0, 45 - result.support) * .16, 0, 24);
  return { result, experienceGain, traumaGain };
}

function eventFor(entityId: string, war: War, simulation: SimulationState, text: string): WorldEvent {
  return {
    id: `military-legacy-${war.id}-${entityId}`,
    date: simulation.date,
    entityId,
    category: 'military',
    title: 'Lições militares institucionalizadas',
    text,
  };
}

export function processMilitaryLegacy(
  simulation: SimulationState,
  armyState: ArmyState,
  warState: WarState,
  territorialControl: TerritorialControlState,
) {
  const state = rootState();
  const ended = warState.wars.filter((war) => war.status === 'ended' && !state.processedWarIds.includes(war.id));
  if (!ended.length) return { simulation, armyState, changed: false };

  const institutions = { ...state.institutions };
  const formations = { ...state.formations };
  const processed = [...state.processedWarIds];
  let nextArmy = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  let nextSimulation = simulation;

  for (const war of ended) {
    const participants = [...new Set([...war.attackers, ...war.defenders])];
    for (const entityId of participants) {
      const learning = learningForWar(war, entityId, territorialControl);
      if (!learning) continue;
      const current = institutions[entityId] ?? defaultInstitution(entityId);
      const { result, experienceGain, traumaGain } = learning;
      const offenseGain = experienceGain * (result.offensiveOrders > result.defensiveOrders ? .8 : .35);
      const defenseGain = experienceGain * (result.defensiveOrders >= result.offensiveOrders ? .8 : .35);
      const logisticsGain = experienceGain * (.35 + result.ownLogistics / 180);
      const commandGain = experienceGain * (result.won ? .62 : .48);
      const resilienceGain = experienceGain * (.42 + Math.max(0, 65 - result.support) / 160);
      const lesson = lessonText(result, war);
      institutions[entityId] = {
        ...current,
        warsFought: current.warsFought + 1,
        victories: current.victories + (result.won ? 1 : 0),
        defeats: current.defeats + (result.lost ? 1 : 0),
        institutionalExperience: clamp(current.institutionalExperience + experienceGain),
        logisticsTradition: clamp(current.logisticsTradition + logisticsGain),
        offensiveTradition: clamp(current.offensiveTradition + offenseGain),
        defensiveTradition: clamp(current.defensiveTradition + defenseGain),
        resilience: clamp(current.resilience + resilienceGain),
        commandCulture: clamp(current.commandCulture + commandGain),
        warTrauma: clamp(current.warTrauma * .78 + traumaGain),
        lastWarElapsedDay: simulation.elapsedDays,
        lastLesson: lesson,
      };

      nextArmy.units = nextArmy.units.map((unit) => {
        if (unit.entityId !== entityId) return unit;
        const previous = formations[unit.id] ?? { unitId: unit.id, entityId, campaigns: 0, experience: 0, veteranStatus: 'green' as const, commanderExperience: 0 };
        const unitExperienceGain = clamp(experienceGain * (.72 + unit.strength / 250), 3, 28);
        const commanderGain = clamp(experienceGain * (.48 + unit.organization / 250), 2, 18);
        const experience = clamp(previous.experience + unitExperienceGain);
        formations[unit.id] = {
          ...previous,
          campaigns: previous.campaigns + 1,
          experience,
          veteranStatus: veteranStatus(experience),
          commanderExperience: clamp(previous.commanderExperience + commanderGain),
          lastWarId: war.id,
        };
        return {
          ...unit,
          organization: clamp(unit.organization + unitExperienceGain * .16),
          morale: clamp(unit.morale + unitExperienceGain * .12 - traumaGain * .08),
          commander: {
            ...unit.commander,
            skill: clamp(unit.commander.skill + commanderGain * .12),
            logistics: clamp(unit.commander.logistics + commanderGain * .09),
            initiative: clamp(unit.commander.initiative + commanderGain * .1),
          },
        };
      });

      nextSimulation = {
        ...nextSimulation,
        events: [eventFor(entityId, war, nextSimulation, lesson), ...nextSimulation.events].slice(0, 50),
      };
    }
    processed.push(war.id);
  }

  publish({ institutions, formations, processedWarIds: processed.slice(-120) });
  return { simulation: nextSimulation, armyState: nextArmy, changed: true };
}

export function militaryInstitutionalModifiers(entityId: string) {
  const memory = rootState().institutions[entityId] ?? defaultInstitution(entityId);
  const traumaPenalty = memory.warTrauma * .055;
  return {
    organization: clamp(memory.institutionalExperience * .07 + memory.commandCulture * .035 - traumaPenalty, -4, 12),
    morale: clamp(memory.resilience * .055 + memory.institutionalExperience * .025 - memory.warTrauma * .07, -6, 10),
    supply: clamp(memory.logisticsTradition * .065, 0, 9),
    commanderSkill: clamp(memory.commandCulture * .04, 0, 6),
    commanderLogistics: clamp(memory.logisticsTradition * .045, 0, 7),
    commanderInitiative: clamp(memory.offensiveTradition * .025 + memory.defensiveTradition * .018, 0, 6),
    experience: memory.institutionalExperience,
    trauma: memory.warTrauma,
  };
}

export function militaryInstitutionFor(entityId: string) {
  return rootState().institutions[entityId] ?? defaultInstitution(entityId);
}

export function formationExperienceFor(unitId: string) {
  return rootState().formations[unitId];
}
