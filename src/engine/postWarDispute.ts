import type { ScenarioEntity } from '../data/scenarios';
import type { CasusBelliOption } from './casusBelli';
import { activeCrisisBetween, startDiplomaticCrisis } from './crisis';
import { postWarDisputes, type PeaceConferenceDispute } from './postWarConference';
import { pairKey, type SimulationState } from './simulation';

export type PostWarDisputeStatus = 'latent' | 'demanding' | 'settled' | 'rupture' | 'crisis';
export type PostWarDisputeAction = 'demand' | 'settlement' | 'break-alliance' | 'seek-support' | 'open-crisis';

export type PostWarDisputeEscalation = {
  disputeId: string;
  warId: string;
  claimantId: string;
  leaderId: string;
  status: PostWarDisputeStatus;
  pressure: number;
  maturity: number;
  lastActionAtElapsedDay: number;
  supportIds: string[];
  notes: string[];
};

type EscalationState = { items: PostWarDisputeEscalation[] };
type EscalationGlobal = typeof globalThis & { __WORLD_STATE_POSTWAR_DISPUTE_ESCALATION__?: EscalationState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): EscalationState {
  const root = globalThis as EscalationGlobal;
  if (!root.__WORLD_STATE_POSTWAR_DISPUTE_ESCALATION__) root.__WORLD_STATE_POSTWAR_DISPUTE_ESCALATION__ = { items: [] };
  return root.__WORLD_STATE_POSTWAR_DISPUTE_ESCALATION__;
}

function publish(items: PostWarDisputeEscalation[]) {
  (globalThis as EscalationGlobal).__WORLD_STATE_POSTWAR_DISPUTE_ESCALATION__ = { items };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-postwar-disputes', { detail: items }));
}

export function resetPostWarDisputeEscalation() {
  publish([]);
}

function relation(simulation: SimulationState, a: string, b: string) {
  return simulation.diplomacy[pairKey(a, b)];
}

function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, threatDelta: number, memory: string) {
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
        threat: clamp(current.threat + threatDelta),
        memory: [memory, ...current.memory].slice(0, 8),
      },
    },
  };
}

function baseEscalation(dispute: PeaceConferenceDispute, simulation: SimulationState): PostWarDisputeEscalation {
  const ageDays = Math.max(0, simulation.elapsedDays - dispute.createdAtElapsedDay);
  const rel = relation(simulation, dispute.claimantId, dispute.leaderId);
  const hostility = Math.max(0, -(rel?.score ?? 0));
  const mistrust = Math.max(0, 45 - (rel?.trust ?? 45));
  const maturity = clamp(dispute.severity * 0.62 + ageDays / 18 + hostility * 0.18 + mistrust * 0.2);
  const pressure = clamp(dispute.severity * 0.72 + ageDays / 24 + hostility * 0.15);
  return {
    disputeId: dispute.id,
    warId: dispute.warId,
    claimantId: dispute.claimantId,
    leaderId: dispute.leaderId,
    status: maturity >= 62 ? 'demanding' : 'latent',
    pressure,
    maturity,
    lastActionAtElapsedDay: dispute.createdAtElapsedDay,
    supportIds: [],
    notes: [dispute.reason],
  };
}

export function disputeEscalation(dispute: PeaceConferenceDispute, simulation: SimulationState) {
  const current = rootState();
  const existing = current.items.find((item) => item.disputeId === dispute.id);
  const computed = baseEscalation(dispute, simulation);
  if (!existing) {
    publish([computed, ...current.items].slice(0, 100));
    return computed;
  }
  if (['settled', 'rupture', 'crisis'].includes(existing.status)) return existing;
  const next = {
    ...existing,
    maturity: Math.max(existing.maturity, computed.maturity),
    pressure: Math.max(existing.pressure, computed.pressure),
    status: (computed.maturity >= 62 ? 'demanding' : existing.status) as PostWarDisputeStatus,
  };
  publish(current.items.map((item) => item.disputeId === dispute.id ? next : item));
  return next;
}

export function escalationsForEntity(entityId: string, simulation: SimulationState) {
  return postWarDisputes(entityId).map((dispute) => ({ dispute, escalation: disputeEscalation(dispute, simulation) }));
}

function updateEscalation(disputeId: string, updater: (item: PostWarDisputeEscalation) => PostWarDisputeEscalation) {
  const current = rootState();
  const items = current.items.map((item) => item.disputeId === disputeId ? updater(item) : item);
  publish(items);
  return items.find((item) => item.disputeId === disputeId);
}

export function demandPostWarCompensation(dispute: PeaceConferenceDispute, simulation: SimulationState) {
  const escalation = disputeEscalation(dispute, simulation);
  if (escalation.status === 'settled') return { accepted: false, simulation, escalation, message: 'A disputa já foi encerrada.' };
  if (escalation.maturity < 42) return { accepted: false, simulation, escalation, message: 'A disputa ainda não amadureceu o suficiente para uma exigência formal.' };
  const nextSimulation = mutateRelation(simulation, dispute.claimantId, dispute.leaderId, -4, -5, 4, 'Transformou a insatisfação pós-guerra em uma exigência formal de compensação.');
  const next = updateEscalation(dispute.id, (item) => ({ ...item, status: 'demanding', pressure: clamp(item.pressure + 9), lastActionAtElapsedDay: simulation.elapsedDays, notes: ['Exigência formal de compensação apresentada.', ...item.notes].slice(0, 6) }))!;
  return { accepted: true, simulation: nextSimulation, escalation: next, message: 'A exigência formal foi apresentada. A pressão diplomática aumentou.' };
}

export function settlePostWarDispute(dispute: PeaceConferenceDispute, simulation: SimulationState) {
  const escalation = disputeEscalation(dispute, simulation);
  if (escalation.status === 'settled') return { accepted: false, simulation, escalation, message: 'A disputa já foi encerrada.' };
  const leader = simulation.entities[dispute.leaderId];
  const claimant = simulation.entities[dispute.claimantId];
  if (!leader || !claimant) return { accepted: false, simulation, escalation, message: 'Não há dados econômicos suficientes para negociar compensação.' };
  const cost = clamp(2.5 + dispute.severity / 18, 3, 8);
  if (leader.treasuryIndex < cost + 8) return { accepted: false, simulation, escalation, message: 'O antigo líder da coalizão não possui margem fiscal suficiente para um acordo compensatório.' };
  let nextSimulation: SimulationState = {
    ...simulation,
    entities: {
      ...simulation.entities,
      [dispute.leaderId]: { ...leader, treasuryIndex: clamp(leader.treasuryIndex - cost) },
      [dispute.claimantId]: { ...claimant, treasuryIndex: clamp(claimant.treasuryIndex + cost * 0.7) },
    },
  };
  nextSimulation = mutateRelation(nextSimulation, dispute.claimantId, dispute.leaderId, 8, 10, -6, 'A disputa sobre a partilha pós-guerra foi encerrada por acordo compensatório.');
  const next = updateEscalation(dispute.id, (item) => ({ ...item, status: 'settled', pressure: 0, lastActionAtElapsedDay: simulation.elapsedDays, notes: [`Acordo compensatório aceito; custo fiscal ${cost.toFixed(1)}.`, ...item.notes].slice(0, 6) }))!;
  return { accepted: true, simulation: nextSimulation, escalation: next, message: `A disputa foi encerrada por compensação. Custo fiscal: ${cost.toFixed(1)}.` };
}

export function breakPostWarAlliance(dispute: PeaceConferenceDispute, simulation: SimulationState) {
  const escalation = disputeEscalation(dispute, simulation);
  if (escalation.maturity < 58 && dispute.severity < 68) return { accepted: false, simulation, escalation, message: 'A ruptura da aliança ainda seria desproporcional à gravidade da disputa.' };
  let changed = false;
  const treaties = simulation.treaties.map((treaty) => {
    if (treaty.active && treaty.type === 'alliance' && treaty.parties.includes(dispute.claimantId) && treaty.parties.includes(dispute.leaderId)) {
      changed = true;
      return { ...treaty, active: false };
    }
    return treaty;
  });
  let nextSimulation = { ...simulation, treaties };
  nextSimulation = mutateRelation(nextSimulation, dispute.claimantId, dispute.leaderId, -14, -20, 10, 'Rompeu a aliança em consequência da disputa sobre a paz pós-guerra.');
  const next = updateEscalation(dispute.id, (item) => ({ ...item, status: 'rupture', pressure: clamp(item.pressure + 12), lastActionAtElapsedDay: simulation.elapsedDays, notes: [changed ? 'Aliança formal rompida.' : 'Ruptura política declarada; não havia aliança formal ativa.', ...item.notes].slice(0, 6) }))!;
  return { accepted: true, simulation: nextSimulation, escalation: next, message: changed ? 'A aliança foi rompida por causa da disputa pós-guerra.' : 'A ruptura política foi declarada, embora não houvesse tratado de aliança ativo.' };
}

export function potentialPostWarPartners(dispute: PeaceConferenceDispute, simulation: SimulationState, entities: ScenarioEntity[]) {
  const excluded = new Set([dispute.claimantId, dispute.leaderId]);
  return entities
    .filter((entity) => !excluded.has(entity.id))
    .map((entity) => {
      const claimantRel = relation(simulation, dispute.claimantId, entity.id);
      const leaderRel = relation(simulation, dispute.leaderId, entity.id);
      const affinity = (claimantRel?.score ?? 0) - (leaderRel?.score ?? 0);
      const trust = claimantRel?.trust ?? 45;
      const willingness = clamp(38 + affinity * 0.32 + (trust - 45) * 0.42 + dispute.severity * 0.12);
      return { entityId: entity.id, willingness };
    })
    .filter((item) => item.willingness >= 42)
    .sort((a, b) => b.willingness - a.willingness)
    .slice(0, 6);
}

export function seekPostWarSupport(dispute: PeaceConferenceDispute, partnerId: string, simulation: SimulationState, entities: ScenarioEntity[]) {
  const escalation = disputeEscalation(dispute, simulation);
  if (escalation.maturity < 48) return { accepted: false, simulation, escalation, message: 'A disputa ainda não tem peso suficiente para atrair um apoiador externo.' };
  const candidate = potentialPostWarPartners(dispute, simulation, entities).find((item) => item.entityId === partnerId);
  if (!candidate) return { accepted: false, simulation, escalation, message: 'A entidade escolhida não demonstra interesse suficiente nesta disputa.' };
  const seed = `${dispute.id}:${partnerId}:${simulation.elapsedDays}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const accepted = (hash >>> 0) % 100 < candidate.willingness;
  if (!accepted) return { accepted: false, simulation, escalation, message: `O pedido de apoio foi recusado. Disposição estimada: ${candidate.willingness.toFixed(0)}%.` };
  let nextSimulation = mutateRelation(simulation, dispute.claimantId, partnerId, 5, 5, 0, 'Aproximou-se diplomaticamente em torno de uma disputa pós-guerra.');
  nextSimulation = mutateRelation(nextSimulation, dispute.leaderId, partnerId, -2, -2, 2, 'A entidade passou a apoiar diplomaticamente um antigo aliado insatisfeito.');
  const next = updateEscalation(dispute.id, (item) => ({ ...item, supportIds: [...new Set([...item.supportIds, partnerId])], pressure: clamp(item.pressure + 7), lastActionAtElapsedDay: simulation.elapsedDays, notes: [`Apoio diplomático obtido de ${partnerId}.`, ...item.notes].slice(0, 6) }))!;
  return { accepted: true, simulation: nextSimulation, escalation: next, message: 'A entidade aceitou apoiar diplomaticamente a reivindicação pós-guerra.' };
}

function disputeCasus(dispute: PeaceConferenceDispute, escalation: PostWarDisputeEscalation, simulation: SimulationState): CasusBelliOption {
  const legitimacy = clamp(52 + dispute.severity * 0.38 + escalation.supportIds.length * 4, 55, 90);
  return {
    id: `postwar-dispute-${dispute.id}`,
    type: 'retaliation',
    label: simulation.date.year < 1800 ? 'Quebra da partilha acordada' : 'Disputa sobre o acordo pós-guerra',
    description: 'Contestar diplomaticamente a distribuição de ganhos, promessas quebradas ou compensações negadas após uma vitória conjunta.',
    legitimacy,
    stabilityCost: 1.5,
    diplomaticCost: 5,
    preparationDays: 0,
    allowedGoals: ['reparations', 'defense'],
    available: true,
    reason: dispute.reason,
  };
}

export function openPostWarDiplomaticCrisis(dispute: PeaceConferenceDispute, simulation: SimulationState, entities: ScenarioEntity[]) {
  const escalation = disputeEscalation(dispute, simulation);
  if (['settled', 'crisis'].includes(escalation.status)) return { accepted: false, simulation, escalation, message: 'A disputa já foi encerrada ou convertida em crise.' };
  if (escalation.maturity < 62 && dispute.severity < 72) return { accepted: false, simulation, escalation, message: 'A disputa ainda não possui gravidade suficiente para se transformar em uma crise internacional.' };
  const claimant = entities.find((entity) => entity.id === dispute.claimantId);
  const leader = entities.find((entity) => entity.id === dispute.leaderId);
  if (!claimant || !leader) return { accepted: false, simulation, escalation, message: 'As entidades envolvidas não estão disponíveis neste cenário.' };
  const existing = activeCrisisBetween(dispute.claimantId, dispute.leaderId);
  if (existing) return { accepted: false, simulation, escalation, crisis: existing, message: 'Já existe uma crise diplomática ativa entre essas entidades.' };
  const crisis = startDiplomaticCrisis(claimant, leader, disputeCasus(dispute, escalation, simulation), 'reparations', simulation, entities);
  const nextSimulation = mutateRelation(simulation, dispute.claimantId, dispute.leaderId, -7, -8, 7, 'A disputa sobre a paz pós-guerra escalou para uma crise diplomática formal.');
  const next = updateEscalation(dispute.id, (item) => ({ ...item, status: 'crisis', pressure: 100, lastActionAtElapsedDay: simulation.elapsedDays, notes: [`Crise diplomática aberta: ${crisis.id}.`, ...item.notes].slice(0, 6) }))!;
  return { accepted: true, simulation: nextSimulation, escalation: next, crisis, message: 'A disputa foi convertida em uma crise diplomática formal. Mediação, apoios e ultimatos agora ficam disponíveis.' };
}
