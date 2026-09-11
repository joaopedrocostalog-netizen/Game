import type { ArmyState, Commander } from './army';
import { deceptionPlansForEntity } from './informationWarfare';
import { latestFrontIntelligence } from './militaryIntelligence';
import { operationalPlanState } from './operationalCampaignPlans';
import type { SimulationState, WorldEvent } from './simulation';
import { theaterCommandState } from './multinationalTheaterCommand';
import type { TerritorialControlState } from './territorialControl';
import {
  assignUnitToFront,
  clearUnitFrontAssignment,
  setFrontOrder,
  setFrontPriority,
  type FrontOrder,
  type FrontPriority,
  type FrontSide,
  type War,
  type WarState,
} from './war';

export type AdaptiveDoctrine =
  | 'balanced'
  | 'defense_in_depth'
  | 'mobile_reserve'
  | 'elastic_defense'
  | 'counter_breakthrough'
  | 'deliberate_counteroffensive';

export type OpponentPattern = {
  warId: string;
  observerId: string;
  opponentId: string;
  aggression: number;
  breakthroughBias: number;
  rapidTempoBias: number;
  deceptionReliance: number;
  concentrationBias: number;
  opponentMomentum: number;
  confidence: number;
  observedBattles: number;
  updatedAtElapsedDay: number;
};

export type DoctrineState = {
  warId: string;
  entityId: string;
  opponentId: string;
  doctrine: AdaptiveDoctrine;
  previousDoctrine?: AdaptiveDoctrine;
  confidence: number;
  reserveRatio: number;
  reason: string;
  adoptedAtElapsedDay: number;
  lastProcessedElapsedDay: number;
  lastCommanderReviewElapsedDay: number;
};

export type DoctrineChange = {
  id: string;
  warId: string;
  entityId: string;
  from?: AdaptiveDoctrine;
  to: AdaptiveDoctrine;
  reason: string;
  elapsedDay: number;
};

type AdaptiveDoctrineState = {
  patterns: OpponentPattern[];
  doctrines: DoctrineState[];
  changes: DoctrineChange[];
};

type DoctrineGlobal = typeof globalThis & { __WORLD_STATE_ADAPTIVE_DOCTRINE__?: AdaptiveDoctrineState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function rootState(): AdaptiveDoctrineState {
  const root = globalThis as DoctrineGlobal;
  if (!root.__WORLD_STATE_ADAPTIVE_DOCTRINE__) root.__WORLD_STATE_ADAPTIVE_DOCTRINE__ = { patterns: [], doctrines: [], changes: [] };
  return root.__WORLD_STATE_ADAPTIVE_DOCTRINE__;
}

function publish(state: AdaptiveDoctrineState) {
  (globalThis as DoctrineGlobal).__WORLD_STATE_ADAPTIVE_DOCTRINE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-adaptive-doctrine', { detail: state }));
}

export function adaptiveDoctrineState() {
  const state = rootState();
  return {
    patterns: state.patterns.map((item) => ({ ...item })),
    doctrines: state.doctrines.map((item) => ({ ...item })),
    changes: state.changes.map((item) => ({ ...item })),
  };
}

export function resetAdaptiveMilitaryDoctrine() {
  publish({ patterns: [], doctrines: [], changes: [] });
}

function sideFor(war: War, entityId: string): FrontSide | undefined {
  if (war.attackers.includes(entityId)) return 'attacker';
  if (war.defenders.includes(entityId)) return 'defender';
  return undefined;
}

function enemyIds(war: War, entityId: string) {
  const side = sideFor(war, entityId);
  if (side === 'attacker') return war.defenders;
  if (side === 'defender') return war.attackers;
  return [];
}

function sideOrder(war: War, frontId: string, side: FrontSide): FrontOrder {
  const front = war.fronts.find((item) => item.id === frontId);
  if (!front) return 'cautious';
  return side === 'attacker' ? front.attackerOrder : front.defenderOrder;
}

function sidePriority(war: War, frontId: string, side: FrontSide): FrontPriority {
  const front = war.fronts.find((item) => item.id === frontId);
  if (!front) return 'normal';
  return side === 'attacker' ? front.attackerPriority : front.defenderPriority;
}

function playerPlansForWar(playerId: string, warId: string) {
  const hqs = new Map(theaterCommandState().headquarters.map((hq) => [hq.id, hq]));
  return operationalPlanState().plans.filter((plan) => {
    if (plan.warId !== warId || ['completed', 'aborted'].includes(plan.status)) return false;
    const hq = hqs.get(plan.hqId);
    return hq?.commanderEntityId === playerId;
  });
}

function battleMomentum(playerId: string, war: War, territorialControl: TerritorialControlState) {
  const playerSide = sideFor(war, playerId);
  const battles = territorialControl.battles.filter((battle) => battle.warId === war.id).slice(0, 12);
  if (!playerSide || !battles.length) return { momentum: 50, count: battles.length };
  let wins = 0;
  let contested = 0;
  for (const battle of battles) {
    if (battle.outcome === 'contested') contested += 1;
    else if ((playerSide === 'attacker' && battle.outcome === 'attacker-advance') || (playerSide === 'defender' && battle.outcome === 'defender-hold')) wins += 1;
  }
  const momentum = clamp((wins + contested * .45) / battles.length * 100);
  return { momentum, count: battles.length };
}

function observeOpponent(observerId: string, opponentId: string, war: War, simulation: SimulationState, territorialControl: TerritorialControlState): OpponentPattern {
  const opponentSide = sideFor(war, opponentId) ?? 'attacker';
  const orders = war.fronts.map((front) => sideOrder(war, front.id, opponentSide));
  const priorities = war.fronts.map((front) => sidePriority(war, front.id, opponentSide));
  const plans = playerPlansForWar(opponentId, war.id);
  const deception = deceptionPlansForEntity(opponentId).filter((plan) => plan.warId === war.id && ['succeeded', 'active', 'preparing'].includes(plan.status));
  const battles = battleMomentum(opponentId, war, territorialControl);
  const offensiveOrders = orders.filter((order) => order === 'offensive' || order === 'breakthrough').length;
  const breakthroughs = orders.filter((order) => order === 'breakthrough').length;
  const rapidPlans = plans.filter((plan) => plan.tempo === 'rapid').length;
  const concentrated = priorities.filter((priority) => priority === 'main').length;
  const visibleFronts = Math.max(1, war.fronts.length);
  const age = Math.max(0, war.elapsedDays);
  const observerRuntime = simulation.entities[observerId];
  const battleEvidence = Math.min(28, battles.count * 6);
  const technicalEvidence = observerRuntime ? observerRuntime.technology * .18 : 8;
  const timeEvidence = Math.min(22, age * .18);
  const confidence = clamp(18 + battleEvidence + technicalEvidence + timeEvidence);
  return {
    warId: war.id,
    observerId,
    opponentId,
    aggression: clamp((offensiveOrders / visibleFronts) * 72 + battles.momentum * .28),
    breakthroughBias: clamp((breakthroughs / visibleFronts) * 78 + plans.filter((plan) => plan.tempo === 'rapid' && plan.objective.toLowerCase().includes('romper')).length * 12),
    rapidTempoBias: clamp(plans.length ? rapidPlans / plans.length * 100 : offensiveOrders / visibleFronts * 52),
    deceptionReliance: clamp(deception.length * 26),
    concentrationBias: clamp((concentrated / visibleFronts) * 72 + plans.length * 7),
    opponentMomentum: battles.momentum,
    confidence,
    observedBattles: battles.count,
    updatedAtElapsedDay: simulation.elapsedDays,
  };
}

function chooseDoctrine(pattern: OpponentPattern, current?: DoctrineState): { doctrine: AdaptiveDoctrine; reserveRatio: number; reason: string } {
  if (pattern.confidence < 34) return { doctrine: current?.doctrine ?? 'balanced', reserveRatio: 22, reason: 'O comando ainda não possui evidência suficiente para uma mudança doutrinária ampla.' };
  if (pattern.breakthroughBias >= 58 || (pattern.aggression >= 68 && pattern.concentrationBias >= 58)) {
    return { doctrine: 'counter_breakthrough', reserveRatio: 30, reason: 'O adversário concentra forças e insiste em operações de ruptura; o comando está reforçando profundidade e reservas de contra-ataque.' };
  }
  if (pattern.rapidTempoBias >= 58) {
    return { doctrine: 'mobile_reserve', reserveRatio: 34, reason: 'O ritmo adversário é elevado; reservas móveis estão sendo preservadas para responder a mudanças rápidas de eixo.' };
  }
  if (pattern.deceptionReliance >= 46) {
    return { doctrine: 'defense_in_depth', reserveRatio: 36, reason: 'O adversário demonstrou dependência de engano e surpresa; o comando está evitando concentração excessiva em um único eixo.' };
  }
  if (pattern.opponentMomentum >= 66) {
    return { doctrine: 'elastic_defense', reserveRatio: 28, reason: 'O adversário mantém a iniciativa; a prioridade passou a ser conservar forças e reduzir a eficácia de avanços sucessivos.' };
  }
  if (pattern.opponentMomentum <= 36 && pattern.observedBattles >= 3) {
    return { doctrine: 'deliberate_counteroffensive', reserveRatio: 20, reason: 'O adversário perdeu impulso em combates recentes; o comando identificou uma janela para contraofensiva deliberada.' };
  }
  return { doctrine: 'balanced', reserveRatio: 24, reason: 'Nenhum padrão adversário domina a campanha; o comando mantém uma doutrina equilibrada.' };
}

function frontThreat(war: War, frontId: string, opponentSide: FrontSide, pattern: OpponentPattern) {
  const front = war.fronts.find((item) => item.id === frontId);
  if (!front) return 0;
  const order = sideOrder(war, frontId, opponentSide);
  const priority = sidePriority(war, frontId, opponentSide);
  const orderThreat = order === 'breakthrough' ? 34 : order === 'offensive' ? 24 : order === 'cautious' ? 9 : 2;
  const priorityThreat = priority === 'main' ? 28 : priority === 'high' ? 17 : priority === 'low' ? -6 : 7;
  const progressThreat = opponentSide === 'attacker' ? Math.max(0, front.progress - 50) * .45 : Math.max(0, 50 - front.progress) * .45;
  return clamp(orderThreat + priorityThreat + progressThreat + pattern.concentrationBias * .14);
}

function doctrineOrder(doctrine: AdaptiveDoctrine, primary: boolean, pattern: OpponentPattern): FrontOrder {
  if (doctrine === 'counter_breakthrough') return primary && pattern.opponentMomentum < 42 ? 'offensive' : 'defend';
  if (doctrine === 'defense_in_depth') return primary ? 'defend' : 'cautious';
  if (doctrine === 'mobile_reserve') return primary ? 'defend' : 'reserve';
  if (doctrine === 'elastic_defense') return primary ? 'cautious' : 'defend';
  if (doctrine === 'deliberate_counteroffensive') return primary ? 'offensive' : 'defend';
  return primary ? 'cautious' : 'defend';
}

function doctrinePriority(doctrine: AdaptiveDoctrine, primary: boolean): FrontPriority {
  if (primary) return doctrine === 'deliberate_counteroffensive' || doctrine === 'counter_breakthrough' ? 'main' : 'high';
  if (doctrine === 'mobile_reserve' || doctrine === 'defense_in_depth') return 'normal';
  return 'low';
}

function applyDoctrine(entityId: string, opponentId: string, war: War, doctrineState: DoctrineState, pattern: OpponentPattern, armyState: ArmyState, warState: WarState) {
  const ownSide = sideFor(war, entityId);
  const opponentSide = sideFor(war, opponentId);
  if (!ownSide || !opponentSide || !war.fronts.length) return { armyState, warState };
  const ranked = [...war.fronts].sort((a, b) => frontThreat(war, b.id, opponentSide, pattern) - frontThreat(war, a.id, opponentSide, pattern));
  const primary = ranked[0];
  let nextWar = warState;
  for (const front of war.fronts) {
    const isPrimary = front.id === primary.id;
    nextWar = setFrontPriority(nextWar, war.id, front.id, ownSide, doctrinePriority(doctrineState.doctrine, isPrimary));
    nextWar = setFrontOrder(nextWar, war.id, front.id, ownSide, doctrineOrder(doctrineState.doctrine, isPrimary, pattern));
  }

  const units = armyState.units.filter((unit) => unit.entityId === entityId);
  for (const unit of units) nextWar = clearUnitFrontAssignment(nextWar, war.id, unit.id);
  const reserveCount = Math.round(units.length * doctrineState.reserveRatio / 100);
  const committed = units.slice(0, Math.max(0, units.length - reserveCount));
  const secondary = ranked.slice(1);
  committed.forEach((unit, index) => {
    const front = index < Math.ceil(committed.length * .62) || !secondary.length ? primary : secondary[index % secondary.length];
    nextWar = assignUnitToFront(nextWar, war.id, front.id, ownSide, unit.id);
  });
  return { armyState, warState: nextWar };
}

function replacementCommander(entityId: string, warId: string, elapsedDay: number, current: Commander): Commander {
  const seed = hash(`${entityId}:${warId}:replacement:${elapsedDay}:${current.id}`);
  return {
    id: `${entityId}-adaptive-cmd-${elapsedDay}-${seed % 999}`,
    name: 'Comandante nomeado após revisão de campanha',
    skill: clamp(54 + seed % 23),
    logistics: clamp(50 + (seed >> 5) % 26),
    initiative: clamp(48 + (seed >> 10) % 29),
  };
}

function reviewCommand(entityId: string, war: War, pattern: OpponentPattern, doctrine: DoctrineState, simulation: SimulationState, armyState: ArmyState) {
  if (simulation.elapsedDays - doctrine.lastCommanderReviewElapsedDay < 90 || pattern.observedBattles < 4 || pattern.opponentMomentum < 64) return { armyState, reviewed: false };
  const units = armyState.units.filter((unit) => unit.entityId === entityId);
  if (!units.length) return { armyState, reviewed: false };
  const weakest = [...units].sort((a, b) => (a.commander.skill + a.commander.logistics + a.commander.initiative) - (b.commander.skill + b.commander.logistics + b.commander.initiative))[0];
  if (!weakest || weakest.commander.skill >= 68) return { armyState, reviewed: false };
  const replacement = replacementCommander(entityId, war.id, simulation.elapsedDays, weakest.commander);
  return {
    reviewed: true,
    armyState: {
      ...armyState,
      units: armyState.units.map((unit) => unit.id === weakest.id ? { ...unit, commander: replacement, organization: clamp(unit.organization - 3) } : unit),
    },
  };
}

function doctrineEvent(entityId: string, doctrine: AdaptiveDoctrine, reason: string, simulation: SimulationState): WorldEvent {
  return {
    id: `adaptive-doctrine-${entityId}-${simulation.elapsedDays}-${doctrine}`,
    date: simulation.date,
    entityId,
    category: 'military',
    title: 'Comando ajustou a doutrina de campanha',
    text: reason,
  };
}

export function doctrineLabel(doctrine: AdaptiveDoctrine, year: number) {
  if (doctrine === 'defense_in_depth') return year < 1850 ? 'Defesa escalonada' : 'Defesa em profundidade';
  if (doctrine === 'mobile_reserve') return 'Reserva móvel';
  if (doctrine === 'elastic_defense') return year < 1850 ? 'Defesa flexível' : 'Defesa elástica';
  if (doctrine === 'counter_breakthrough') return year < 1900 ? 'Defesa contra concentração' : 'Resposta anti-ruptura';
  if (doctrine === 'deliberate_counteroffensive') return 'Contraofensiva deliberada';
  return 'Doutrina equilibrada';
}

export function processAdaptiveEnemyCommand(playerEntityId: string, simulation: SimulationState, armyState: ArmyState, warState: WarState, territorialControl: TerritorialControlState) {
  const state = rootState();
  let nextWar = warState;
  let nextArmy = armyState;
  let nextSimulation = simulation;
  let patterns = [...state.patterns];
  let doctrines = [...state.doctrines];
  let changes = [...state.changes];
  let changed = false;

  for (const war of warState.wars) {
    if (war.status !== 'active' || !sideFor(war, playerEntityId)) continue;
    for (const aiEntityId of enemyIds(war, playerEntityId)) {
      if (!simulation.entities[aiEntityId]) continue;
      const existing = doctrines.find((item) => item.warId === war.id && item.entityId === aiEntityId && item.opponentId === playerEntityId);
      if (existing && simulation.elapsedDays - existing.lastProcessedElapsedDay < 28) continue;
      const pattern = observeOpponent(aiEntityId, playerEntityId, war, simulation, territorialControl);
      patterns = [pattern, ...patterns.filter((item) => !(item.warId === war.id && item.observerId === aiEntityId && item.opponentId === playerEntityId))].slice(0, 120);
      const choice = chooseDoctrine(pattern, existing);
      const doctrine: DoctrineState = {
        warId: war.id,
        entityId: aiEntityId,
        opponentId: playerEntityId,
        doctrine: choice.doctrine,
        previousDoctrine: existing?.doctrine,
        confidence: pattern.confidence,
        reserveRatio: choice.reserveRatio,
        reason: choice.reason,
        adoptedAtElapsedDay: existing?.doctrine === choice.doctrine ? existing.adoptedAtElapsedDay : simulation.elapsedDays,
        lastProcessedElapsedDay: simulation.elapsedDays,
        lastCommanderReviewElapsedDay: existing?.lastCommanderReviewElapsedDay ?? war.elapsedDays,
      };
      doctrines = [doctrine, ...doctrines.filter((item) => !(item.warId === war.id && item.entityId === aiEntityId && item.opponentId === playerEntityId))].slice(0, 120);
      const applied = applyDoctrine(aiEntityId, playerEntityId, war, doctrine, pattern, nextArmy, nextWar);
      nextArmy = applied.armyState;
      nextWar = applied.warState;
      if (!existing || existing.doctrine !== doctrine.doctrine) {
        changes = [{ id: `doctrine-change-${war.id}-${aiEntityId}-${simulation.elapsedDays}`, warId: war.id, entityId: aiEntityId, from: existing?.doctrine, to: doctrine.doctrine, reason: doctrine.reason, elapsedDay: simulation.elapsedDays }, ...changes].slice(0, 80);
        nextSimulation = { ...nextSimulation, events: [doctrineEvent(aiEntityId, doctrine.doctrine, doctrine.reason, nextSimulation), ...nextSimulation.events].slice(0, 50) };
        changed = true;
      }
      const reviewed = reviewCommand(aiEntityId, war, pattern, doctrine, nextSimulation, nextArmy);
      if (reviewed.reviewed) {
        nextArmy = reviewed.armyState;
        doctrines = doctrines.map((item) => item.warId === war.id && item.entityId === aiEntityId ? { ...item, lastCommanderReviewElapsedDay: simulation.elapsedDays } : item);
        nextSimulation = {
          ...nextSimulation,
          events: [{
            id: `command-review-${war.id}-${aiEntityId}-${simulation.elapsedDays}`,
            date: simulation.date,
            entityId: aiEntityId,
            category: 'military',
            title: 'Revisão do comando de campanha',
            text: 'Após uma sequência de resultados desfavoráveis, a liderança militar substituiu um comandante de desempenho insuficiente.',
          }, ...nextSimulation.events].slice(0, 50),
        };
        changed = true;
      }
      changed = true;
    }
  }

  if (changed) publish({ patterns, doctrines, changes });
  return { simulation: nextSimulation, armyState: nextArmy, warState: nextWar, changed };
}

export function perceivedDoctrineFor(playerEntityId: string, warId: string, enemyId: string, simulation: SimulationState) {
  const doctrine = rootState().doctrines.find((item) => item.warId === warId && item.entityId === enemyId && item.opponentId === playerEntityId);
  const war = (globalThis as { __WORLD_STATE_LAST_WAR_STATE__?: WarState }).__WORLD_STATE_LAST_WAR_STATE__?.wars.find((item) => item.id === warId);
  let confidence = 0;
  if (war) {
    const reports = war.fronts.map((front) => latestFrontIntelligence(playerEntityId, warId, front.id, simulation)).filter(Boolean);
    confidence = reports.length ? reports.reduce((sum, report) => sum + (report?.confidenceScore ?? 0), 0) / reports.length : 0;
  }
  return { doctrine, visibilityConfidence: confidence };
}
