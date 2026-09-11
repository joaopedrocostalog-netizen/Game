import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from './simulation';
import type { CasusBelliOption } from './casusBelli';
import type { WarGoal } from './war';

export type CrisisStatus = 'active' | 'resolved' | 'escalated';
export type CrisisAction = 'ultimatum' | 'compromise' | 'mediation';

export type DiplomaticCrisis = {
  id: string;
  initiatorId: string;
  targetId: string;
  casusBelliType: CasusBelliOption['type'];
  casusBelliLabel: string;
  goal: WarGoal;
  openedAtElapsedDay: number;
  deadlineElapsedDay: number;
  tension: number;
  legitimacy: number;
  mediatorId?: string;
  status: CrisisStatus;
  outcome?: string;
};

export type CrisisEvaluation = {
  acceptance: number;
  tension: number;
  balance: number;
  mediatorBonus: number;
  reason: string;
};

export type CrisisResolution = {
  accepted: boolean;
  escalated: boolean;
  message: string;
  simulation: SimulationState;
  crisis: DiplomaticCrisis;
};

type CrisisGlobal = typeof globalThis & { __WORLD_STATE_CRISES__?: DiplomaticCrisis[] };

function rootState() {
  const root = globalThis as CrisisGlobal;
  if (!root.__WORLD_STATE_CRISES__) root.__WORLD_STATE_CRISES__ = [];
  return root.__WORLD_STATE_CRISES__;
}

function publish(crises: DiplomaticCrisis[]) {
  (globalThis as CrisisGlobal).__WORLD_STATE_CRISES__ = crises;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-crises', { detail: crises }));
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function relationBetween(simulation: SimulationState, a: string, b: string) {
  return Object.values(simulation.diplomacy).find((relation) => relation.parties.includes(a) && relation.parties.includes(b));
}

function eraDeadline(year: number) {
  if (year < 1650) return 90;
  if (year < 1850) return 70;
  if (year < 1945) return 45;
  return 30;
}

export function resetCrises() {
  publish([]);
}

export function activeCrisisBetween(a: string, b: string) {
  return rootState().find((crisis) => crisis.status !== 'resolved' && ((crisis.initiatorId === a && crisis.targetId === b) || (crisis.initiatorId === b && crisis.targetId === a)));
}

export function crisesForEntity(entityId: string) {
  return rootState().filter((crisis) => crisis.initiatorId === entityId || crisis.targetId === entityId);
}

export function startDiplomaticCrisis(attacker: ScenarioEntity, target: ScenarioEntity, casus: CasusBelliOption, goal: WarGoal, simulation: SimulationState) {
  const current = rootState();
  const existing = activeCrisisBetween(attacker.id, target.id);
  if (existing) return existing;
  const relation = relationBetween(simulation, attacker.id, target.id);
  const hostility = Math.max(0, -(relation?.score ?? 0));
  const threat = relation?.threat ?? 35;
  const tension = clamp(28 + hostility * 0.18 + threat * 0.22 + Math.max(0, 50 - casus.legitimacy) * 0.25, 18, 78);
  const crisis: DiplomaticCrisis = {
    id: `crisis-${attacker.id}-${target.id}-${simulation.elapsedDays}`,
    initiatorId: attacker.id,
    targetId: target.id,
    casusBelliType: casus.type,
    casusBelliLabel: casus.label,
    goal,
    openedAtElapsedDay: simulation.elapsedDays,
    deadlineElapsedDay: simulation.elapsedDays + eraDeadline(simulation.date.year),
    tension,
    legitimacy: casus.legitimacy,
    status: 'active',
  };
  publish([crisis, ...current].slice(0, 40));
  return crisis;
}

export function setCrisisMediator(crisisId: string, mediatorId?: string) {
  const crises = rootState().map((crisis) => crisis.id === crisisId ? { ...crisis, mediatorId } : crisis);
  publish(crises);
  return crises.find((crisis) => crisis.id === crisisId);
}

export function potentialMediators(entities: ScenarioEntity[], simulation: SimulationState, initiatorId: string, targetId: string) {
  return entities
    .filter((entity) => entity.id !== initiatorId && entity.id !== targetId)
    .map((entity) => {
      const toInitiator = relationBetween(simulation, entity.id, initiatorId);
      const toTarget = relationBetween(simulation, entity.id, targetId);
      const score = ((toInitiator?.score ?? 0) + (toTarget?.score ?? 0)) / 2;
      const trust = ((toInitiator?.trust ?? 45) + (toTarget?.trust ?? 45)) / 2;
      return { entity, suitability: clamp(45 + score * 0.25 + (trust - 45) * 0.5, 0, 100) };
    })
    .filter((item) => item.suitability >= 38)
    .sort((a, b) => b.suitability - a.suitability)
    .slice(0, 5);
}

export function evaluateCrisis(crisis: DiplomaticCrisis, simulation: SimulationState, action: CrisisAction): CrisisEvaluation {
  const initiator = simulation.entities[crisis.initiatorId];
  const target = simulation.entities[crisis.targetId];
  const relation = relationBetween(simulation, crisis.initiatorId, crisis.targetId);
  const militaryBalance = (initiator?.militaryReadiness ?? 50) - (target?.militaryReadiness ?? 50);
  const fiscalBalance = (initiator?.treasuryIndex ?? 50) - (target?.treasuryIndex ?? 50);
  const balance = clamp(50 + militaryBalance * 0.65 + fiscalBalance * 0.22, 0, 100);
  let mediatorBonus = 0;
  if (crisis.mediatorId) {
    const mediatorToTarget = relationBetween(simulation, crisis.mediatorId, crisis.targetId);
    const mediatorToInitiator = relationBetween(simulation, crisis.mediatorId, crisis.initiatorId);
    mediatorBonus = clamp((((mediatorToTarget?.trust ?? 45) + (mediatorToInitiator?.trust ?? 45)) / 2 - 35) * 0.35, 0, 18);
  }
  const actionBias = action === 'ultimatum' ? militaryBalance * 0.3 - 6 : action === 'mediation' ? mediatorBonus + 9 : 7;
  const legitimacyBonus = (crisis.legitimacy - 50) * 0.36;
  const relationPenalty = Math.max(0, -(relation?.score ?? 0)) * 0.14;
  const tensionPenalty = crisis.tension * 0.28;
  const acceptance = clamp(44 + (balance - 50) * 0.5 + legitimacyBonus + actionBias + relationPenalty - tensionPenalty, 3, 96);
  const reason = action === 'mediation' && crisis.mediatorId
    ? 'A mediação reduz o custo de recuar e aumenta a chance de compromisso.'
    : action === 'ultimatum'
      ? 'O ultimato depende fortemente da credibilidade militar e aumenta o risco de escalada.'
      : 'A proposta de compromisso reduz tensão, mas pode exigir concessões menores.';
  return { acceptance, tension: crisis.tension, balance, mediatorBonus, reason };
}

function deterministicRoll(crisis: DiplomaticCrisis, action: CrisisAction, simulation: SimulationState) {
  const seed = `${crisis.id}:${action}:${simulation.elapsedDays}:${crisis.tension.toFixed(1)}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100;
}

function mutateRelations(simulation: SimulationState, crisis: DiplomaticCrisis, accepted: boolean, action: CrisisAction) {
  const diplomacy = Object.fromEntries(Object.entries(simulation.diplomacy).map(([key, relation]) => {
    if (!(relation.parties.includes(crisis.initiatorId) && relation.parties.includes(crisis.targetId))) return [key, relation];
    const trustDelta = accepted ? (action === 'mediation' ? 4 : 1) : -5;
    const scoreDelta = accepted ? (action === 'compromise' ? 5 : 2) : -8;
    const threatDelta = accepted ? -8 : 10;
    return [key, {
      ...relation,
      trust: clamp(relation.trust + trustDelta),
      score: clamp(relation.score + scoreDelta, -100, 100),
      threat: clamp(relation.threat + threatDelta),
      memory: [`Crise diplomática ${accepted ? 'resolvida sem guerra' : 'fracassou e aumentou a tensão'}.`, ...relation.memory].slice(0, 8),
    }];
  }));
  return { ...simulation, diplomacy };
}

export function resolveCrisis(crisisId: string, simulation: SimulationState, action: CrisisAction): CrisisResolution | undefined {
  const crisis = rootState().find((item) => item.id === crisisId);
  if (!crisis || crisis.status !== 'active') return undefined;
  const evaluation = evaluateCrisis(crisis, simulation, action);
  const accepted = deterministicRoll(crisis, action, simulation) < evaluation.acceptance;
  const deadlineExpired = simulation.elapsedDays >= crisis.deadlineElapsedDay;
  const escalated = !accepted && (action === 'ultimatum' || deadlineExpired || crisis.tension >= 82);
  const nextCrisis: DiplomaticCrisis = {
    ...crisis,
    tension: accepted ? clamp(crisis.tension - (action === 'mediation' ? 34 : 24)) : clamp(crisis.tension + (action === 'ultimatum' ? 22 : 11)),
    status: accepted ? 'resolved' : escalated ? 'escalated' : 'active',
    outcome: accepted
      ? `A crise foi encerrada por ${action === 'mediation' ? 'mediação' : action === 'compromise' ? 'compromisso' : 'aceitação do ultimato'}.`
      : escalated ? 'A negociação fracassou e a crise está pronta para escalar à guerra.' : 'A proposta foi rejeitada; a crise continua aberta.',
  };
  const nextSimulation = mutateRelations(simulation, nextCrisis, accepted, action);
  publish(rootState().map((item) => item.id === crisisId ? nextCrisis : item));
  return {
    accepted,
    escalated,
    simulation: nextSimulation,
    crisis: nextCrisis,
    message: accepted
      ? `${nextCrisis.outcome} Aceitação estimada: ${evaluation.acceptance.toFixed(0)}%.`
      : escalated
        ? `${nextCrisis.outcome} A via diplomática foi esgotada.`
        : `${nextCrisis.outcome} Aceitação estimada: ${evaluation.acceptance.toFixed(0)}%.`,
  };
}

export function markCrisisEscalated(crisisId: string) {
  const crises = rootState().map((crisis) => crisis.id === crisisId ? { ...crisis, status: 'escalated' as const, tension: clamp(Math.max(crisis.tension, 88)) } : crisis);
  publish(crises);
}
