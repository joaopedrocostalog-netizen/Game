import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from './simulation';
import { evaluateCrisis, type CrisisSide, type DiplomaticCrisis } from './crisis';

export type ConferenceTerm = 'status_quo' | 'mutual_demobilization' | 'arbitration' | 'limited_concession';
export type ConferenceStatus = 'open' | 'settled' | 'collapsed';
export type InterventionKind = 'guarantee' | 'intervention';

export type ConferenceRecord = {
  id: string;
  crisisId: string;
  chairId: string;
  openedAtElapsedDay: number;
  rounds: number;
  status: ConferenceStatus;
  lastTerm?: ConferenceTerm;
  outcome?: string;
};

export type FormalCommitment = {
  id: string;
  crisisId: string;
  entityId: string;
  side: CrisisSide;
  kind: InterventionKind;
  credibility: number;
  acceptedAtElapsedDay: number;
};

export type ConferenceState = {
  conferences: ConferenceRecord[];
  commitments: FormalCommitment[];
};

export type ConferenceEvaluation = {
  acceptance: number;
  chairTrust: number;
  blocBalance: number;
  reason: string;
};

type ConferenceGlobal = typeof globalThis & {
  __WORLD_STATE_CONFERENCES__?: ConferenceState;
};

type CrisisGlobal = typeof globalThis & {
  __WORLD_STATE_CRISES__?: DiplomaticCrisis[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function state(): ConferenceState {
  const root = globalThis as ConferenceGlobal;
  if (!root.__WORLD_STATE_CONFERENCES__) root.__WORLD_STATE_CONFERENCES__ = { conferences: [], commitments: [] };
  return root.__WORLD_STATE_CONFERENCES__;
}

function publish(next: ConferenceState) {
  (globalThis as ConferenceGlobal).__WORLD_STATE_CONFERENCES__ = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-conferences', { detail: next }));
}

function crises() {
  return (globalThis as CrisisGlobal).__WORLD_STATE_CRISES__ ?? [];
}

function publishCrises(next: DiplomaticCrisis[]) {
  (globalThis as CrisisGlobal).__WORLD_STATE_CRISES__ = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-crises', { detail: next }));
}

function relationBetween(simulation: SimulationState, a: string, b: string) {
  return Object.values(simulation.diplomacy).find((relation) => relation.parties.includes(a) && relation.parties.includes(b));
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

function mutateBilateralRelations(simulation: SimulationState, crisis: DiplomaticCrisis, accepted: boolean, term: ConferenceTerm) {
  const diplomacy = Object.fromEntries(Object.entries(simulation.diplomacy).map(([key, relation]) => {
    if (!(relation.parties.includes(crisis.initiatorId) && relation.parties.includes(crisis.targetId))) return [key, relation];
    const scoreDelta = accepted ? (term === 'arbitration' ? 6 : term === 'status_quo' ? 4 : 3) : -6;
    const trustDelta = accepted ? 3 : -4;
    const threatDelta = accepted ? -12 : 8;
    return [key, {
      ...relation,
      score: clamp(relation.score + scoreDelta, -100, 100),
      trust: clamp(relation.trust + trustDelta),
      threat: clamp(relation.threat + threatDelta),
      memory: [`Conferência internacional ${accepted ? 'evitou a guerra' : 'fracassou em produzir acordo'}.`, ...relation.memory].slice(0, 8),
    }];
  }));
  return { ...simulation, diplomacy };
}

export function resetConferences() {
  publish({ conferences: [], commitments: [] });
}

export function conferenceForCrisis(crisisId: string) {
  return state().conferences.find((item) => item.crisisId === crisisId);
}

export function commitmentsForCrisis(crisisId: string) {
  return state().commitments.filter((item) => item.crisisId === crisisId);
}

export function conveneConference(crisis: DiplomaticCrisis, chairId: string, simulation: SimulationState) {
  if (crisis.status !== 'active' || !chairId || chairId === crisis.initiatorId || chairId === crisis.targetId) return undefined;
  const current = state();
  const existing = current.conferences.find((item) => item.crisisId === crisis.id && item.status === 'open');
  if (existing) return existing;
  const record: ConferenceRecord = {
    id: `conference-${crisis.id}-${simulation.elapsedDays}`,
    crisisId: crisis.id,
    chairId,
    openedAtElapsedDay: simulation.elapsedDays,
    rounds: 0,
    status: 'open',
  };
  publish({ ...current, conferences: [record, ...current.conferences.filter((item) => item.crisisId !== crisis.id)].slice(0, 30) });
  publishCrises(crises().map((item) => item.id === crisis.id ? {
    ...item,
    mediatorId: chairId,
    tension: clamp(item.tension - 6),
    deadlineElapsedDay: item.deadlineElapsedDay + (simulation.date.year < 1850 ? 28 : 14),
  } : item));
  return record;
}

export function evaluateConferenceProposal(conference: ConferenceRecord, crisis: DiplomaticCrisis, simulation: SimulationState, term: ConferenceTerm): ConferenceEvaluation {
  const toInitiator = relationBetween(simulation, conference.chairId, crisis.initiatorId);
  const toTarget = relationBetween(simulation, conference.chairId, crisis.targetId);
  const chairTrust = clamp(((toInitiator?.trust ?? 45) + (toTarget?.trust ?? 45)) / 2);
  const crisisEvaluation = evaluateCrisis(crisis, simulation, 'mediation');
  const blocBalance = 100 - Math.abs(50 - crisisEvaluation.balance) * 2;
  const base: Record<ConferenceTerm, number> = {
    status_quo: 58,
    mutual_demobilization: 61,
    arbitration: 50,
    limited_concession: 44,
  };
  const legitimacyEffect = term === 'limited_concession' ? (crisis.legitimacy - 50) * 0.3 : term === 'status_quo' ? (50 - crisis.legitimacy) * 0.14 : 0;
  const mobilizationPressure = term === 'mutual_demobilization'
    ? (crisis.initiatorMobilization !== 'none' ? 6 : 0) + (crisis.targetMobilization !== 'none' ? 6 : 0)
    : 0;
  const acceptance = clamp(base[term] + (chairTrust - 45) * 0.45 + (blocBalance - 50) * 0.18 + legitimacyEffect + mobilizationPressure - crisis.tension * 0.24, 4, 96);
  const reason = term === 'arbitration'
    ? 'A arbitragem depende da confiança que os dois lados depositam na presidência da conferência.'
    : term === 'mutual_demobilization'
      ? 'A retirada recíproca de mobilização é mais atraente quando ambos os lados já elevaram a prontidão.'
      : term === 'limited_concession'
        ? 'Concessões limitadas são mais plausíveis quando o iniciador possui uma justificativa reconhecida e força diplomática.'
        : 'O status quo é a saída menos ambiciosa e tende a ganhar apoio quando nenhuma coalizão possui vantagem decisiva.';
  return { acceptance, chairTrust, blocBalance, reason };
}

export function resolveConferenceProposal(crisisId: string, simulation: SimulationState, term: ConferenceTerm) {
  const current = state();
  const conference = current.conferences.find((item) => item.crisisId === crisisId && item.status === 'open');
  const crisis = crises().find((item) => item.id === crisisId);
  if (!conference || !crisis || crisis.status !== 'active') return undefined;
  const evaluation = evaluateConferenceProposal(conference, crisis, simulation, term);
  const accepted = deterministicRoll(`${conference.id}:${term}:${conference.rounds}:${simulation.elapsedDays}`) < evaluation.acceptance;
  const rounds = conference.rounds + 1;
  const collapse = !accepted && (rounds >= 3 || crisis.tension >= 82);
  const nextConference: ConferenceRecord = {
    ...conference,
    rounds,
    lastTerm: term,
    status: accepted ? 'settled' : collapse ? 'collapsed' : 'open',
    outcome: accepted ? 'A conferência produziu um acordo e encerrou a crise sem guerra.' : collapse ? 'A conferência colapsou sem acordo.' : 'A rodada terminou sem consenso.',
  };
  publish({ ...current, conferences: current.conferences.map((item) => item.id === conference.id ? nextConference : item) });
  const nextCrisis: DiplomaticCrisis = accepted ? {
    ...crisis,
    status: 'resolved',
    tension: clamp(crisis.tension - 34),
    initiatorMobilization: 'none',
    targetMobilization: 'none',
    outcome: `Crise encerrada em conferência internacional (${term}).`,
  } : {
    ...crisis,
    tension: clamp(crisis.tension + (collapse ? 12 : 5)),
    status: collapse ? 'escalated' : crisis.status,
    outcome: collapse ? 'A conferência fracassou e a crise ficou pronta para escalada militar.' : crisis.outcome,
  };
  publishCrises(crises().map((item) => item.id === crisis.id ? nextCrisis : item));
  const nextSimulation = mutateBilateralRelations(simulation, nextCrisis, accepted, term);
  return {
    accepted,
    collapsed: collapse,
    conference: nextConference,
    crisis: nextCrisis,
    simulation: nextSimulation,
    evaluation,
    message: accepted
      ? `A proposta foi aceita. A crise terminou em conferência internacional. Aceitação estimada: ${evaluation.acceptance.toFixed(0)}%.`
      : collapse
        ? 'A terceira rodada terminou sem acordo e a conferência colapsou. A crise está pronta para escalar.'
        : `A proposta foi rejeitada. A conferência permanece aberta. Aceitação estimada: ${evaluation.acceptance.toFixed(0)}%.`,
  };
}

export function potentialFormalInterveners(entities: ScenarioEntity[], simulation: SimulationState, crisis: DiplomaticCrisis, side: CrisisSide) {
  const current = state();
  const committed = new Set(current.commitments.filter((item) => item.crisisId === crisis.id).map((item) => item.entityId));
  const principalId = side === 'initiator' ? crisis.initiatorId : crisis.targetId;
  const enemyId = side === 'initiator' ? crisis.targetId : crisis.initiatorId;
  return entities
    .filter((entity) => entity.id !== crisis.initiatorId && entity.id !== crisis.targetId && entity.id !== crisis.mediatorId && !committed.has(entity.id))
    .map((entity) => {
      const friendly = relationBetween(simulation, entity.id, principalId);
      const hostile = relationBetween(simulation, entity.id, enemyId);
      const publicSupport = crisis.supporters.find((item) => item.entityId === entity.id && item.side === side);
      const alignment = (friendly?.score ?? 0) - (hostile?.score ?? 0);
      const trust = friendly?.trust ?? 45;
      const power = statePower(simulation, entity.id);
      const willingness = clamp(24 + alignment * 0.34 + (trust - 45) * 0.35 + (publicSupport?.credibility ?? 0) * 0.28 + Math.max(0, power - 55) * 0.2 - crisis.tension * 0.1, 0, 100);
      return { entity, willingness, power, alreadyPublic: !!publicSupport };
    })
    .filter((item) => item.willingness >= 42)
    .sort((a, b) => b.willingness - a.willingness)
    .slice(0, 6);
}

export function requestFormalIntervention(crisisId: string, entityId: string, side: CrisisSide, kind: InterventionKind, simulation: SimulationState) {
  const crisis = crises().find((item) => item.id === crisisId);
  if (!crisis || crisis.status === 'resolved') return { accepted: false, message: 'A crise já não aceita novos compromissos formais.' };
  const current = state();
  if (current.commitments.some((item) => item.crisisId === crisisId && item.entityId === entityId)) return { accepted: false, message: 'A entidade já possui compromisso formal nesta crise.' };
  const principalId = side === 'initiator' ? crisis.initiatorId : crisis.targetId;
  const enemyId = side === 'initiator' ? crisis.targetId : crisis.initiatorId;
  const friendly = relationBetween(simulation, entityId, principalId);
  const hostile = relationBetween(simulation, entityId, enemyId);
  const publicSupport = crisis.supporters.find((item) => item.entityId === entityId && item.side === side);
  const alignment = (friendly?.score ?? 0) - (hostile?.score ?? 0);
  const willingness = clamp(24 + alignment * 0.34 + ((friendly?.trust ?? 45) - 45) * 0.35 + (publicSupport?.credibility ?? 0) * 0.28 + Math.max(0, statePower(simulation, entityId) - 55) * 0.2 - crisis.tension * 0.1 + (kind === 'guarantee' ? 9 : -3), 0, 100);
  const accepted = deterministicRoll(`${crisis.id}:${entityId}:${side}:${kind}:${simulation.elapsedDays}`) < willingness;
  if (!accepted) {
    publishCrises(crises().map((item) => item.id === crisisId ? { ...item, tension: clamp(item.tension + 2) } : item));
    return { accepted: false, message: `O compromisso formal foi recusado. Disposição estimada: ${willingness.toFixed(0)}%.` };
  }
  const commitment: FormalCommitment = {
    id: `commit-${crisisId}-${entityId}-${side}`,
    crisisId,
    entityId,
    side,
    kind,
    credibility: willingness,
    acceptedAtElapsedDay: simulation.elapsedDays,
  };
  publish({ ...current, commitments: [...current.commitments, commitment].slice(0, 60) });
  publishCrises(crises().map((item) => {
    if (item.id !== crisisId) return item;
    const supporters = item.supporters.some((support) => support.entityId === entityId)
      ? item.supporters.map((support) => support.entityId === entityId ? { ...support, side, level: 'military' as const, credibility: Math.max(support.credibility, willingness) } : support)
      : [...item.supporters, { entityId, side, level: 'military' as const, credibility: willingness, source: 'request' as const }];
    return { ...item, supporters, tension: clamp(item.tension + (kind === 'intervention' ? 9 : 6)) };
  }));
  return { accepted: true, commitment, message: kind === 'intervention' ? 'A entidade aceitou entrar formalmente na coalizão se a crise virar guerra.' : 'A entidade concedeu uma garantia formal e poderá entrar na coalizão se a crise escalar.' };
}

export function formalCoalitionsForCrisis(crisisId: string) {
  const commitments = commitmentsForCrisis(crisisId);
  return {
    attackers: commitments.filter((item) => item.side === 'initiator').map((item) => item.entityId),
    defenders: commitments.filter((item) => item.side === 'target').map((item) => item.entityId),
  };
}
