import { locationsForEntity, type ResolvedLocation } from '../data/territories';
import type { SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { War } from './war';

export type CoalitionGoalType = 'primary' | 'defend_ally' | 'territorial_interest' | 'reparations' | 'influence' | 'regime' | 'independence';
export type CoalitionGoalStatus = 'active' | 'satisfied' | 'frustrated';
export type CoalitionPeaceTerm = 'status_quo' | 'reparations' | 'limited_annexation' | 'recognition';

export type CoalitionMemberGoal = {
  id: string;
  warId: string;
  entityId: string;
  side: 'attacker' | 'defender';
  targetId: string;
  type: CoalitionGoalType;
  label: string;
  priority: number;
  satisfaction: number;
  status: CoalitionGoalStatus;
  locationId?: string;
  rationale: string;
};

export type CoalitionCohesion = {
  cohesion: number;
  averageSatisfaction: number;
  dissenters: number;
  members: number;
  summary: string;
};

export type CoalitionSettlementEvaluation = {
  support: number;
  dissenters: number;
  compatible: number;
  total: number;
  summary: string;
};

type CoalitionGoalState = { goals: CoalitionMemberGoal[] };
type CoalitionGlobal = typeof globalThis & { __WORLD_STATE_COALITION_GOALS__?: CoalitionGoalState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): CoalitionGoalState {
  const root = globalThis as CoalitionGlobal;
  if (!root.__WORLD_STATE_COALITION_GOALS__) root.__WORLD_STATE_COALITION_GOALS__ = { goals: [] };
  return root.__WORLD_STATE_COALITION_GOALS__;
}

function publish(goals: CoalitionMemberGoal[]) {
  (globalThis as CoalitionGlobal).__WORLD_STATE_COALITION_GOALS__ = { goals };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-coalition-goals', { detail: goals }));
}

export function resetCoalitionGoals() {
  publish([]);
}

function distanceKm(a?: ResolvedLocation, b?: ResolvedLocation) {
  if (!a || !b) return 99999;
  const r = 6371;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestEnemyLocation(entityId: string, enemyId: string, year: number) {
  const own = locationsForEntity(entityId, year);
  const enemy = locationsForEntity(enemyId, year);
  if (!enemy.length) return undefined;
  if (!own.length) return enemy[0];
  return enemy
    .map((location) => ({ location, distance: Math.min(...own.map((origin) => distanceKm(origin, location))) }))
    .sort((a, b) => a.distance - b.distance)[0]?.location;
}

function relationBetween(simulation: SimulationState, a: string, b: string) {
  return Object.values(simulation.diplomacy).find((relation) => relation.parties.includes(a) && relation.parties.includes(b));
}

function chooseGoal(war: War, entityId: string, side: 'attacker' | 'defender', simulation: SimulationState): Omit<CoalitionMemberGoal, 'id' | 'warId' | 'entityId' | 'side' | 'targetId' | 'satisfaction' | 'status'> {
  const isLeader = side === 'attacker' ? entityId === war.attackerId : entityId === war.defenderId;
  const enemyId = side === 'attacker' ? war.defenderId : war.attackerId;
  const ai = simulation.strategicAI[entityId];
  const runtime = simulation.entities[entityId];
  const relation = relationBetween(simulation, entityId, enemyId);
  const hostility = Math.max(0, -(relation?.score ?? 0));
  const priorityBase = clamp(48 + (ai?.riskTolerance ?? 45) * 0.22 + hostility * 0.18, 42, 88);

  if (isLeader) {
    if (war.goal === 'territory') {
      const location = nearestEnemyLocation(entityId, enemyId, simulation.date.year);
      return { type: 'primary', label: 'Objetivo territorial principal', priority: 96, locationId: location?.id, rationale: 'É o objetivo político que iniciou a guerra.' };
    }
    if (war.goal === 'reparations') return { type: 'primary', label: 'Reparações e concessões', priority: 94, rationale: 'O governo iniciou a guerra buscando compensação material.' };
    if (war.goal === 'regime') return { type: 'primary', label: 'Mudança política do adversário', priority: 94, rationale: 'O objetivo principal é alterar a ordem política do adversário.' };
    if (war.goal === 'independence') return { type: 'primary', label: 'Independência / libertação', priority: 98, rationale: 'A legitimidade da guerra depende diretamente do reconhecimento político buscado.' };
    return { type: 'primary', label: 'Defesa e restauração do status quo', priority: 96, rationale: 'A prioridade é preservar a integridade do lado defendido.' };
  }

  if (side === 'defender') {
    return { type: 'defend_ally', label: 'Defender o aliado e restaurar o status quo', priority: clamp(priorityBase + 10), rationale: 'A entidade entrou para impedir a derrota de um parceiro e limitar mudanças territoriais.' };
  }

  if ((runtime?.treasuryIndex ?? 55) < 43) {
    return { type: 'reparations', label: 'Obter reparações de guerra', priority: clamp(priorityBase + 4), rationale: 'A pressão fiscal torna compensações materiais especialmente valiosas.' };
  }
  if ((ai?.aggression ?? 45) >= 68 || hostility >= 58) {
    const location = nearestEnemyLocation(entityId, enemyId, simulation.date.year);
    if (location) return { type: 'territorial_interest', label: `Interesse territorial em ${location.name}`, priority: clamp(priorityBase + 8), locationId: location.id, rationale: 'A posição estratégica e a hostilidade existente criaram um interesse territorial próprio.' };
  }
  if ((ai?.focus ?? 'economy') === 'diplomacy' || (ai?.openness ?? 45) >= 65) {
    return { type: 'influence', label: 'Ampliar influência no acordo pós-guerra', priority: priorityBase, rationale: 'A liderança busca converter participação militar em posição diplomática.' };
  }
  if ((ai?.focus ?? 'economy') === 'military' && (ai?.aggression ?? 45) >= 58) {
    return { type: 'regime', label: 'Enfraquecer a estrutura política adversária', priority: priorityBase, rationale: 'A liderança considera o adversário uma ameaça estratégica duradoura.' };
  }
  return { type: 'defend_ally', label: 'Honrar a coalizão e apoiar o objetivo do líder', priority: clamp(priorityBase - 4), rationale: 'A participação deriva principalmente do compromisso com o líder da coalizão.' };
}

function initialGoal(war: War, entityId: string, side: 'attacker' | 'defender', simulation: SimulationState): CoalitionMemberGoal {
  const targetId = side === 'attacker' ? war.defenderId : war.attackerId;
  const chosen = chooseGoal(war, entityId, side, simulation);
  return {
    id: `coalition-goal-${war.id}-${entityId}`,
    warId: war.id,
    entityId,
    side,
    targetId,
    ...chosen,
    satisfaction: 50,
    status: 'active',
  };
}

function sideScore(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.score : -war.score;
}

function occupationForGoal(goal: CoalitionMemberGoal, control: TerritorialControlState) {
  return goal.locationId ? control.occupations[goal.locationId] : undefined;
}

function satisfactionForGoal(goal: CoalitionMemberGoal, war: War, control: TerritorialControlState) {
  if (war.status === 'ended' && goal.status !== 'active') return goal.satisfaction;
  const score = sideScore(war, goal.side);
  const ownSupport = goal.side === 'attacker' ? war.attackerSupport : war.defenderSupport;
  const losses = goal.side === 'attacker' ? war.attackerLosses : war.defenderLosses;
  const occupation = occupationForGoal(goal, control);
  const ownSide = new Set(goal.side === 'attacker' ? war.attackers : war.defenders);
  const locationControlled = occupation ? ownSide.has(occupation.controllerId) && occupation.progress >= 100 : false;

  let satisfaction = 48 + score * 0.38 + (ownSupport - 60) * 0.12 - Math.min(18, losses / 2200);
  if (goal.type === 'territorial_interest' || (goal.type === 'primary' && goal.locationId)) satisfaction += locationControlled ? 32 : (occupation?.progress ?? 0) * 0.18;
  if (goal.type === 'reparations') satisfaction += Math.max(0, score) * 0.2;
  if (goal.type === 'defend_ally') satisfaction += score >= 0 ? 12 : score * 0.16;
  if (goal.type === 'influence') satisfaction += Math.max(0, score) * 0.12;
  if (goal.type === 'regime') satisfaction += score > 45 ? 22 : 0;
  if (goal.type === 'independence') satisfaction += score > 55 ? 26 : 0;
  return clamp(satisfaction);
}

function ensureGoals(war: War, simulation: SimulationState, control: TerritorialControlState) {
  const state = rootState();
  const current = state.goals.filter((goal) => goal.warId === war.id);
  const existing = new Set(current.map((goal) => goal.entityId));
  const additions: CoalitionMemberGoal[] = [];
  for (const entityId of war.attackers) if (!existing.has(entityId)) additions.push(initialGoal(war, entityId, 'attacker', simulation));
  for (const entityId of war.defenders) if (!existing.has(entityId)) additions.push(initialGoal(war, entityId, 'defender', simulation));
  const participants = new Set([...war.attackers, ...war.defenders]);
  const updated = [...current, ...additions]
    .filter((goal) => participants.has(goal.entityId))
    .map((goal) => ({ ...goal, satisfaction: satisfactionForGoal(goal, war, control) }));
  const others = state.goals.filter((goal) => goal.warId !== war.id);
  if (additions.length || updated.some((goal, index) => goal.satisfaction !== current[index]?.satisfaction)) publish([...updated, ...others].slice(0, 240));
  return updated;
}

export function coalitionGoalsForWar(war: War, simulation: SimulationState, control: TerritorialControlState) {
  return ensureGoals(war, simulation, control);
}

export function coalitionCohesion(war: War, side: 'attacker' | 'defender', simulation: SimulationState, control: TerritorialControlState): CoalitionCohesion {
  const goals = ensureGoals(war, simulation, control).filter((goal) => goal.side === side);
  if (!goals.length) return { cohesion: 100, averageSatisfaction: 100, dissenters: 0, members: 0, summary: 'Sem membros adicionais para avaliar.' };
  const weightedTotal = goals.reduce((sum, goal) => sum + goal.satisfaction * goal.priority, 0);
  const priorityTotal = goals.reduce((sum, goal) => sum + goal.priority, 0) || 1;
  const averageSatisfaction = weightedTotal / priorityTotal;
  const dissenters = goals.filter((goal) => goal.satisfaction < 38).length;
  const spread = Math.max(...goals.map((goal) => goal.satisfaction)) - Math.min(...goals.map((goal) => goal.satisfaction));
  const cohesion = clamp(averageSatisfaction - dissenters * 9 - spread * 0.18 + 18);
  const summary = cohesion >= 75 ? 'A coalizão está coesa e seus membros veem progresso suficiente.' : cohesion >= 50 ? 'Há diferenças entre os objetivos dos membros, mas a coalizão ainda é funcional.' : 'A coalizão está sob forte tensão; aliados insatisfeitos podem rejeitar um acordo que ignore seus interesses.';
  return { cohesion, averageSatisfaction, dissenters, members: goals.length, summary };
}

function compatibility(goal: CoalitionMemberGoal, term: CoalitionPeaceTerm, transferredLocationIds: string[]) {
  if (goal.type === 'defend_ally') return term === 'status_quo' || term === 'recognition' ? 88 : term === 'reparations' ? 72 : 54;
  if (goal.type === 'reparations') return term === 'reparations' ? 96 : term === 'limited_annexation' ? 58 : 32;
  if (goal.type === 'territorial_interest') {
    if (term !== 'limited_annexation') return 24;
    return goal.locationId && transferredLocationIds.includes(goal.locationId) ? 100 : 55;
  }
  if (goal.type === 'influence') return term === 'recognition' ? 90 : term === 'reparations' ? 70 : 48;
  if (goal.type === 'regime') return term === 'recognition' ? 82 : 28;
  if (goal.type === 'independence') return term === 'recognition' ? 100 : 18;
  if (goal.type === 'primary') {
    if (warGoalTerm(goal, term)) return 95;
    return 45;
  }
  return 50;
}

function warGoalTerm(goal: CoalitionMemberGoal, term: CoalitionPeaceTerm) {
  if (goal.locationId) return term === 'limited_annexation';
  if (/Repara/i.test(goal.label)) return term === 'reparations';
  if (/Independ|Mudança política/i.test(goal.label)) return term === 'recognition';
  if (/Defesa/i.test(goal.label)) return term === 'status_quo';
  return true;
}

export function evaluateCoalitionSettlement(war: War, side: 'attacker' | 'defender', term: CoalitionPeaceTerm, simulation: SimulationState, control: TerritorialControlState, transferredLocationIds: string[] = []): CoalitionSettlementEvaluation {
  const goals = ensureGoals(war, simulation, control).filter((goal) => goal.side === side);
  if (!goals.length) return { support: 100, dissenters: 0, compatible: 0, total: 0, summary: 'Não há parceiros adicionais com interesses próprios.' };
  const scores = goals.map((goal) => clamp(compatibility(goal, term, transferredLocationIds) * 0.65 + goal.satisfaction * 0.35));
  const weighted = scores.reduce((sum, score, index) => sum + score * goals[index].priority, 0) / Math.max(1, goals.reduce((sum, goal) => sum + goal.priority, 0));
  const dissenters = scores.filter((score) => score < 42).length;
  const compatible = scores.filter((score) => score >= 60).length;
  const support = clamp(weighted - dissenters * 5);
  const summary = support >= 72 ? 'A maioria da coalizão considera estes termos compatíveis com seus objetivos.' : support >= 48 ? 'O acordo divide a coalizão: alguns parceiros aceitariam, outros consideram seus objetivos incompletos.' : 'Os termos ignoram interesses importantes da coalizão e podem gerar forte ressentimento entre aliados.';
  return { support, dissenters, compatible, total: goals.length, summary };
}

export function settleCoalitionGoals(war: War, side: 'attacker' | 'defender', term: CoalitionPeaceTerm, simulation: SimulationState, control: TerritorialControlState, transferredLocationIds: string[]) {
  const state = rootState();
  const goals = ensureGoals(war, simulation, control);
  const settled = goals.map((goal) => {
    const score = goal.side === side ? compatibility(goal, term, transferredLocationIds) : compatibility(goal, 'status_quo', []);
    const finalSatisfaction = clamp(goal.satisfaction * 0.45 + score * 0.55);
    return { ...goal, satisfaction: finalSatisfaction, status: finalSatisfaction >= 58 ? 'satisfied' as const : 'frustrated' as const };
  });
  publish([...settled, ...state.goals.filter((goal) => goal.warId !== war.id)].slice(0, 240));
  return settled;
}

export function applyCoalitionDiplomaticConsequences(simulation: SimulationState, war: War, side: 'attacker' | 'defender') {
  const goals = rootState().goals.filter((goal) => goal.warId === war.id && goal.side === side && goal.entityId !== (side === 'attacker' ? war.attackerId : war.defenderId));
  const leaderId = side === 'attacker' ? war.attackerId : war.defenderId;
  if (!goals.length) return simulation;
  const diplomacy = Object.fromEntries(Object.entries(simulation.diplomacy).map(([key, relation]) => {
    const partnerId = relation.parties.includes(leaderId) ? relation.parties.find((id) => id !== leaderId) : undefined;
    const goal = partnerId ? goals.find((item) => item.entityId === partnerId) : undefined;
    if (!goal) return [key, relation];
    const delta = goal.status === 'frustrated' ? -Math.max(3, (55 - goal.satisfaction) * 0.16) : Math.max(1, (goal.satisfaction - 55) * 0.08);
    return [key, {
      ...relation,
      score: clamp(relation.score + delta, -100, 100),
      trust: clamp(relation.trust + delta * 0.55),
      memory: [`Objetivos de coalizão ${goal.status === 'frustrated' ? 'foram frustrados' : 'foram atendidos'} no acordo de paz da guerra ${war.id}.`, ...relation.memory].slice(0, 8),
    }];
  }));
  return { ...simulation, diplomacy };
}
