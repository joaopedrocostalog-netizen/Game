import type { ArmyState } from './army';
import { jointForceState } from './jointOrganizationForces';
import { latestFrontIntelligence, militaryIntelligenceState } from './militaryIntelligence';
import { theaterCommandState } from './multinationalTheaterCommand';
import type { SimulationState, WorldEvent } from './simulation';
import {
  assignUnitToFront,
  clearUnitFrontAssignment,
  setFrontOrder,
  setFrontPriority,
  type FrontOrder,
  type WarState,
} from './war';

export type OperationPhase = 'preparation' | 'concentration' | 'assault' | 'exploitation' | 'consolidation';
export type OperationStatus = 'preparing' | 'executing' | 'paused' | 'completed' | 'aborted';
export type OperationTempo = 'deliberate' | 'standard' | 'rapid';
export type OperationIntelligenceAssessment = 'unknown' | 'poor' | 'adequate' | 'good' | 'excellent';
export type OperationSurpriseState = 'none' | 'advantage' | 'risk' | 'suffered';
export type EnemyOperationalReaction = 'none' | 'reinforcing' | 'entrenching' | 'counterattack';

export type OperationalCampaignPlan = {
  id: string;
  hqId: string;
  forceId: string;
  warId: string;
  frontId: string;
  name: string;
  objective: string;
  status: OperationStatus;
  phase: OperationPhase;
  tempo: OperationTempo;
  createdAtElapsedDay: number;
  plannedStartElapsedDay: number;
  phaseStartedAtElapsedDay: number;
  reserveRatio: number;
  logisticsRequirement: number;
  preparationProgress: number;
  executionProgress: number;
  risk: number;
  lastProcessedElapsedDay: number;
  intelligenceAssessment: OperationIntelligenceAssessment;
  surpriseState: OperationSurpriseState;
  compromised: boolean;
  enemyReaction: EnemyOperationalReaction;
  lastIntelConfidence: number;
  compromisedAtElapsedDay?: number;
  surpriseAtElapsedDay?: number;
  pauseReason?: string;
  abortReason?: string;
};

type OperationalPlanState = { plans: OperationalCampaignPlan[] };
type OperationalPlanGlobal = typeof globalThis & { __WORLD_STATE_OPERATIONAL_PLANS__?: OperationalPlanState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function rootState(): OperationalPlanState {
  const root = globalThis as OperationalPlanGlobal;
  if (!root.__WORLD_STATE_OPERATIONAL_PLANS__) root.__WORLD_STATE_OPERATIONAL_PLANS__ = { plans: [] };
  return root.__WORLD_STATE_OPERATIONAL_PLANS__;
}

function publish(state: OperationalPlanState) {
  (globalThis as OperationalPlanGlobal).__WORLD_STATE_OPERATIONAL_PLANS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-operational-plans', { detail: state }));
}

export function operationalPlanState() {
  return { plans: rootState().plans.map((plan) => ({ ...plan })) };
}

export function resetOperationalCampaignPlans() {
  publish({ plans: [] });
}

function phaseDuration(phase: OperationPhase, tempo: OperationTempo, year: number) {
  const era = year < 1700 ? 1.7 : year < 1900 ? 1.35 : year < 1945 ? 1.15 : 1;
  const tempoFactor = tempo === 'rapid' ? .72 : tempo === 'deliberate' ? 1.3 : 1;
  const base = phase === 'preparation' ? 30 : phase === 'concentration' ? 18 : phase === 'assault' ? 36 : phase === 'exploitation' ? 24 : 20;
  return Math.max(5, Math.round(base * era * tempoFactor));
}

function nextPhase(phase: OperationPhase): OperationPhase | undefined {
  if (phase === 'preparation') return 'concentration';
  if (phase === 'concentration') return 'assault';
  if (phase === 'assault') return 'exploitation';
  if (phase === 'exploitation') return 'consolidation';
  return undefined;
}

function forceById(forceId: string) {
  return jointForceState().forces.find((force) => force.id === forceId && force.status !== 'dissolved');
}

function hqById(hqId: string) {
  return theaterCommandState().headquarters.find((hq) => hq.id === hqId);
}

function jointUnits(plan: OperationalCampaignPlan, armyState: ArmyState) {
  const force = forceById(plan.forceId);
  if (!force) return [];
  const ids = new Set(force.contributions.flatMap((item) => item.unitIds));
  return armyState.units.filter((unit) => ids.has(unit.id));
}

function operationalMetrics(plan: OperationalCampaignPlan, armyState: ArmyState) {
  const units = jointUnits(plan, armyState);
  if (!units.length) return { supply: 0, organization: 0, morale: 0, readiness: 0 };
  const supply = units.reduce((sum, unit) => sum + unit.supply, 0) / units.length;
  const organization = units.reduce((sum, unit) => sum + unit.organization, 0) / units.length;
  const morale = units.reduce((sum, unit) => sum + unit.morale, 0) / units.length;
  const readiness = units.reduce((sum, unit) => sum + unit.strength + unit.supply + unit.organization + unit.morale + unit.equipment, 0) / (units.length * 5);
  return { supply, organization, morale, readiness };
}

function phaseOrder(phase: OperationPhase, tempo: OperationTempo): FrontOrder {
  if (phase === 'preparation') return 'reserve';
  if (phase === 'concentration') return 'cautious';
  if (phase === 'assault') return tempo === 'rapid' ? 'breakthrough' : 'offensive';
  if (phase === 'exploitation') return 'offensive';
  return 'defend';
}

function eventFor(plan: OperationalCampaignPlan, simulation: SimulationState, title: string, text: string): WorldEvent {
  return {
    id: `operation-${plan.id}-${plan.phase}-${simulation.elapsedDays}-${title}`,
    date: simulation.date,
    category: 'military',
    title,
    text,
  };
}

function assessmentFor(confidence: number, freshness?: string): OperationIntelligenceAssessment {
  const freshnessPenalty = freshness === 'obsolete' ? 24 : freshness === 'stale' ? 14 : freshness === 'recent' ? 5 : 0;
  const effective = confidence - freshnessPenalty;
  if (effective >= 82) return 'excellent';
  if (effective >= 66) return 'good';
  if (effective >= 48) return 'adequate';
  if (effective >= 28) return 'poor';
  return 'unknown';
}

function intelligenceProfile(plan: OperationalCampaignPlan, simulation: SimulationState) {
  const hq = hqById(plan.hqId);
  if (!hq) return { assessment: 'unknown' as OperationIntelligenceAssessment, confidence: 0, riskModifier: 18, progressMultiplier: .68, surprisePressure: 74 };
  const report = latestFrontIntelligence(hq.commanderEntityId, plan.warId, plan.frontId, simulation);
  if (!report) return { assessment: 'unknown' as OperationIntelligenceAssessment, confidence: 0, riskModifier: 18, progressMultiplier: .68, surprisePressure: 74 };
  const assessment = assessmentFor(report.confidenceScore, report.freshness);
  const riskModifier = report.freshness === 'obsolete' ? 22 : report.freshness === 'stale' ? 14 : report.freshness === 'recent' ? 6 : assessment === 'excellent' ? -8 : assessment === 'good' ? -4 : assessment === 'poor' ? 10 : 2;
  const progressMultiplier = assessment === 'excellent' ? 1.18 : assessment === 'good' ? 1.1 : assessment === 'adequate' ? 1 : assessment === 'poor' ? .82 : .68;
  const surprisePressure = clamp(report.uncertainty * .68 + (report.surpriseRisk === 'severe' ? 28 : report.surpriseRisk === 'elevated' ? 18 : report.surpriseRisk === 'guarded' ? 8 : -4));
  return { assessment, confidence: report.confidenceScore, riskModifier, progressMultiplier, surprisePressure };
}

function sideMembers(plan: OperationalCampaignPlan, warState: WarState) {
  const hq = hqById(plan.hqId);
  const war = warState.wars.find((item) => item.id === plan.warId);
  if (!hq || !war) return { friendly: [] as string[], enemy: [] as string[] };
  return hq.side === 'attackers' ? { friendly: war.attackers, enemy: war.defenders } : { friendly: war.defenders, enemy: war.attackers };
}

function detectionProfile(plan: OperationalCampaignPlan, simulation: SimulationState, warState: WarState) {
  const hq = hqById(plan.hqId);
  const sides = sideMembers(plan, warState);
  if (!hq || !sides.enemy.length) return { detected: false, score: 0, reaction: 'none' as EnemyOperationalReaction };
  const enemyRuntimes = sides.enemy.map((id) => simulation.entities[id]).filter(Boolean);
  const enemyTechnology = enemyRuntimes.length ? enemyRuntimes.reduce((sum, item) => sum + item.technology, 0) / enemyRuntimes.length : 35;
  const enemyTreasury = enemyRuntimes.length ? enemyRuntimes.reduce((sum, item) => sum + item.treasuryIndex, 0) / enemyRuntimes.length : 35;
  const daysVisible = Math.max(0, simulation.elapsedDays - plan.createdAtElapsedDay);
  const deception = militaryIntelligenceState().deception[`${plan.warId}::${hq.side}`] ?? 'none';
  const concealment = deception === 'concealment' ? 17 : deception === 'false_concentration' ? 11 : deception === 'feigned_weakness' ? 7 : 0;
  const tempoExposure = plan.tempo === 'rapid' ? 12 : plan.tempo === 'deliberate' ? -5 : 3;
  const phaseExposure = plan.phase === 'concentration' ? 13 : plan.phase === 'assault' ? 18 : plan.phase === 'preparation' ? 5 : 9;
  const eraAwareness = simulation.date.year < 1700 ? -13 : simulation.date.year < 1900 ? -6 : simulation.date.year < 1945 ? 1 : 7;
  const score = clamp(enemyTechnology * .34 + enemyTreasury * .1 + daysVisible * .42 + tempoExposure + phaseExposure + eraAwareness - concealment);
  const roll = hash(`${plan.id}:detection:${Math.floor(simulation.elapsedDays / 7)}`) % 100;
  const detected = score >= 38 && roll < score;
  const reaction: EnemyOperationalReaction = !detected ? 'none' : score >= 78 ? 'counterattack' : score >= 62 ? 'entrenching' : 'reinforcing';
  return { detected, score, reaction };
}

function applyEnemyReaction(plan: OperationalCampaignPlan, reaction: EnemyOperationalReaction, warState: WarState) {
  const hq = hqById(plan.hqId);
  const war = warState.wars.find((item) => item.id === plan.warId && item.status === 'active');
  if (!hq || !war || reaction === 'none') return warState;
  const enemySide = hq.side === 'attackers' ? 'defender' : 'attacker';
  let next = setFrontPriority(warState, war.id, plan.frontId, enemySide, reaction === 'counterattack' ? 'main' : 'high');
  next = setFrontOrder(next, war.id, plan.frontId, enemySide, reaction === 'counterattack' ? 'offensive' : reaction === 'entrenching' ? 'defend' : 'cautious');
  return next;
}

function applyOperationalSurprise(plan: OperationalCampaignPlan, simulation: SimulationState, armyState: ArmyState, pressure: number) {
  const units = jointUnits(plan, armyState);
  if (!units.length) return { armyState, suffered: false };
  const roll = hash(`${plan.id}:surprise:${simulation.elapsedDays}`) % 100;
  if (roll >= pressure) return { armyState, suffered: false };
  const severity = clamp(4 + pressure * .08, 4, 13);
  const ids = new Set(units.map((unit) => unit.id));
  return {
    suffered: true,
    armyState: {
      ...armyState,
      units: armyState.units.map((unit) => ids.has(unit.id) ? {
        ...unit,
        organization: clamp(unit.organization - severity),
        morale: clamp(unit.morale - severity * .65),
        supply: clamp(unit.supply - severity * .35),
      } : unit),
    },
  };
}

export function createOperationalCampaignPlan(
  hqId: string,
  frontId: string,
  objective: string,
  simulation: SimulationState,
  tempo: OperationTempo = 'standard',
  reserveRatio = 25,
) {
  const hq = hqById(hqId);
  const force = hq ? forceById(hq.forceId) : undefined;
  if (!hq || !force || force.status !== 'deployed') return undefined;
  if (rootState().plans.some((plan) => plan.hqId === hqId && plan.frontId === frontId && !['completed', 'aborted'].includes(plan.status))) return undefined;
  const prepDays = phaseDuration('preparation', tempo, simulation.date.year);
  const logisticsRequirement = tempo === 'rapid' ? 68 : tempo === 'deliberate' ? 54 : 60;
  const intel = latestFrontIntelligence(hq.commanderEntityId, hq.warId, frontId, simulation);
  const intelligenceAssessment = intel ? assessmentFor(intel.confidenceScore, intel.freshness) : 'unknown';
  const plan: OperationalCampaignPlan = {
    id: `operation-${hqId}-${frontId}-${simulation.elapsedDays}`,
    hqId,
    forceId: hq.forceId,
    warId: hq.warId,
    frontId,
    name: simulation.date.year < 1900 ? `Plano de campanha — ${objective}` : `Operação — ${objective}`,
    objective,
    status: 'preparing',
    phase: 'preparation',
    tempo,
    createdAtElapsedDay: simulation.elapsedDays,
    plannedStartElapsedDay: simulation.elapsedDays + prepDays,
    phaseStartedAtElapsedDay: simulation.elapsedDays,
    reserveRatio: clamp(reserveRatio, 10, 60),
    logisticsRequirement,
    preparationProgress: 0,
    executionProgress: 0,
    risk: tempo === 'rapid' ? 62 : tempo === 'deliberate' ? 34 : 46,
    lastProcessedElapsedDay: simulation.elapsedDays,
    intelligenceAssessment,
    surpriseState: intelligenceAssessment === 'excellent' || intelligenceAssessment === 'good' ? 'advantage' : intelligenceAssessment === 'poor' || intelligenceAssessment === 'unknown' ? 'risk' : 'none',
    compromised: false,
    enemyReaction: 'none',
    lastIntelConfidence: intel?.confidenceScore ?? 0,
  };
  publish({ plans: [plan, ...rootState().plans].slice(0, 40) });
  return plan;
}

export function pauseOperationalPlan(planId: string, reason = 'Ordem do comando') {
  const state = rootState();
  const plan = state.plans.find((item) => item.id === planId && !['completed', 'aborted'].includes(item.status));
  if (!plan) return undefined;
  const updated = { ...plan, status: 'paused' as const, pauseReason: reason };
  publish({ plans: state.plans.map((item) => item.id === plan.id ? updated : item) });
  return updated;
}

export function resumeOperationalPlan(planId: string, elapsedDays: number) {
  const state = rootState();
  const plan = state.plans.find((item) => item.id === planId && item.status === 'paused');
  if (!plan) return undefined;
  const updated = { ...plan, status: plan.phase === 'preparation' ? 'preparing' as const : 'executing' as const, pauseReason: undefined, phaseStartedAtElapsedDay: elapsedDays };
  publish({ plans: state.plans.map((item) => item.id === plan.id ? updated : item) });
  return updated;
}

export function abortOperationalPlan(planId: string, reason = 'Operação cancelada') {
  const state = rootState();
  const plan = state.plans.find((item) => item.id === planId && !['completed', 'aborted'].includes(item.status));
  if (!plan) return undefined;
  const updated = { ...plan, status: 'aborted' as const, abortReason: reason };
  publish({ plans: state.plans.map((item) => item.id === plan.id ? updated : item) });
  return updated;
}

function applyPhaseOrders(plan: OperationalCampaignPlan, armyState: ArmyState, warState: WarState) {
  const hq = hqById(plan.hqId);
  const war = warState.wars.find((item) => item.id === plan.warId && item.status === 'active');
  if (!hq || !war) return { armyState, warState };
  const units = jointUnits(plan, armyState);
  const side = hq.side === 'attackers' ? 'attacker' : 'defender';
  let nextWar = warState;
  const nextUnits = armyState.units.map((unit) => ({ ...unit }));
  const order = phaseOrder(plan.phase, plan.tempo);

  nextWar = setFrontPriority(nextWar, war.id, plan.frontId, side, plan.phase === 'assault' ? 'main' : plan.phase === 'exploitation' ? 'high' : plan.phase === 'consolidation' ? 'normal' : 'high');
  nextWar = setFrontOrder(nextWar, war.id, plan.frontId, side, order);
  for (const unit of units) nextWar = clearUnitFrontAssignment(nextWar, war.id, unit.id);

  const reserveCount = Math.round(units.length * plan.reserveRatio / 100);
  const committed = plan.phase === 'preparation' ? [] : units.slice(0, Math.max(0, units.length - reserveCount));
  for (const unit of committed) nextWar = assignUnitToFront(nextWar, war.id, plan.frontId, side, unit.id);

  const committedIds = new Set(committed.map((unit) => unit.id));
  for (let i = 0; i < nextUnits.length; i += 1) {
    const unit = nextUnits[i];
    if (!units.some((candidate) => candidate.id === unit.id)) continue;
    if (plan.phase === 'preparation') nextUnits[i] = { ...unit, order: 'prepare', destinationId: undefined };
    else if (committedIds.has(unit.id)) nextUnits[i] = { ...unit, order: plan.phase === 'consolidation' ? 'hold' : 'prepare', destinationId: undefined };
    else nextUnits[i] = { ...unit, order: 'hold', destinationId: undefined };
  }
  return { armyState: { ...armyState, units: nextUnits }, warState: nextWar };
}

export function processOperationalCampaignPlans(simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  let nextArmy = armyState;
  let nextWar = warState;
  let nextSimulation = simulation;
  let changed = false;
  const plans = state.plans.map((original) => {
    let plan = { ...original };
    if (['completed', 'aborted'].includes(plan.status) || plan.status === 'paused' || plan.lastProcessedElapsedDay >= simulation.elapsedDays) return plan;
    const war = nextWar.wars.find((item) => item.id === plan.warId);
    if (!war || war.status !== 'active') {
      changed = true;
      return { ...plan, status: 'aborted' as const, abortReason: 'A guerra terminou antes da conclusão da operação.', lastProcessedElapsedDay: simulation.elapsedDays };
    }

    const intel = intelligenceProfile(plan, nextSimulation);
    plan.intelligenceAssessment = intel.assessment;
    plan.lastIntelConfidence = intel.confidence;
    plan.surpriseState = intel.assessment === 'excellent' || intel.assessment === 'good' ? 'advantage' : intel.assessment === 'poor' || intel.assessment === 'unknown' ? 'risk' : 'none';

    if (!plan.compromised && (plan.phase === 'preparation' || plan.phase === 'concentration')) {
      const detection = detectionProfile(plan, nextSimulation, nextWar);
      if (detection.detected) {
        plan.compromised = true;
        plan.compromisedAtElapsedDay = simulation.elapsedDays;
        plan.enemyReaction = detection.reaction;
        plan.risk = clamp(plan.risk + 8 + detection.score * .08);
        nextWar = applyEnemyReaction(plan, detection.reaction, nextWar);
        nextSimulation = {
          ...nextSimulation,
          events: [eventFor(plan, nextSimulation, 'Preparação operacional comprometida', `${plan.name} apresenta sinais de ter sido detectada pelo adversário. A frente inimiga está reagindo antes do ataque.`), ...nextSimulation.events].slice(0, 50),
        };
        changed = true;
      }
    } else if (plan.compromised && plan.enemyReaction !== 'none') {
      nextWar = applyEnemyReaction(plan, plan.enemyReaction, nextWar);
    }

    const metrics = operationalMetrics(plan, nextArmy);
    const phaseElapsed = simulation.elapsedDays - plan.phaseStartedAtElapsedDay;
    const duration = phaseDuration(plan.phase, plan.tempo, simulation.date.year);
    const logisticsFactor = clamp(metrics.supply / Math.max(1, plan.logisticsRequirement), 0, 1.25);
    const commandFactor = clamp((metrics.organization + metrics.morale) / 140, .35, 1.2);
    const intelPrepFactor = intel.assessment === 'excellent' ? 1.08 : intel.assessment === 'good' ? 1.04 : intel.assessment === 'poor' ? .88 : intel.assessment === 'unknown' ? .76 : 1;

    if (plan.phase === 'preparation') {
      plan.preparationProgress = clamp(((phaseElapsed / duration) * 72 + logisticsFactor * 18 + commandFactor * 10) * intelPrepFactor - (plan.compromised ? 5 : 0));
      if (metrics.supply < plan.logisticsRequirement * .55) {
        plan.status = 'paused';
        plan.pauseReason = 'Preparação suspensa: abastecimento abaixo do mínimo operacional.';
        nextSimulation = { ...nextSimulation, events: [eventFor(plan, nextSimulation, 'Operação atrasada por logística', `${plan.name} foi suspensa porque o abastecimento das formações ficou abaixo do necessário.`), ...nextSimulation.events].slice(0, 50) };
        changed = true;
        return { ...plan, lastProcessedElapsedDay: simulation.elapsedDays };
      }
    }

    const enteringAssault = plan.phase === 'assault' && plan.surpriseAtElapsedDay === undefined;
    if (enteringAssault && intel.surprisePressure >= 42) {
      const surprise = applyOperationalSurprise(plan, nextSimulation, nextArmy, clamp(intel.surprisePressure + (plan.compromised ? 12 : 0)));
      if (surprise.suffered) {
        nextArmy = surprise.armyState;
        plan.surpriseState = 'suffered';
        plan.surpriseAtElapsedDay = simulation.elapsedDays;
        plan.risk = clamp(plan.risk + 13);
        nextSimulation = {
          ...nextSimulation,
          events: [eventFor(plan, nextSimulation, 'Surpresa operacional', `${plan.name} encontrou resistência ou concentração inimiga diferente do quadro esperado. A organização inicial do ataque foi prejudicada.`), ...nextSimulation.events].slice(0, 50),
        };
        changed = true;
      } else {
        plan.surpriseAtElapsedDay = simulation.elapsedDays;
      }
    }

    const applied = applyPhaseOrders(plan, nextArmy, nextWar);
    nextArmy = applied.armyState;
    nextWar = applied.warState;

    const front = nextWar.wars.find((item) => item.id === plan.warId)?.fronts.find((item) => item.id === plan.frontId);
    const frontProgress = front?.progress ?? 50;
    const compromisePenalty = plan.compromised ? .82 : 1;
    const surprisePenalty = plan.surpriseState === 'suffered' ? .72 : 1;
    const executionGain = plan.phase === 'assault' || plan.phase === 'exploitation'
      ? Math.max(0, (frontProgress - 50) * .15) * intel.progressMultiplier * compromisePenalty * surprisePenalty
      : 0;
    plan.executionProgress = clamp(plan.executionProgress + executionGain);
    plan.risk = clamp(plan.risk + (100 - metrics.readiness) * .025 + (plan.phase === 'assault' ? 1.5 : -.3) + intel.riskModifier * .08 + (plan.compromised ? .8 : 0));

    if ((plan.phase === 'assault' || plan.phase === 'exploitation') && (metrics.supply < 22 || metrics.morale < 24 || metrics.organization < 22)) {
      plan.status = 'paused';
      plan.pauseReason = 'A operação perdeu sustentação suficiente para prosseguir com segurança.';
      nextSimulation = { ...nextSimulation, events: [eventFor(plan, nextSimulation, 'Operação interrompida', `${plan.name} foi pausada após queda crítica de logística, moral ou organização.`), ...nextSimulation.events].slice(0, 50) };
      changed = true;
      return { ...plan, lastProcessedElapsedDay: simulation.elapsedDays };
    }

    const intelDelay = intel.assessment === 'poor' ? 4 : intel.assessment === 'unknown' ? 8 : 0;
    const readyForNext = phaseElapsed >= duration + intelDelay || (plan.phase === 'assault' && frontProgress >= 68) || (plan.phase === 'exploitation' && frontProgress >= 78);
    if (readyForNext) {
      const following = nextPhase(plan.phase);
      if (!following) {
        plan.status = 'completed';
        plan.executionProgress = 100;
        nextSimulation = { ...nextSimulation, events: [eventFor(plan, nextSimulation, 'Operação concluída', `${plan.name} concluiu a fase de consolidação e encerrou seu ciclo operacional.`), ...nextSimulation.events].slice(0, 50) };
      } else {
        plan.phase = following;
        plan.status = following === 'preparation' ? 'preparing' : 'executing';
        plan.phaseStartedAtElapsedDay = simulation.elapsedDays;
        plan.pauseReason = undefined;
        nextSimulation = { ...nextSimulation, events: [eventFor(plan, nextSimulation, 'Nova fase operacional', `${plan.name} avançou para a fase ${following}.`), ...nextSimulation.events].slice(0, 50) };
      }
      changed = true;
    }
    plan.lastProcessedElapsedDay = simulation.elapsedDays;
    return plan;
  });

  publish({ plans });
  return { simulation: nextSimulation, armyState: nextArmy, warState: nextWar, changed: changed || nextArmy !== armyState || nextWar !== warState };
}

export function plansForHeadquarters(hqId: string) {
  return rootState().plans.filter((plan) => plan.hqId === hqId);
}
