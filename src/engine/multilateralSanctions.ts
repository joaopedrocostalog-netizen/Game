import { createOrganizationProposal, diplomaticOrganizationState } from './diplomaticOrganizations';
import { economicPressureState, endEconomicPressure, startEconomicPressure } from './economicPressure';
import { openTreatyCrisesFor } from './treatyCompliance';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import type { WarState } from './war';

export type SanctionsRegimeStatus = 'forming' | 'active' | 'fractured' | 'ended';
export type SanctionsIntensity = 'limited' | 'coordinated' | 'comprehensive';

export type SanctionsRegime = {
  id: string;
  sponsorId: string;
  targetId: string;
  crisisId?: string;
  memberIds: string[];
  breakerIds: string[];
  intensity: SanctionsIntensity;
  status: SanctionsRegimeStatus;
  legitimacy: number;
  cohesion: number;
  marketIsolation: number;
  startedAtElapsedDay: number;
  lastProcessedElapsedDay: number;
};

export type MultilateralSanctionsState = {
  regimes: SanctionsRegime[];
  lastAiReviewElapsedDay: number;
};

type Root = typeof globalThis & { __WORLD_STATE_MULTILATERAL_SANCTIONS__?: MultilateralSanctionsState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): MultilateralSanctionsState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_MULTILATERAL_SANCTIONS__) root.__WORLD_STATE_MULTILATERAL_SANCTIONS__ = { regimes: [], lastAiReviewElapsedDay: 0 };
  return root.__WORLD_STATE_MULTILATERAL_SANCTIONS__;
}
function publish(state: MultilateralSanctionsState) {
  (globalThis as Root).__WORLD_STATE_MULTILATERAL_SANCTIONS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-multilateral-sanctions', { detail: state }));
}
export function resetMultilateralSanctions() { publish({ regimes: [], lastAiReviewElapsedDay: 0 }); }
export function multilateralSanctionsState() {
  const state = rootState();
  return { ...state, regimes: state.regimes.map((item) => ({ ...item, memberIds: [...item.memberIds], breakerIds: [...item.breakerIds] })) };
}

function relation(simulation: SimulationState, a: string, b: string) { return simulation.diplomacy[pairKey(a, b)]; }
function worldEvent(simulation: SimulationState, entityId: string, title: string, text: string): WorldEvent {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return { id: `multilateral-sanctions-${entityId}-${simulation.elapsedDays}-${slug}`, date: simulation.date, entityId, category: 'diplomacy', title, text };
}
function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, threatDelta: number, memory: string) {
  const key = pairKey(a, b);
  const current = simulation.diplomacy[key];
  if (!current) return simulation;
  return { ...simulation, diplomacy: { ...simulation.diplomacy, [key]: { ...current, score: clamp(current.score + scoreDelta, -100, 100), trust: clamp(current.trust + trustDelta), threat: clamp(current.threat + threatDelta), memory: [memory, ...current.memory].slice(0, 8) } } };
}
function crisisLegitimacy(sponsorId: string, targetId: string) {
  const crisis = openTreatyCrisesFor(sponsorId).find((item) => item.violatorId === targetId && item.claimantIds.includes(sponsorId));
  return crisis ? { crisisId: crisis.id, legitimacy: clamp(52 + crisis.severity * .48) } : { crisisId: undefined, legitimacy: 42 };
}
function pressureAction(intensity: SanctionsIntensity) { return intensity === 'limited' ? 'sanctions' as const : intensity === 'coordinated' ? 'sanctions' as const : 'market_restriction' as const; }

function syncMemberPressure(regime: SanctionsRegime, memberId: string, simulation: SimulationState, warState: WarState) {
  const state = economicPressureState();
  const primary = state.measures.find((measure) => measure.active && measure.initiatorId === memberId && measure.targetId === regime.targetId && measure.action === 'sanctions');
  if (!primary) startEconomicPressure(memberId, regime.targetId, 'sanctions', simulation, warState);
  if (regime.intensity === 'comprehensive') {
    const market = economicPressureState().measures.find((measure) => measure.active && measure.initiatorId === memberId && measure.targetId === regime.targetId && measure.action === 'market_restriction');
    if (!market) startEconomicPressure(memberId, regime.targetId, 'market_restriction', simulation, warState);
  }
}
function removeMemberPressure(regime: SanctionsRegime, memberId: string) {
  const measures = economicPressureState().measures.filter((measure) => measure.active && measure.initiatorId === memberId && measure.targetId === regime.targetId && (measure.action === 'sanctions' || measure.action === 'market_restriction'));
  for (const measure of measures) endEconomicPressure(measure.id);
}

function recalc(regime: SanctionsRegime, simulation: SimulationState): SanctionsRegime {
  const target = simulation.entities[regime.targetId];
  const members = regime.memberIds.filter((id) => !!simulation.entities[id]);
  const economicWeight = members.reduce((sum, id) => sum + (simulation.entities[id]?.economyIndex ?? 35), 0);
  const averageAffinity = members.length ? members.reduce((sum, id) => sum + Math.max(0, -(relation(simulation, id, regime.targetId)?.score ?? 0)), 0) / members.length : 0;
  const breakerPenalty = regime.breakerIds.length * 8;
  const intensityFactor = regime.intensity === 'limited' ? .72 : regime.intensity === 'coordinated' ? 1 : 1.22;
  const isolation = clamp((economicWeight / Math.max(1, members.length)) * .55 * intensityFactor + members.length * 7 + averageAffinity * .22 - breakerPenalty - (target?.economyIndex ?? 50) * .14);
  const cohesion = clamp(54 + regime.legitimacy * .25 + members.length * 3 - regime.breakerIds.length * 13);
  return { ...regime, memberIds: members, marketIsolation: isolation, cohesion, status: members.length <= 1 && regime.breakerIds.length ? 'fractured' : 'active' };
}

export function createSanctionsRegime(sponsorId: string, targetId: string, intensity: SanctionsIntensity, simulation: SimulationState, warState: WarState) {
  if (sponsorId === targetId || !simulation.entities[sponsorId] || !simulation.entities[targetId]) return { accepted: false, simulation, message: 'Selecione um alvo válido para o regime de sanções.' };
  const state = rootState();
  const existing = state.regimes.find((item) => item.status !== 'ended' && item.sponsorId === sponsorId && item.targetId === targetId);
  if (existing) return { accepted: false, simulation, regime: existing, message: 'Já existe um regime de sanções liderado por este Estado contra o alvo.' };
  const basis = crisisLegitimacy(sponsorId, targetId);
  let regime: SanctionsRegime = {
    id: `sanctions-regime-${sponsorId}-${targetId}-${simulation.elapsedDays}`,
    sponsorId, targetId, crisisId: basis.crisisId, memberIds: [sponsorId], breakerIds: [], intensity,
    status: 'forming', legitimacy: basis.legitimacy, cohesion: 55, marketIsolation: 0,
    startedAtElapsedDay: simulation.elapsedDays, lastProcessedElapsedDay: simulation.elapsedDays,
  };
  syncMemberPressure(regime, sponsorId, simulation, warState);
  regime = recalc(regime, simulation);
  publish({ ...state, regimes: [regime, ...state.regimes].slice(0, 40) });
  let nextSimulation = mutateRelation(simulation, sponsorId, targetId, -7, -6, 7, 'Liderou um regime multilateral de sanções e isolamento comercial.');
  nextSimulation = { ...nextSimulation, events: [worldEvent(nextSimulation, sponsorId, 'Regime multilateral de sanções criado', `${regime.memberIds.length} Estado(s) participam inicialmente. Legitimidade diplomática estimada em ${regime.legitimacy.toFixed(0)}/100.`), ...nextSimulation.events].slice(0, 80) };
  return { accepted: true, simulation: nextSimulation, regime, message: 'Regime criado. Outros Estados poderão aderir ou romper conforme interesses, relações e custos econômicos.' };
}

export function joinSanctionsRegime(regimeId: string, entityId: string, simulation: SimulationState, warState: WarState) {
  const state = rootState();
  const regime = state.regimes.find((item) => item.id === regimeId && item.status !== 'ended');
  if (!regime || entityId === regime.targetId || regime.memberIds.includes(entityId)) return { accepted: false, simulation, message: 'Adesão indisponível.' };
  let next = recalc({ ...regime, memberIds: [...regime.memberIds, entityId], breakerIds: regime.breakerIds.filter((id) => id !== entityId) }, simulation);
  syncMemberPressure(next, entityId, simulation, warState);
  publish({ ...state, regimes: state.regimes.map((item) => item.id === regime.id ? next : item) });
  let nextSimulation = mutateRelation(simulation, entityId, regime.targetId, -5, -4, 5, 'Aderiu a um regime multilateral de sanções.');
  nextSimulation = mutateRelation(nextSimulation, entityId, regime.sponsorId, 3, 3, -1, 'Cooperou em um regime multilateral de sanções.');
  return { accepted: true, simulation: nextSimulation, regime: next, message: 'Adesão registrada. As restrições comerciais coordenadas foram ativadas.' };
}

export function breakSanctionsRegime(regimeId: string, entityId: string, simulation: SimulationState) {
  const state = rootState();
  const regime = state.regimes.find((item) => item.id === regimeId && item.status !== 'ended');
  if (!regime || !regime.memberIds.includes(entityId) || entityId === regime.sponsorId) return { accepted: false, simulation, message: 'Não é possível romper este regime por esta entidade.' };
  removeMemberPressure(regime, entityId);
  let next = recalc({ ...regime, memberIds: regime.memberIds.filter((id) => id !== entityId), breakerIds: [...new Set([...regime.breakerIds, entityId])] }, simulation);
  publish({ ...state, regimes: state.regimes.map((item) => item.id === regime.id ? next : item) });
  let nextSimulation = mutateRelation(simulation, entityId, regime.targetId, 7, 4, -3, 'Rompeu um regime de sanções e reabriu canais econômicos.');
  for (const memberId of next.memberIds) nextSimulation = mutateRelation(nextSimulation, entityId, memberId, -5, -8, 2, 'Quebrou a disciplina de um regime multilateral de sanções.');
  nextSimulation = { ...nextSimulation, events: [worldEvent(nextSimulation, entityId, 'Ruptura no regime de sanções', 'Um participante abandonou as restrições coordenadas e reabriu parte do acesso econômico ao Estado sancionado.'), ...nextSimulation.events].slice(0, 80) };
  return { accepted: true, simulation: nextSimulation, regime: next, message: 'O Estado rompeu o regime. A coesão caiu e o alvo ganhou acesso econômico alternativo.' };
}

export function seekOrganizationSuspension(regimeId: string, sponsorId: string, simulation: SimulationState) {
  const regime = rootState().regimes.find((item) => item.id === regimeId && item.status !== 'ended' && item.sponsorId === sponsorId);
  if (!regime) return { accepted: false, message: 'Regime não encontrado.' };
  const organizations = diplomaticOrganizationState().organizations.filter((org) => org.active && org.memberIds.includes(sponsorId) && org.memberIds.includes(regime.targetId));
  for (const org of organizations) {
    const proposal = createOrganizationProposal(org.id, sponsorId, 'discipline_member', simulation, regime.targetId);
    if (proposal) return { accepted: true, organizationId: org.id, message: `Foi aberta votação em ${org.name} para suspender ou disciplinar o Estado sancionado.` };
  }
  return { accepted: false, message: 'Não existe organização compartilhada elegível ou já há outra votação aberta.' };
}

export function processMultilateralSanctions(simulation: SimulationState, warState: WarState) {
  const state = rootState();
  if (simulation.elapsedDays <= state.lastAiReviewElapsedDay) return { simulation, changed: false };
  let regimes = state.regimes.map((item) => ({ ...item, memberIds: [...item.memberIds], breakerIds: [...item.breakerIds] }));
  let nextSimulation = simulation;
  let changed = false;

  for (let i = 0; i < regimes.length; i += 1) {
    let regime = regimes[i];
    if (regime.status === 'ended') continue;
    for (const memberId of regime.memberIds) syncMemberPressure(regime, memberId, nextSimulation, warState);
    regime = recalc({ ...regime, lastProcessedElapsedDay: simulation.elapsedDays }, nextSimulation);
    regimes[i] = regime;
  }

  if (simulation.elapsedDays - state.lastAiReviewElapsedDay >= 30) {
    for (let i = 0; i < regimes.length; i += 1) {
      let regime = regimes[i];
      if (regime.status === 'ended') continue;
      const candidates = Object.keys(simulation.entities).filter((id) => id !== simulation.playerEntityId && id !== regime.targetId && !regime.memberIds.includes(id) && !regime.breakerIds.includes(id));
      const joiner = candidates.find((id) => {
        const toTarget = relation(nextSimulation, id, regime.targetId);
        const toSponsor = relation(nextSimulation, id, regime.sponsorId);
        return regime.legitimacy >= 58 && (toTarget?.score ?? 0) <= -18 && (toSponsor?.trust ?? 45) >= 45;
      });
      if (joiner) {
        regime = recalc({ ...regime, memberIds: [...regime.memberIds, joiner] }, nextSimulation);
        syncMemberPressure(regime, joiner, nextSimulation, warState);
        regimes[i] = regime;
        nextSimulation = mutateRelation(nextSimulation, joiner, regime.targetId, -4, -3, 4, 'Aderiu automaticamente a um regime multilateral de sanções.');
        changed = true;
        break;
      }
      const defector = regime.memberIds.find((id) => id !== regime.sponsorId && id !== simulation.playerEntityId && ((relation(nextSimulation, id, regime.targetId)?.tradeInterest ?? 0) >= 72 || (relation(nextSimulation, id, regime.targetId)?.score ?? 0) >= 38));
      if (defector) {
        removeMemberPressure(regime, defector);
        regime = recalc({ ...regime, memberIds: regime.memberIds.filter((id) => id !== defector), breakerIds: [...new Set([...regime.breakerIds, defector])] }, nextSimulation);
        regimes[i] = regime;
        nextSimulation = mutateRelation(nextSimulation, defector, regime.sponsorId, -5, -7, 2, 'Rompeu a disciplina multilateral de sanções por interesses econômicos ou diplomáticos.');
        changed = true;
        break;
      }
    }
  }
  publish({ regimes, lastAiReviewElapsedDay: simulation.elapsedDays });
  return { simulation: nextSimulation, changed };
}

export function sanctionsRegimesForEntity(entityId: string) {
  return rootState().regimes.filter((item) => item.sponsorId === entityId || item.targetId === entityId || item.memberIds.includes(entityId) || item.breakerIds.includes(entityId)).map((item) => ({ ...item, memberIds: [...item.memberIds], breakerIds: [...item.breakerIds] }));
}
