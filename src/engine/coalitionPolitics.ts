import { coalitionGoalsForWar } from './coalitionGoals';
import { pairKey, type SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { War, WarState } from './war';

export type CoalitionPoliticalStatus = 'committed' | 'uneasy' | 'demanding' | 'withdrawal-risk' | 'breakaway';
export type CoalitionPoliticalAction = 'compensation-demand' | 'compensation-granted' | 'withdrawal' | 'separate-peace' | 'defection';

export type CoalitionDisposition = {
  warId: string;
  entityId: string;
  leaderId: string;
  enemyLeaderId: string;
  side: 'attacker' | 'defender';
  loyalty: number;
  warWeariness: number;
  satisfaction: number;
  leaderTrust: number;
  enemyAppeal: number;
  status: CoalitionPoliticalStatus;
  compensationDemand: number;
  canDemandCompensation: boolean;
  canWithdraw: boolean;
  canSeparatePeace: boolean;
  canDefect: boolean;
  reason: string;
};

export type CoalitionPoliticalRecord = {
  id: string;
  warId: string;
  entityId: string;
  leaderId: string;
  action: CoalitionPoliticalAction;
  elapsedDay: number;
  note: string;
};

type CoalitionPoliticalState = { records: CoalitionPoliticalRecord[] };
type CoalitionPoliticalGlobal = typeof globalThis & { __WORLD_STATE_COALITION_POLITICS__?: CoalitionPoliticalState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): CoalitionPoliticalState {
  const root = globalThis as CoalitionPoliticalGlobal;
  if (!root.__WORLD_STATE_COALITION_POLITICS__) root.__WORLD_STATE_COALITION_POLITICS__ = { records: [] };
  return root.__WORLD_STATE_COALITION_POLITICS__;
}

function publish(records: CoalitionPoliticalRecord[]) {
  (globalThis as CoalitionPoliticalGlobal).__WORLD_STATE_COALITION_POLITICS__ = { records };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-coalition-politics', { detail: records }));
}

export function resetCoalitionPolitics() {
  publish([]);
}

export function coalitionPoliticalHistory(warId?: string) {
  const records = rootState().records;
  return warId ? records.filter((record) => record.warId === warId) : [...records];
}

function relation(simulation: SimulationState, a: string, b: string) {
  return simulation.diplomacy[pairKey(a, b)];
}

function allied(simulation: SimulationState, a: string, b: string) {
  return simulation.treaties.some((treaty) => treaty.active && treaty.type === 'alliance' && treaty.parties.includes(a) && treaty.parties.includes(b));
}

function sideForMember(war: War, entityId: string) {
  if (war.attackers.includes(entityId)) return 'attacker' as const;
  if (war.defenders.includes(entityId)) return 'defender' as const;
  return undefined;
}

function leaderForSide(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.attackerId : war.defenderId;
}

function enemyLeaderForSide(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.defenderId : war.attackerId;
}

function sideSupport(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.attackerSupport : war.defenderSupport;
}

function sideLosses(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.attackerLosses : war.defenderLosses;
}

function scoreForSide(war: War, side: 'attacker' | 'defender') {
  return side === 'attacker' ? war.score : -war.score;
}

function priorBreakaway(warId: string, entityId: string) {
  return rootState().records.some((record) => record.warId === warId && record.entityId === entityId && ['withdrawal', 'separate-peace', 'defection'].includes(record.action));
}

export function coalitionMemberDisposition(
  war: War,
  entityId: string,
  simulation: SimulationState,
  control: TerritorialControlState,
): CoalitionDisposition | undefined {
  const side = sideForMember(war, entityId);
  if (!side) return undefined;
  const leaderId = leaderForSide(war, side);
  const enemyLeaderId = enemyLeaderForSide(war, side);
  const isLeader = entityId === leaderId;
  const leaderRelation = entityId === leaderId ? undefined : relation(simulation, entityId, leaderId);
  const enemyRelation = relation(simulation, entityId, enemyLeaderId);
  const goals = coalitionGoalsForWar(war, simulation, control);
  const goal = goals.find((item) => item.entityId === entityId);
  const satisfaction = goal?.satisfaction ?? (isLeader ? 62 : 50);
  const members = side === 'attacker' ? war.attackers.length : war.defenders.length;
  const lossesPerMember = sideLosses(war, side) / Math.max(1, members);
  const support = sideSupport(war, side);
  const score = scoreForSide(war, side);
  const runtime = simulation.entities[entityId];
  const readinessPenalty = Math.max(0, 42 - (runtime?.militaryReadiness ?? 50)) * 0.55;
  const warWeariness = clamp(
    war.elapsedDays / 7.5 + lossesPerMember / 750 + (100 - support) * 0.45 + readinessPenalty - Math.max(0, score) * 0.12,
  );
  const leaderTrust = isLeader ? 100 : clamp((leaderRelation?.trust ?? 45) + (leaderRelation?.score ?? 0) * 0.15);
  const enemyAppeal = clamp(45 + (enemyRelation?.score ?? 0) * 0.28 + ((enemyRelation?.trust ?? 45) - 45) * 0.32 - (enemyRelation?.threat ?? 35) * 0.2);
  const allianceBonus = isLeader ? 20 : allied(simulation, entityId, leaderId) ? 13 : 0;
  const scoreEffect = clamp(score, -100, 100) * 0.16;
  const loyalty = isLeader ? 100 : clamp(28 + leaderTrust * 0.3 + satisfaction * 0.34 + allianceBonus + scoreEffect - warWeariness * 0.32 - Math.max(0, enemyAppeal - 55) * 0.12);
  const compensationDemand = isLeader ? 0 : clamp((58 - satisfaction) * 0.45 + (warWeariness - 45) * 0.35 + Math.max(0, 55 - loyalty) * 0.28, 0, 18);

  const broken = priorBreakaway(war.id, entityId);
  const canDemandCompensation = !isLeader && !broken && war.status === 'active' && war.elapsedDays >= 30 && (loyalty < 68 || satisfaction < 58 || warWeariness > 48);
  const canWithdraw = !isLeader && !broken && war.status === 'active' && war.elapsedDays >= 45 && (loyalty < 43 || warWeariness > 68);
  const canSeparatePeace = !isLeader && !broken && war.status === 'active' && war.elapsedDays >= 75 && (loyalty < 34 || warWeariness > 78 || (score < -45 && satisfaction < 44));
  const canDefect = !isLeader && !broken && war.status === 'active' && war.elapsedDays >= 120 && loyalty < 18 && enemyAppeal >= 58 && (enemyRelation?.score ?? 0) > (leaderRelation?.score ?? 0) + 25 && !allied(simulation, entityId, leaderId);

  const status: CoalitionPoliticalStatus = loyalty >= 70 && warWeariness < 48
    ? 'committed'
    : loyalty >= 52
      ? 'uneasy'
      : loyalty >= 38
        ? 'demanding'
        : loyalty >= 20
          ? 'withdrawal-risk'
          : 'breakaway';

  const reason = isLeader
    ? 'Como líder da coalizão, esta entidade não pode abandonar a própria guerra por este mecanismo.'
    : loyalty < 20
      ? 'A combinação de baixa confiança no líder, desgaste e objetivos frustrados cria risco real de ruptura.'
      : warWeariness > 68
        ? 'O desgaste da guerra está pressionando a disposição política para permanecer no conflito.'
        : satisfaction < 48
          ? 'Os objetivos próprios desta entidade estão pouco atendidos pela condução atual da guerra.'
          : 'A relação com o líder e o andamento da guerra ainda sustentam a permanência na coalizão.';

  return {
    warId: war.id,
    entityId,
    leaderId,
    enemyLeaderId,
    side,
    loyalty,
    warWeariness,
    satisfaction,
    leaderTrust,
    enemyAppeal,
    status,
    compensationDemand,
    canDemandCompensation,
    canWithdraw,
    canSeparatePeace,
    canDefect,
    reason,
  };
}

function recordAction(war: War, entityId: string, leaderId: string, action: CoalitionPoliticalAction, simulation: SimulationState, note: string) {
  const record: CoalitionPoliticalRecord = {
    id: `coalition-${action}-${war.id}-${entityId}-${simulation.elapsedDays}`,
    warId: war.id,
    entityId,
    leaderId,
    action,
    elapsedDay: simulation.elapsedDays,
    note,
  };
  publish([record, ...rootState().records].slice(0, 100));
  return record;
}

function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, memory: string) {
  const key = pairKey(a, b);
  const current = simulation.diplomacy[key];
  if (!current) return simulation;
  return {
    ...simulation,
    diplomacy: {
      ...simulation.diplomacy,
      [key]: {
        ...current,
        score: clamp(current.score + scoreDelta, -100, 100),
        trust: clamp(current.trust + trustDelta),
        memory: [memory, ...current.memory].slice(0, 8),
      },
    },
  };
}

export function demandCoalitionCompensation(war: War, entityId: string, simulation: SimulationState, control: TerritorialControlState) {
  const disposition = coalitionMemberDisposition(war, entityId, simulation, control);
  if (!disposition?.canDemandCompensation) return { accepted: false, simulation, message: 'A situação política ainda não justifica uma exigência formal de compensação.' };
  recordAction(war, entityId, disposition.leaderId, 'compensation-demand', simulation, 'O membro exigiu compensação para continuar sustentando a guerra.');
  const nextSimulation = mutateRelation(simulation, entityId, disposition.leaderId, -2, -2, 'Exigiu compensação adicional para permanecer na coalizão.');
  return { accepted: true, simulation: nextSimulation, amount: Math.max(2, disposition.compensationDemand), message: `A exigência foi registrada. Pressão estimada: ${disposition.compensationDemand.toFixed(1)} pontos de capacidade fiscal.` };
}

export function grantCoalitionCompensation(war: War, memberId: string, simulation: SimulationState, control: TerritorialControlState) {
  const disposition = coalitionMemberDisposition(war, memberId, simulation, control);
  if (!disposition || memberId === disposition.leaderId) return { accepted: false, simulation, message: 'Compensação não aplicável.' };
  const leader = simulation.entities[disposition.leaderId];
  const member = simulation.entities[memberId];
  if (!leader || !member) return { accepted: false, simulation, message: 'As entidades não possuem estado econômico suficiente para a compensação.' };
  const cost = Math.max(2, Math.min(8, disposition.compensationDemand * 0.42));
  if (leader.treasuryIndex < cost + 8) return { accepted: false, simulation, message: 'O líder da coalizão não possui margem fiscal suficiente para oferecer a compensação.' };
  let nextSimulation: SimulationState = {
    ...simulation,
    entities: {
      ...simulation.entities,
      [disposition.leaderId]: { ...leader, treasuryIndex: clamp(leader.treasuryIndex - cost) },
      [memberId]: { ...member, treasuryIndex: clamp(member.treasuryIndex + cost * 0.55) },
    },
  };
  nextSimulation = mutateRelation(nextSimulation, memberId, disposition.leaderId, 7, 9, 'Recebeu compensação do líder para continuar sustentando a guerra.');
  recordAction(war, memberId, disposition.leaderId, 'compensation-granted', simulation, `Compensação de ${cost.toFixed(1)} pontos fiscais foi concedida.`);
  return { accepted: true, simulation: nextSimulation, message: `Compensação concedida. Custo fiscal para o líder: ${cost.toFixed(1)}.` };
}

function removeMemberFromWar(war: War, entityId: string) {
  return {
    ...war,
    attackers: war.attackers.filter((id) => id !== entityId),
    defenders: war.defenders.filter((id) => id !== entityId),
  };
}

export function withdrawCoalitionMember(warState: WarState, warId: string, entityId: string, simulation: SimulationState, control: TerritorialControlState) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return { accepted: false, warState, simulation, message: 'Guerra não encontrada.' };
  const disposition = coalitionMemberDisposition(war, entityId, simulation, control);
  if (!disposition?.canWithdraw) return { accepted: false, warState, simulation, message: 'A entidade ainda não possui condições políticas suficientes para abandonar a coalizão.' };
  const nextWar = removeMemberFromWar(war, entityId);
  const mobilization = { ...warState.mobilization, [entityId]: 'none' as const };
  let nextSimulation = mutateRelation(simulation, entityId, disposition.leaderId, -10, -12, 'Abandonou a coalizão durante uma guerra ativa.');
  nextSimulation = mutateRelation(nextSimulation, entityId, disposition.enemyLeaderId, 4, 2, 'Retirou-se do conflito sem aderir ao lado adversário.');
  recordAction(war, entityId, disposition.leaderId, 'withdrawal', simulation, 'O membro abandonou a coalizão e retirou suas forças da guerra.');
  return {
    accepted: true,
    warState: { ...warState, mobilization, wars: warState.wars.map((item) => item.id === warId ? nextWar : item) },
    simulation: nextSimulation,
    message: 'A entidade abandonou a coalizão. Sua mobilização foi encerrada e a confiança com o antigo líder caiu.',
  };
}

export function signSeparatePeace(warState: WarState, warId: string, entityId: string, simulation: SimulationState, control: TerritorialControlState) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return { accepted: false, warState, simulation, message: 'Guerra não encontrada.' };
  const disposition = coalitionMemberDisposition(war, entityId, simulation, control);
  if (!disposition?.canSeparatePeace) return { accepted: false, warState, simulation, message: 'A posição ainda não sustenta uma paz separada politicamente.' };
  const nextWar = removeMemberFromWar(war, entityId);
  const mobilization = { ...warState.mobilization, [entityId]: 'none' as const };
  let nextSimulation = mutateRelation(simulation, entityId, disposition.leaderId, -16, -18, 'Assinou paz separada e deixou os demais aliados em guerra.');
  nextSimulation = mutateRelation(nextSimulation, entityId, disposition.enemyLeaderId, 9, 7, 'Concluiu uma paz separada durante a guerra da coalizão.');
  recordAction(war, entityId, disposition.leaderId, 'separate-peace', simulation, 'O membro assinou paz separada com o lado adversário.');
  return {
    accepted: true,
    warState: { ...warState, mobilization, wars: warState.wars.map((item) => item.id === warId ? nextWar : item) },
    simulation: nextSimulation,
    message: 'Paz separada assinada. A entidade saiu da guerra e sofreu forte perda de confiança junto ao antigo líder.',
  };
}

export function defectCoalitionMember(warState: WarState, warId: string, entityId: string, simulation: SimulationState, control: TerritorialControlState) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return { accepted: false, warState, simulation, message: 'Guerra não encontrada.' };
  const disposition = coalitionMemberDisposition(war, entityId, simulation, control);
  if (!disposition?.canDefect) return { accepted: false, warState, simulation, message: 'Mudança de lado exige ruptura política extrema e maior alinhamento com o adversário.' };
  const wasAttacker = disposition.side === 'attacker';
  const attackers = wasAttacker
    ? war.attackers.filter((id) => id !== entityId)
    : [...new Set([...war.attackers, entityId])];
  const defenders = wasAttacker
    ? [...new Set([...war.defenders, entityId])]
    : war.defenders.filter((id) => id !== entityId);
  const nextWar: War = { ...war, attackers, defenders };
  const mobilization = { ...warState.mobilization, [entityId]: 'partial' as const };
  let nextSimulation = mutateRelation(simulation, entityId, disposition.leaderId, -28, -30, 'Rompeu com a coalizão e mudou de lado durante a guerra.');
  nextSimulation = mutateRelation(nextSimulation, entityId, disposition.enemyLeaderId, 14, 12, 'Foi aceito como novo parceiro após mudar de lado durante a guerra.');
  recordAction(war, entityId, disposition.leaderId, 'defection', simulation, 'O membro rompeu a coalizão e passou para o lado adversário.');
  return {
    accepted: true,
    warState: { ...warState, mobilization, wars: warState.wars.map((item) => item.id === warId ? nextWar : item) },
    simulation: nextSimulation,
    message: 'Mudança de lado concluída. A entidade passou para a coalizão adversária e sua relação com o antigo líder colapsou.',
  };
}
