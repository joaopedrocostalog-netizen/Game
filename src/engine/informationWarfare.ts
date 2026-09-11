import type { ArmyState } from './army';
import { militaryIntelligenceState } from './militaryIntelligence';
import { operationalPlanState } from './operationalCampaignPlans';
import type { SimulationState, WorldEvent } from './simulation';
import { setFrontOrder, setFrontPriority, type WarState } from './war';

export type OperationalSecurityPosture = 'open' | 'standard' | 'restricted' | 'compartmented';
export type IntelligenceIncidentType = 'plan_leak' | 'communications_intercept' | 'captured_documents' | 'double_agent';
export type IntelligenceIncidentSeverity = 'minor' | 'significant' | 'major' | 'critical';
export type DeceptionPlanStatus = 'preparing' | 'active' | 'succeeded' | 'failed' | 'exposed';

export type IntelligenceIncident = {
  id: string;
  observerId: string;
  targetId: string;
  warId: string;
  type: IntelligenceIncidentType;
  severity: IntelligenceIncidentSeverity;
  detectedAtElapsedDay: number;
  frontId?: string;
  planId?: string;
  confidence: number;
  text: string;
};

export type StrategicDeceptionPlan = {
  id: string;
  ownerId: string;
  targetId: string;
  warId: string;
  decoyFrontId: string;
  trueFrontId?: string;
  createdAtElapsedDay: number;
  activationElapsedDay: number;
  credibility: number;
  secrecy: number;
  status: DeceptionPlanStatus;
  enemyReaction?: 'none' | 'watching' | 'reinforcing' | 'committed';
  resolvedAtElapsedDay?: number;
};

export type InformationWarfareState = {
  security: Record<string, OperationalSecurityPosture>;
  incidents: IntelligenceIncident[];
  deceptionPlans: StrategicDeceptionPlan[];
  lastProcessedElapsedDay: number;
};

type InformationWarfareGlobal = typeof globalThis & { __WORLD_STATE_INFORMATION_WARFARE__?: InformationWarfareState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function rootState(): InformationWarfareState {
  const root = globalThis as InformationWarfareGlobal;
  if (!root.__WORLD_STATE_INFORMATION_WARFARE__) root.__WORLD_STATE_INFORMATION_WARFARE__ = { security: {}, incidents: [], deceptionPlans: [], lastProcessedElapsedDay: 0 };
  return root.__WORLD_STATE_INFORMATION_WARFARE__;
}

function publish(state: InformationWarfareState) {
  (globalThis as InformationWarfareGlobal).__WORLD_STATE_INFORMATION_WARFARE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-information-warfare', { detail: state }));
}

export function informationWarfareState() {
  const state = rootState();
  return {
    security: { ...state.security },
    incidents: state.incidents.map((item) => ({ ...item })),
    deceptionPlans: state.deceptionPlans.map((item) => ({ ...item })),
    lastProcessedElapsedDay: state.lastProcessedElapsedDay,
  };
}

export function resetInformationWarfare() {
  publish({ security: {}, incidents: [], deceptionPlans: [], lastProcessedElapsedDay: 0 });
}

export function setOperationalSecurity(entityId: string, posture: OperationalSecurityPosture) {
  const state = rootState();
  publish({ ...state, security: { ...state.security, [entityId]: posture } });
}

function securityScore(posture: OperationalSecurityPosture) {
  if (posture === 'compartmented') return 86;
  if (posture === 'restricted') return 72;
  if (posture === 'standard') return 55;
  return 32;
}

export function operationalSecurityModifier(entityId: string) {
  const posture = rootState().security[entityId] ?? 'standard';
  return (securityScore(posture) - 55) * .42;
}

export function planExposureModifier(planId: string) {
  const incidents = rootState().incidents.filter((item) => item.planId === planId);
  return clamp(incidents.reduce((sum, item) => sum + (item.severity === 'critical' ? 24 : item.severity === 'major' ? 16 : item.severity === 'significant' ? 9 : 4), 0), 0, 38);
}

function opposingSide(warState: WarState, warId: string, entityId: string) {
  const war = warState.wars.find((item) => item.id === warId && item.status === 'active');
  if (!war) return undefined;
  if (war.attackers.includes(entityId)) return { war, ownSide: 'attacker' as const, enemySide: 'defender' as const, enemies: war.defenders };
  if (war.defenders.includes(entityId)) return { war, ownSide: 'defender' as const, enemySide: 'attacker' as const, enemies: war.attackers };
  return undefined;
}

function averageCapability(ids: string[], simulation: SimulationState) {
  const entities = ids.map((id) => simulation.entities[id]).filter(Boolean);
  if (!entities.length) return { technology: 35, treasury: 35 };
  return {
    technology: entities.reduce((sum, item) => sum + item.technology, 0) / entities.length,
    treasury: entities.reduce((sum, item) => sum + item.treasuryIndex, 0) / entities.length,
  };
}

function incidentSeverity(score: number): IntelligenceIncidentSeverity {
  if (score >= 82) return 'critical';
  if (score >= 68) return 'major';
  if (score >= 50) return 'significant';
  return 'minor';
}

function incidentType(seed: number, year: number): IntelligenceIncidentType {
  if (year < 1850) return seed % 3 === 0 ? 'captured_documents' : seed % 3 === 1 ? 'double_agent' : 'plan_leak';
  return seed % 4 === 0 ? 'communications_intercept' : seed % 4 === 1 ? 'captured_documents' : seed % 4 === 2 ? 'double_agent' : 'plan_leak';
}

export function createStrategicDeceptionPlan(ownerId: string, targetId: string, warId: string, decoyFrontId: string, trueFrontId: string | undefined, simulation: SimulationState, warState: WarState) {
  const sides = opposingSide(warState, warId, ownerId);
  if (!sides || !sides.enemies.includes(targetId) || !sides.war.fronts.some((front) => front.id === decoyFrontId)) return undefined;
  if (rootState().deceptionPlans.some((plan) => plan.ownerId === ownerId && plan.warId === warId && ['preparing', 'active'].includes(plan.status))) return undefined;
  const runtime = simulation.entities[ownerId];
  if (!runtime) return undefined;
  const posture = rootState().security[ownerId] ?? 'standard';
  const credibility = clamp(38 + runtime.technology * .22 + runtime.treasuryIndex * .11 + securityScore(posture) * .19);
  const secrecy = clamp(securityScore(posture) + runtime.technology * .12 - 8);
  const preparationDays = simulation.date.year < 1700 ? 35 : simulation.date.year < 1900 ? 24 : simulation.date.year < 1945 ? 16 : 10;
  const plan: StrategicDeceptionPlan = {
    id: `deception-${ownerId}-${warId}-${simulation.elapsedDays}`,
    ownerId,
    targetId,
    warId,
    decoyFrontId,
    trueFrontId,
    createdAtElapsedDay: simulation.elapsedDays,
    activationElapsedDay: simulation.elapsedDays + preparationDays,
    credibility,
    secrecy,
    status: 'preparing',
    enemyReaction: 'none',
  };
  const state = rootState();
  publish({ ...state, deceptionPlans: [plan, ...state.deceptionPlans].slice(0, 60) });
  return plan;
}

function event(id: string, simulation: SimulationState, entityId: string, title: string, text: string): WorldEvent {
  return { id, date: simulation.date, entityId, category: 'military', title, text };
}

export function processInformationWarfare(simulation: SimulationState, armyState: ArmyState, warState: WarState) {
  const state = rootState();
  if (state.lastProcessedElapsedDay >= simulation.elapsedDays) return { simulation, armyState, warState, changed: false };
  let nextWar = warState;
  let nextSimulation = simulation;
  let changed = false;
  let incidents = [...state.incidents];
  let deceptionPlans = state.deceptionPlans.map((item) => ({ ...item }));

  const activePlans = operationalPlanState().plans.filter((plan) => !['completed', 'aborted'].includes(plan.status));
  for (const plan of activePlans) {
    const sides = opposingSide(nextWar, plan.warId, plan.hqId.includes('theater-hq-') ? '' : '');
    const war = nextWar.wars.find((item) => item.id === plan.warId && item.status === 'active');
    if (!war) continue;
    const force = armyState.units.filter((unit) => plan.forceId && unit.id.startsWith(plan.forceId));
    const ownerId = force[0]?.entityId ?? war.attackers[0];
    const opposition = opposingSide(nextWar, plan.warId, ownerId);
    if (!opposition?.enemies.length) continue;
    const enemyCapability = averageCapability(opposition.enemies, simulation);
    const ownRuntime = simulation.entities[ownerId];
    if (!ownRuntime) continue;
    const posture = state.security[ownerId] ?? 'standard';
    const exposure = planExposureModifier(plan.id);
    const age = Math.max(0, simulation.elapsedDays - plan.createdAtElapsedDay);
    const score = clamp(enemyCapability.technology * .32 + enemyCapability.treasury * .1 + age * .26 + exposure - securityScore(posture) * .38 + (plan.tempo === 'rapid' ? 9 : 0));
    const seed = hash(`${plan.id}:incident:${Math.floor(simulation.elapsedDays / 7)}`);
    if (score >= 42 && seed % 100 < score * .42 && !incidents.some((item) => item.planId === plan.id && simulation.elapsedDays - item.detectedAtElapsedDay < 35)) {
      const type = incidentType(seed, simulation.date.year);
      const severity = incidentSeverity(score);
      const observerId = opposition.enemies[seed % opposition.enemies.length];
      const text = type === 'communications_intercept'
        ? 'Sinais e comunicações do teatro revelaram indícios sobre a preparação operacional.'
        : type === 'captured_documents'
          ? 'Documentos de campanha foram obtidos pelo adversário e elevaram a exposição do plano.'
          : type === 'double_agent'
            ? 'Uma fonte comprometida transmitiu ao adversário informações parciais sobre a operação.'
            : 'Informações sobre o plano operacional vazaram para o lado adversário.';
      incidents = [{ id: `intel-incident-${plan.id}-${simulation.elapsedDays}`, observerId, targetId: ownerId, warId: plan.warId, type, severity, detectedAtElapsedDay: simulation.elapsedDays, frontId: plan.frontId, planId: plan.id, confidence: clamp(score), text }, ...incidents].slice(0, 120);
      nextSimulation = { ...nextSimulation, events: [event(`info-war-${plan.id}-${simulation.elapsedDays}`, nextSimulation, ownerId, 'Segurança operacional comprometida', 'Há sinais de que informações sobre uma operação em preparação chegaram ao adversário.'), ...nextSimulation.events].slice(0, 50) };
      changed = true;
    }
  }

  deceptionPlans = deceptionPlans.map((plan) => {
    if (!['preparing', 'active'].includes(plan.status)) return plan;
    const sides = opposingSide(nextWar, plan.warId, plan.ownerId);
    if (!sides) return { ...plan, status: 'failed' as const, resolvedAtElapsedDay: simulation.elapsedDays };
    if (plan.status === 'preparing' && simulation.elapsedDays < plan.activationElapsedDay) return plan;
    const targetRuntime = simulation.entities[plan.targetId];
    if (!targetRuntime) return plan;
    const defenderAwareness = clamp(targetRuntime.technology * .35 + targetRuntime.treasuryIndex * .12 + 25);
    const seed = hash(`${plan.id}:resolution`);
    const credibilityRoll = clamp(plan.credibility - defenderAwareness * .28 + ((seed % 21) - 10));
    const exposureRoll = clamp(100 - plan.secrecy + defenderAwareness * .24 + (((seed >> 6) % 17) - 8));
    if (seed % 100 < exposureRoll * .32) {
      changed = true;
      return { ...plan, status: 'exposed' as const, enemyReaction: 'watching' as const, resolvedAtElapsedDay: simulation.elapsedDays };
    }
    if (seed % 100 < credibilityRoll) {
      const enemySide = sides.enemySide;
      nextWar = setFrontPriority(nextWar, sides.war.id, plan.decoyFrontId, enemySide, credibilityRoll >= 72 ? 'main' : 'high');
      nextWar = setFrontOrder(nextWar, sides.war.id, plan.decoyFrontId, enemySide, 'defend');
      if (plan.trueFrontId && plan.trueFrontId !== plan.decoyFrontId) nextWar = setFrontPriority(nextWar, sides.war.id, plan.trueFrontId, enemySide, 'normal');
      nextSimulation = { ...nextSimulation, events: [event(`deception-success-${plan.id}`, nextSimulation, plan.ownerId, 'Engano estratégico ganhou credibilidade', 'O adversário aparenta ter deslocado atenção para o eixo falso apresentado pela campanha de desinformação.'), ...nextSimulation.events].slice(0, 50) };
      changed = true;
      return { ...plan, status: 'succeeded' as const, enemyReaction: credibilityRoll >= 72 ? 'committed' as const : 'reinforcing' as const, resolvedAtElapsedDay: simulation.elapsedDays };
    }
    changed = true;
    return { ...plan, status: 'failed' as const, enemyReaction: 'watching' as const, resolvedAtElapsedDay: simulation.elapsedDays };
  });

  const nextState: InformationWarfareState = { ...state, incidents, deceptionPlans, lastProcessedElapsedDay: simulation.elapsedDays };
  publish(nextState);
  return { simulation: nextSimulation, armyState, warState: nextWar, changed };
}

export function incidentsForEntity(entityId: string) {
  return rootState().incidents.filter((item) => item.targetId === entityId || item.observerId === entityId);
}

export function deceptionPlansForEntity(entityId: string) {
  return rootState().deceptionPlans.filter((item) => item.ownerId === entityId || item.targetId === entityId);
}
