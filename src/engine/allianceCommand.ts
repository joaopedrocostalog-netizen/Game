import { pairKey, type SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { War, WarState } from './war';
import { coalitionMemberDisposition } from './coalitionPolitics';

export type CoalitionRewardType = 'territory' | 'reparations' | 'influence' | 'security';
export type CoalitionCommandAction = 'invite' | 'expel' | 'promise';

export type CoalitionRewardPromise = {
  id: string;
  warId: string;
  leaderId: string;
  memberId: string;
  type: CoalitionRewardType;
  targetId: string;
  locationId?: string;
  promisedAtElapsedDay: number;
  fulfilled: boolean;
  broken: boolean;
};

export type CoalitionCommandRecord = {
  id: string;
  warId: string;
  leaderId: string;
  memberId: string;
  action: CoalitionCommandAction;
  elapsedDay: number;
  note: string;
};

type AllianceCommandState = { promises: CoalitionRewardPromise[]; records: CoalitionCommandRecord[] };
type AllianceCommandGlobal = typeof globalThis & { __WORLD_STATE_ALLIANCE_COMMAND__?: AllianceCommandState };

function rootState(): AllianceCommandState {
  const root = globalThis as AllianceCommandGlobal;
  if (!root.__WORLD_STATE_ALLIANCE_COMMAND__) root.__WORLD_STATE_ALLIANCE_COMMAND__ = { promises: [], records: [] };
  return root.__WORLD_STATE_ALLIANCE_COMMAND__;
}

function publish(next: AllianceCommandState) {
  (globalThis as AllianceCommandGlobal).__WORLD_STATE_ALLIANCE_COMMAND__ = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-alliance-command', { detail: next }));
}

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }

function relation(simulation: SimulationState, a: string, b: string) {
  return simulation.diplomacy[pairKey(a, b)];
}

function allied(simulation: SimulationState, a: string, b: string) {
  return simulation.treaties.some((treaty) => treaty.active && treaty.type === 'alliance' && treaty.parties.includes(a) && treaty.parties.includes(b));
}

function statePower(simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return 45;
  return runtime.militaryReadiness * 0.5 + runtime.treasuryIndex * 0.2 + runtime.technology * 0.2 + runtime.stability * 0.1;
}

function deterministicRoll(seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100;
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

function record(war: War, leaderId: string, memberId: string, action: CoalitionCommandAction, elapsedDay: number, note: string) {
  const current = rootState();
  const item: CoalitionCommandRecord = { id: `coalition-command-${action}-${war.id}-${memberId}-${elapsedDay}`, warId: war.id, leaderId, memberId, action, elapsedDay, note };
  publish({ ...current, records: [item, ...current.records].slice(0, 120) });
}

export function resetAllianceCommand() { publish({ promises: [], records: [] }); }
export function coalitionPromises(warId?: string) { const items = rootState().promises; return warId ? items.filter((item) => item.warId === warId) : [...items]; }
export function coalitionCommandHistory(warId?: string) { const items = rootState().records; return warId ? items.filter((item) => item.warId === warId) : [...items]; }

function sideForLeader(war: War, entityId: string) {
  if (war.attackerId === entityId) return 'attacker' as const;
  if (war.defenderId === entityId) return 'defender' as const;
  return undefined;
}

export function potentialWartimeAllies(war: War, leaderId: string, simulation: SimulationState) {
  const side = sideForLeader(war, leaderId);
  if (!side) return [];
  const enemyId = side === 'attacker' ? war.defenderId : war.attackerId;
  const members = new Set([...war.attackers, ...war.defenders]);
  return Object.keys(simulation.entities)
    .filter((id) => !members.has(id))
    .map((entityId) => {
      const friendly = relation(simulation, entityId, leaderId);
      const enemy = relation(simulation, entityId, enemyId);
      const alliance = allied(simulation, entityId, leaderId);
      const alignment = (friendly?.score ?? 0) - (enemy?.score ?? 0);
      const trust = friendly?.trust ?? 45;
      const power = statePower(simulation, entityId);
      const willingness = clamp(24 + alignment * 0.34 + (trust - 45) * 0.38 + (alliance ? 27 : 0) + Math.max(0, power - 50) * 0.2 - war.elapsedDays * 0.018, 0, 100);
      return { entityId, willingness, power, alliance };
    })
    .filter((item) => item.willingness >= 34)
    .sort((a, b) => b.willingness - a.willingness)
    .slice(0, 8);
}

export function inviteWartimeAlly(warState: WarState, warId: string, leaderId: string, candidateId: string, simulation: SimulationState) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return { accepted: false, warState, simulation, message: 'Guerra não encontrada.' };
  const side = sideForLeader(war, leaderId);
  if (!side) return { accepted: false, warState, simulation, message: 'Somente o líder de um dos lados pode ampliar formalmente a coalizão.' };
  if ([...war.attackers, ...war.defenders].includes(candidateId)) return { accepted: false, warState, simulation, message: 'A entidade já participa desta guerra.' };
  const candidate = potentialWartimeAllies(war, leaderId, simulation).find((item) => item.entityId === candidateId);
  if (!candidate) return { accepted: false, warState, simulation, message: 'A entidade não demonstra disposição suficiente para entrar nesta guerra.' };
  const accepted = deterministicRoll(`${war.id}:${leaderId}:${candidateId}:${simulation.elapsedDays}`) < candidate.willingness;
  if (!accepted) {
    const nextSimulation = mutateRelation(simulation, candidateId, leaderId, -2, -1, 'Recusou um chamado para entrar em guerra ao lado desta potência.');
    return { accepted: false, warState, simulation: nextSimulation, message: `O chamado foi recusado. Disposição estimada: ${candidate.willingness.toFixed(0)}%.` };
  }
  const nextWar: War = side === 'attacker'
    ? { ...war, attackers: [...war.attackers, candidateId] }
    : { ...war, defenders: [...war.defenders, candidateId] };
  const mobilization = { ...warState.mobilization, [candidateId]: 'partial' as const };
  const nextSimulation = mutateRelation(simulation, candidateId, leaderId, 5, 6, 'Aceitou um chamado e entrou formalmente na coalizão durante a guerra.');
  record(war, leaderId, candidateId, 'invite', simulation.elapsedDays, 'A entidade aceitou o chamado e entrou formalmente na coalizão.');
  return { accepted: true, warState: { ...warState, mobilization, wars: warState.wars.map((item) => item.id === warId ? nextWar : item) }, simulation: nextSimulation, message: 'A entidade entrou formalmente na coalizão e iniciou mobilização parcial.' };
}

export function expelCoalitionMember(warState: WarState, warId: string, leaderId: string, memberId: string, simulation: SimulationState, control: TerritorialControlState) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return { accepted: false, warState, simulation, message: 'Guerra não encontrada.' };
  const side = sideForLeader(war, leaderId);
  if (!side) return { accepted: false, warState, simulation, message: 'Somente o líder da coalizão pode expulsar um membro.' };
  if (memberId === leaderId) return { accepted: false, warState, simulation, message: 'O líder não pode expulsar a si próprio.' };
  const members = side === 'attacker' ? war.attackers : war.defenders;
  if (!members.includes(memberId)) return { accepted: false, warState, simulation, message: 'A entidade não pertence a esta coalizão.' };
  const disposition = coalitionMemberDisposition(war, memberId, simulation, control);
  if (disposition && disposition.loyalty >= 68 && disposition.warWeariness < 55) return { accepted: false, warState, simulation, message: 'Expulsar um parceiro ainda leal teria custo político excessivo e foi bloqueado.' };
  const nextWar: War = side === 'attacker'
    ? { ...war, attackers: war.attackers.filter((id) => id !== memberId) }
    : { ...war, defenders: war.defenders.filter((id) => id !== memberId) };
  const mobilization = { ...warState.mobilization, [memberId]: 'none' as const };
  let nextSimulation = mutateRelation(simulation, memberId, leaderId, -14, -18, 'Foi expulso da coalizão durante uma guerra ativa.');
  nextSimulation = mutateRelation(nextSimulation, memberId, side === 'attacker' ? war.defenderId : war.attackerId, 5, 3, 'Foi afastado do bloco adversário durante a guerra.');
  record(war, leaderId, memberId, 'expel', simulation.elapsedDays, 'O líder expulsou este membro da coalizão e encerrou seu compromisso militar.');
  return { accepted: true, warState: { ...warState, mobilization, wars: warState.wars.map((item) => item.id === warId ? nextWar : item) }, simulation: nextSimulation, message: 'O membro foi expulso da coalizão. A confiança bilateral caiu fortemente.' };
}

export function promiseCoalitionReward(war: War, leaderId: string, memberId: string, type: CoalitionRewardType, simulation: SimulationState, locationId?: string) {
  const side = sideForLeader(war, leaderId);
  if (!side) return { accepted: false, simulation, message: 'Somente o líder da coalizão pode prometer recompensas em nome do bloco.' };
  const members = side === 'attacker' ? war.attackers : war.defenders;
  if (!members.includes(memberId) || memberId === leaderId) return { accepted: false, simulation, message: 'Selecione um membro aliado válido.' };
  const current = rootState();
  const duplicate = current.promises.some((item) => item.warId === war.id && item.memberId === memberId && item.type === type && !item.broken);
  if (duplicate) return { accepted: false, simulation, message: 'Já existe uma promessa ativa desse tipo para este aliado.' };
  const enemyLeaderId = side === 'attacker' ? war.defenderId : war.attackerId;
  const promise: CoalitionRewardPromise = {
    id: `reward-${war.id}-${memberId}-${type}-${simulation.elapsedDays}`,
    warId: war.id,
    leaderId,
    memberId,
    type,
    targetId: enemyLeaderId,
    locationId,
    promisedAtElapsedDay: simulation.elapsedDays,
    fulfilled: false,
    broken: false,
  };
  publish({ ...current, promises: [promise, ...current.promises].slice(0, 100) });
  const nextSimulation = mutateRelation(simulation, memberId, leaderId, 4, 6, `Recebeu promessa de recompensa de guerra: ${type}.`);
  record(war, leaderId, memberId, 'promise', simulation.elapsedDays, `O líder prometeu ${type} como recompensa pós-guerra.`);
  return { accepted: true, simulation: nextSimulation, promise, message: 'A promessa foi registrada. Ela melhora a confiança agora, mas quebrá-la depois da guerra terá custo diplomático.' };
}

export function markRewardPromisesAfterWar(war: War, winnerSide: 'attacker' | 'defender', simulation: SimulationState) {
  const current = rootState();
  const winnerLeader = winnerSide === 'attacker' ? war.attackerId : war.defenderId;
  let nextSimulation = simulation;
  const promises = current.promises.map((promise) => {
    if (promise.warId !== war.id || promise.fulfilled || promise.broken) return promise;
    const fulfilled = promise.leaderId === winnerLeader;
    if (fulfilled) {
      nextSimulation = mutateRelation(nextSimulation, promise.memberId, promise.leaderId, 4, 5, 'A vitória preservou a credibilidade das promessas feitas durante a guerra.');
      return { ...promise, fulfilled: true };
    }
    nextSimulation = mutateRelation(nextSimulation, promise.memberId, promise.leaderId, -10, -14, 'Uma promessa de recompensa de guerra terminou sem ser cumprida.');
    return { ...promise, broken: true };
  });
  publish({ ...current, promises });
  return nextSimulation;
}
