import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from './simulation';
import type { CasusBelliOption } from './casusBelli';
import type { MobilizationLevel, WarGoal } from './war';

export type CrisisStatus = 'active' | 'resolved' | 'escalated';
export type CrisisAction = 'ultimatum' | 'compromise' | 'mediation';
export type CrisisSide = 'initiator' | 'target';
export type CrisisSupportLevel = 'diplomatic' | 'military';

export type CrisisSupport = {
  entityId: string;
  side: CrisisSide;
  level: CrisisSupportLevel;
  credibility: number;
  source: 'alliance' | 'alignment' | 'request';
};

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
  supporters: CrisisSupport[];
  initiatorMobilization: MobilizationLevel;
  targetMobilization: MobilizationLevel;
  status: CrisisStatus;
  outcome?: string;
};

export type CrisisEvaluation = {
  acceptance: number;
  tension: number;
  balance: number;
  mediatorBonus: number;
  initiatorBlocPower: number;
  targetBlocPower: number;
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

function alliedWith(simulation: SimulationState, a: string, b: string) {
  return simulation.treaties.some((treaty) => treaty.active && treaty.type === 'alliance' && treaty.parties.includes(a) && treaty.parties.includes(b));
}

function eraDeadline(year: number) {
  if (year < 1650) return 90;
  if (year < 1850) return 70;
  if (year < 1945) return 45;
  return 30;
}

function mobilizationWeight(level: MobilizationLevel) {
  if (level === 'general') return 1.18;
  if (level === 'partial') return 1.08;
  return 1;
}

function statePower(simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return 45;
  return runtime.militaryReadiness * 0.52 + runtime.treasuryIndex * 0.2 + runtime.technology * 0.18 + runtime.stability * 0.1;
}

function initialSupporters(entities: ScenarioEntity[], simulation: SimulationState, initiatorId: string, targetId: string): CrisisSupport[] {
  const supporters: CrisisSupport[] = [];
  for (const entity of entities) {
    if (entity.id === initiatorId || entity.id === targetId) continue;
    if (alliedWith(simulation, entity.id, initiatorId)) {
      supporters.push({ entityId: entity.id, side: 'initiator', level: 'military', credibility: 82, source: 'alliance' });
      continue;
    }
    if (alliedWith(simulation, entity.id, targetId)) {
      supporters.push({ entityId: entity.id, side: 'target', level: 'military', credibility: 82, source: 'alliance' });
      continue;
    }
    const toInitiator = relationBetween(simulation, entity.id, initiatorId);
    const toTarget = relationBetween(simulation, entity.id, targetId);
    const lean = (toInitiator?.score ?? 0) - (toTarget?.score ?? 0);
    const power = statePower(simulation, entity.id);
    if (power >= 62 && Math.abs(lean) >= 42) {
      supporters.push({ entityId: entity.id, side: lean > 0 ? 'initiator' : 'target', level: 'diplomatic', credibility: clamp(42 + Math.abs(lean) * 0.35), source: 'alignment' });
    }
  }
  return supporters.slice(0, 8);
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

export function startDiplomaticCrisis(attacker: ScenarioEntity, target: ScenarioEntity, casus: CasusBelliOption, goal: WarGoal, simulation: SimulationState, entities: ScenarioEntity[] = [attacker, target]) {
  const current = rootState();
  const existing = activeCrisisBetween(attacker.id, target.id);
  if (existing) return existing;
  const relation = relationBetween(simulation, attacker.id, target.id);
  const hostility = Math.max(0, -(relation?.score ?? 0));
  const threat = relation?.threat ?? 35;
  const supporters = initialSupporters(entities, simulation, attacker.id, target.id);
  const externalPressure = supporters.filter((item) => item.level === 'military').length * 3 + supporters.filter((item) => item.level === 'diplomatic').length;
  const tension = clamp(28 + hostility * 0.18 + threat * 0.22 + Math.max(0, 50 - casus.legitimacy) * 0.25 + externalPressure, 18, 84);
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
    supporters,
    initiatorMobilization: 'none',
    targetMobilization: supporters.some((item) => item.side === 'initiator' && item.level === 'military') ? 'partial' : 'none',
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

export function setCrisisMobilization(crisisId: string, side: CrisisSide, level: MobilizationLevel) {
  const tensionIncrease = level === 'general' ? 9 : level === 'partial' ? 4 : -3;
  const crises = rootState().map((crisis) => {
    if (crisis.id !== crisisId || crisis.status !== 'active') return crisis;
    return side === 'initiator'
      ? { ...crisis, initiatorMobilization: level, tension: clamp(crisis.tension + tensionIncrease, 0, 100) }
      : { ...crisis, targetMobilization: level, tension: clamp(crisis.tension + tensionIncrease, 0, 100) };
  });
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

export function potentialCrisisSupporters(entities: ScenarioEntity[], simulation: SimulationState, crisis: DiplomaticCrisis, side: CrisisSide) {
  const principalId = side === 'initiator' ? crisis.initiatorId : crisis.targetId;
  const enemyId = side === 'initiator' ? crisis.targetId : crisis.initiatorId;
  const already = new Set(crisis.supporters.map((item) => item.entityId));
  return entities
    .filter((entity) => entity.id !== crisis.initiatorId && entity.id !== crisis.targetId && !already.has(entity.id) && entity.id !== crisis.mediatorId)
    .map((entity) => {
      const friendly = relationBetween(simulation, entity.id, principalId);
      const enemy = relationBetween(simulation, entity.id, enemyId);
      const alliance = alliedWith(simulation, entity.id, principalId);
      const alignment = (friendly?.score ?? 0) - (enemy?.score ?? 0);
      const trust = friendly?.trust ?? 45;
      const power = statePower(simulation, entity.id);
      const willingness = clamp(30 + alignment * 0.38 + (trust - 45) * 0.38 + (alliance ? 28 : 0) + Math.max(0, power - 55) * 0.22 - crisis.tension * 0.12, 0, 100);
      const level: CrisisSupportLevel = alliance || willingness >= 76 ? 'military' : 'diplomatic';
      return { entity, willingness, level, alliance, power };
    })
    .filter((item) => item.willingness >= 36)
    .sort((a, b) => b.willingness - a.willingness)
    .slice(0, 6);
}

export function requestCrisisSupport(crisisId: string, entityId: string, side: CrisisSide, simulation: SimulationState) {
  const crisis = rootState().find((item) => item.id === crisisId);
  if (!crisis || crisis.status !== 'active' || crisis.supporters.some((item) => item.entityId === entityId)) return { accepted: false, message: 'A entidade não pode assumir uma nova posição nesta crise.' };
  const principalId = side === 'initiator' ? crisis.initiatorId : crisis.targetId;
  const enemyId = side === 'initiator' ? crisis.targetId : crisis.initiatorId;
  const friendly = relationBetween(simulation, entityId, principalId);
  const enemy = relationBetween(simulation, entityId, enemyId);
  const alliance = alliedWith(simulation, entityId, principalId);
  const alignment = (friendly?.score ?? 0) - (enemy?.score ?? 0);
  const willingness = clamp(30 + alignment * 0.38 + ((friendly?.trust ?? 45) - 45) * 0.38 + (alliance ? 28 : 0) + Math.max(0, statePower(simulation, entityId) - 55) * 0.22 - crisis.tension * 0.12, 0, 100);
  const seed = `${crisis.id}:${entityId}:${side}:${simulation.elapsedDays}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const accepted = (hash >>> 0) % 100 < willingness;
  if (!accepted) {
    const next = { ...crisis, tension: clamp(crisis.tension + 2) };
    publish(rootState().map((item) => item.id === crisisId ? next : item));
    return { accepted: false, message: `O pedido de apoio foi recusado. Disposição estimada: ${willingness.toFixed(0)}%.` };
  }
  const level: CrisisSupportLevel = alliance || willingness >= 76 ? 'military' : 'diplomatic';
  const support: CrisisSupport = { entityId, side, level, credibility: willingness, source: 'request' };
  const next = { ...crisis, supporters: [...crisis.supporters, support], tension: clamp(crisis.tension + (level === 'military' ? 7 : 3)) };
  publish(rootState().map((item) => item.id === crisisId ? next : item));
  return { accepted: true, message: level === 'military' ? 'A entidade assumiu compromisso militar público com este lado da crise.' : 'A entidade declarou apoio diplomático público a este lado da crise.' };
}

function blocPower(crisis: DiplomaticCrisis, simulation: SimulationState, side: CrisisSide) {
  const principalId = side === 'initiator' ? crisis.initiatorId : crisis.targetId;
  const mobilization = side === 'initiator' ? crisis.initiatorMobilization : crisis.targetMobilization;
  let power = statePower(simulation, principalId) * mobilizationWeight(mobilization);
  for (const support of crisis.supporters.filter((item) => item.side === side)) {
    const contribution = statePower(simulation, support.entityId) * (support.level === 'military' ? 0.62 : 0.16) * (0.55 + support.credibility / 220);
    power += contribution;
  }
  return power;
}

export function evaluateCrisis(crisis: DiplomaticCrisis, simulation: SimulationState, action: CrisisAction): CrisisEvaluation {
  const relation = relationBetween(simulation, crisis.initiatorId, crisis.targetId);
  const initiatorBlocPower = blocPower(crisis, simulation, 'initiator');
  const targetBlocPower = blocPower(crisis, simulation, 'target');
  const powerTotal = Math.max(1, initiatorBlocPower + targetBlocPower);
  const powerEdge = (initiatorBlocPower - targetBlocPower) / powerTotal;
  const balance = clamp(50 + powerEdge * 70, 0, 100);
  let mediatorBonus = 0;
  if (crisis.mediatorId) {
    const mediatorToTarget = relationBetween(simulation, crisis.mediatorId, crisis.targetId);
    const mediatorToInitiator = relationBetween(simulation, crisis.mediatorId, crisis.initiatorId);
    mediatorBonus = clamp((((mediatorToTarget?.trust ?? 45) + (mediatorToInitiator?.trust ?? 45)) / 2 - 35) * 0.35, 0, 18);
  }
  const actionBias = action === 'ultimatum' ? powerEdge * 28 - 6 : action === 'mediation' ? mediatorBonus + 9 : 7;
  const legitimacyBonus = (crisis.legitimacy - 50) * 0.36;
  const relationPenalty = Math.max(0, -(relation?.score ?? 0)) * 0.14;
  const tensionPenalty = crisis.tension * 0.28;
  const acceptance = clamp(44 + (balance - 50) * 0.5 + legitimacyBonus + actionBias + relationPenalty - tensionPenalty, 3, 96);
  const reason = action === 'mediation' && crisis.mediatorId
    ? 'A mediação reduz o custo de recuar; a composição dos blocos ainda pesa na decisão.'
    : action === 'ultimatum'
      ? 'O ultimato depende da credibilidade do bloco, mobilização e apoio externo, mas eleva o risco de escalada.'
      : 'A proposta de compromisso reduz tensão, enquanto apoios externos alteram a margem de negociação.';
  return { acceptance, tension: crisis.tension, balance, mediatorBonus, initiatorBlocPower, targetBlocPower, reason };
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
  const militaryCommitments = crisis.supporters.filter((item) => item.level === 'military').length;
  const escalated = !accepted && (action === 'ultimatum' || deadlineExpired || crisis.tension >= 82 || (crisis.tension >= 72 && militaryCommitments >= 3));
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
