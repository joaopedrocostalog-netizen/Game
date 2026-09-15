import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import { openTreatyCrisesFor, type TreatyEnforcementCrisis } from './treatyCompliance';

export type EnforcementActionType = 'ultimatum' | 'sanctions' | 'emergency-conference' | 'negotiated-withdrawal' | 'guarantee-suspension';
export type EnforcementActionStatus = 'active' | 'accepted' | 'rejected' | 'expired' | 'resolved';

export type TreatyEnforcementAction = {
  id: string;
  treatyId: string;
  crisisId: string;
  actorId: string;
  targetId: string;
  type: EnforcementActionType;
  status: EnforcementActionStatus;
  createdAtElapsedDay: number;
  deadlineElapsedDay?: number;
  pressure: number;
  note: string;
};

export type TreatyEnforcementState = {
  actions: TreatyEnforcementAction[];
  lastAiReviewElapsedDay: number;
};

type Root = typeof globalThis & { __WORLD_STATE_TREATY_ENFORCEMENT__?: TreatyEnforcementState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): TreatyEnforcementState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_TREATY_ENFORCEMENT__) root.__WORLD_STATE_TREATY_ENFORCEMENT__ = { actions: [], lastAiReviewElapsedDay: 0 };
  return root.__WORLD_STATE_TREATY_ENFORCEMENT__;
}
function publish(state: TreatyEnforcementState) {
  (globalThis as Root).__WORLD_STATE_TREATY_ENFORCEMENT__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-treaty-enforcement', { detail: state }));
}
export function resetTreatyEnforcement() { publish({ actions: [], lastAiReviewElapsedDay: 0 }); }
export function treatyEnforcementState() { return { ...rootState(), actions: rootState().actions.map((item) => ({ ...item })) }; }

function event(simulation: SimulationState, actorId: string, title: string, text: string): WorldEvent {
  const stableTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return { id: `treaty-enforcement-${actorId}-${simulation.elapsedDays}-${stableTitle}`, date: simulation.date, entityId: actorId, category: 'diplomacy', title, text };
}
function mutateRelation(simulation: SimulationState, actorId: string, targetId: string, score: number, trust: number, threat: number, memory: string) {
  const key = pairKey(actorId, targetId);
  const relation = simulation.diplomacy[key];
  if (!relation) return simulation;
  return { ...simulation, diplomacy: { ...simulation.diplomacy, [key]: { ...relation, score: clamp(relation.score + score, -100, 100), trust: clamp(relation.trust + trust), threat: clamp(relation.threat + threat), memory: [memory, ...relation.memory].slice(0, 8) } } };
}

function crisisFor(actorId: string, crisisId: string) {
  return openTreatyCrisesFor(actorId).find((item) => item.id === crisisId);
}

function existingActive(crisisId: string, actorId: string, type: EnforcementActionType) {
  return rootState().actions.find((item) => item.crisisId === crisisId && item.actorId === actorId && item.type === type && item.status === 'active');
}

export function launchTreatyEnforcementAction(actorId: string, crisisId: string, type: EnforcementActionType, simulation: SimulationState) {
  const crisis = crisisFor(actorId, crisisId);
  if (!crisis) return { accepted: false, simulation, message: 'Nenhuma crise de tratado elegível foi encontrada para este Estado.' };
  if (!crisis.claimantIds.includes(actorId)) return { accepted: false, simulation, message: 'A entidade não é parte reclamante nem garantidora desta crise.' };
  if (existingActive(crisis.id, actorId, type)) return { accepted: false, simulation, message: 'Esta medida já está ativa para a crise.' };

  const deadline = type === 'ultimatum' ? simulation.elapsedDays + Math.max(14, Math.round(45 - crisis.severity * .25)) : undefined;
  const pressure = clamp(crisis.severity * (type === 'sanctions' ? .72 : type === 'ultimatum' ? .88 : .55), 10, 95);
  const labels: Record<EnforcementActionType, string> = {
    ultimatum: 'Ultimato formal de cumprimento', sanctions: 'Pressão econômica coordenada', 'emergency-conference': 'Conferência diplomática emergencial', 'negotiated-withdrawal': 'Proposta de retirada negociada', 'guarantee-suspension': 'Suspensão da garantia',
  };
  const action: TreatyEnforcementAction = { id: `enforcement-${crisis.id}-${actorId}-${type}-${simulation.elapsedDays}`, treatyId: crisis.treatyId, crisisId: crisis.id, actorId, targetId: crisis.violatorId, type, status: 'active', createdAtElapsedDay: simulation.elapsedDays, deadlineElapsedDay: deadline, pressure, note: labels[type] };
  publish({ ...rootState(), actions: [action, ...rootState().actions].slice(0, 80) });

  let nextSimulation = mutateRelation(simulation, actorId, crisis.violatorId, type === 'emergency-conference' ? -2 : -6, type === 'emergency-conference' ? -2 : -7, type === 'sanctions' ? 7 : 4, `${labels[type]} em resposta a uma violação do tratado.`);
  if (type === 'sanctions') {
    const target = nextSimulation.entities[crisis.violatorId];
    if (target) nextSimulation = { ...nextSimulation, entities: { ...nextSimulation.entities, [target.id]: { ...target, economyIndex: clamp(target.economyIndex - Math.max(1.2, pressure * .035)), treasuryIndex: clamp(target.treasuryIndex - Math.max(.8, pressure * .025)) } } };
  }
  nextSimulation = { ...nextSimulation, events: [event(nextSimulation, actorId, labels[type], type === 'ultimatum' ? `Foi emitido um ultimato com prazo para correção da violação do tratado. A pressão diplomática atual é ${pressure.toFixed(0)}/100.` : `${labels[type]} foi acionada durante a crise de cumprimento do tratado.`), ...nextSimulation.events].slice(0, 80) };
  return { accepted: true, simulation: nextSimulation, action, message: type === 'ultimatum' ? 'Ultimato emitido. O descumprimento até o prazo aumentará a legitimidade de medidas posteriores.' : `${labels[type]} iniciada.` };
}

export function respondToTreatyUltimatum(targetId: string, actionId: string, accept: boolean, simulation: SimulationState) {
  const state = rootState();
  const action = state.actions.find((item) => item.id === actionId && item.type === 'ultimatum' && item.targetId === targetId && item.status === 'active');
  if (!action) return { accepted: false, simulation, message: 'Ultimato ativo não encontrado.' };
  const status: EnforcementActionStatus = accept ? 'accepted' : 'rejected';
  publish({ ...state, actions: state.actions.map((item) => item.id === action.id ? { ...item, status } : item) });
  let nextSimulation = mutateRelation(simulation, action.actorId, targetId, accept ? 4 : -10, accept ? 5 : -12, accept ? -4 : 12, accept ? 'Aceitou corrigir a violação de tratado após ultimato.' : 'Rejeitou ultimato de cumprimento do tratado.');
  nextSimulation = { ...nextSimulation, events: [event(nextSimulation, targetId, accept ? 'Ultimato aceito' : 'Ultimato rejeitado', accept ? 'O governo aceitou formalmente corrigir a violação. A crise só será encerrada quando a condição material deixar de existir.' : 'O governo rejeitou as exigências e elevou o risco de sanções, isolamento ou nova guerra.'), ...nextSimulation.events].slice(0, 80) };
  return { accepted: true, simulation: nextSimulation, message: accept ? 'Compromisso aceito. Retire tropas ou normalize pagamentos para encerrar materialmente a violação.' : 'Ultimato rejeitado. A escalada diplomática permanece aberta.' };
}

export function processTreatyEnforcement(simulation: SimulationState) {
  const state = rootState();
  if (simulation.elapsedDays <= state.lastAiReviewElapsedDay) return { simulation, changed: false };
  let actions: TreatyEnforcementAction[] = state.actions.map((item) => ({ ...item }));
  let nextSimulation = simulation;
  let changed = false;

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (action.status !== 'active') continue;
    const stillOpen = openTreatyCrisesFor(action.actorId).some((crisis) => crisis.id === action.crisisId);
    if (!stillOpen) { actions[i] = { ...action, status: 'resolved' }; changed = true; continue; }
    if (action.type === 'ultimatum' && action.deadlineElapsedDay !== undefined && simulation.elapsedDays >= action.deadlineElapsedDay) {
      actions[i] = { ...action, status: 'expired', pressure: clamp(action.pressure + 12) };
      nextSimulation = mutateRelation(nextSimulation, action.actorId, action.targetId, -7, -9, 10, 'Ignorou o prazo de um ultimato por violação de tratado.');
      nextSimulation = { ...nextSimulation, events: [event(nextSimulation, action.actorId, 'Ultimato expira sem cumprimento', 'O prazo diplomático terminou com a violação ainda aberta. A crise agora sustenta medidas de enforcement mais severas e pode fundamentar um casus belli.'), ...nextSimulation.events].slice(0, 80) };
      changed = true;
    }
  }

  if (simulation.elapsedDays - state.lastAiReviewElapsedDay >= 30) {
    const allEntityIds = Object.keys(simulation.entities);
    for (const claimantId of allEntityIds.filter((id) => id !== simulation.playerEntityId)) {
      const crisis = openTreatyCrisesFor(claimantId).find((item) => item.claimantIds.includes(claimantId) && item.severity >= 68);
      if (!crisis) continue;
      const already = actions.some((item) => item.crisisId === crisis.id && item.actorId === claimantId && (item.status === 'active' || item.status === 'expired'));
      if (already) continue;
      const type: EnforcementActionType = crisis.severity >= 82 ? 'ultimatum' : 'emergency-conference';
      const pressure = clamp(crisis.severity * .8);
      const aiAction: TreatyEnforcementAction = { id: `enforcement-ai-${crisis.id}-${claimantId}-${simulation.elapsedDays}`, treatyId: crisis.treatyId, crisisId: crisis.id, actorId: claimantId, targetId: crisis.violatorId, type, status: 'active', createdAtElapsedDay: simulation.elapsedDays, deadlineElapsedDay: type === 'ultimatum' ? simulation.elapsedDays + 21 : undefined, pressure, note: type === 'ultimatum' ? 'Ultimato automático da IA' : 'Conferência emergencial convocada pela IA' };
      actions = [aiAction, ...actions].slice(0, 80);
      nextSimulation = mutateRelation(nextSimulation, claimantId, crisis.violatorId, -4, -5, 5, 'Escalou diplomaticamente uma crise por violação de tratado.');
      changed = true;
      break;
    }
  }

  if (changed || simulation.elapsedDays - state.lastAiReviewElapsedDay >= 30) publish({ actions, lastAiReviewElapsedDay: simulation.elapsedDays });
  return { simulation: nextSimulation, changed };
}

export function enforcementActionsForEntity(entityId: string) {
  return rootState().actions.filter((item) => item.actorId === entityId || item.targetId === entityId).map((item) => ({ ...item }));
}

export function treatyViolationCrisisBetween(attackerId: string, targetId: string): TreatyEnforcementCrisis | undefined {
  return openTreatyCrisesFor(attackerId).find((crisis) => crisis.violatorId === targetId && crisis.claimantIds.includes(attackerId));
}
