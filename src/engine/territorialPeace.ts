import { locationsForEntity, locationsForYear } from '../data/territories';
import type { ScenarioEntity } from '../data/scenarios';
import { civilConflictState } from './civilConflict';
import { emergentStatehoodState } from './emergentStatehood';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import type { OccupationState, TerritorialControlState } from './territorialControl';
import type { War, WarState } from './war';

export type TerritorialPeaceTerm = 'annexation' | 'restitution' | 'autonomy' | 'independence' | 'demilitarized' | 'reparations' | 'plebiscite';
export type TerritorialPeaceStatus = 'draft' | 'signed';

export type TerritorialPeaceClause = {
  id: string;
  type: TerritorialPeaceTerm;
  locationId?: string;
  fromEntityId?: string;
  beneficiaryId?: string;
  value?: number;
  result?: 'approved' | 'rejected';
  note: string;
};

export type TerritorialPeaceSettlement = {
  id: string;
  warId: string;
  leaderId: string;
  opponentId: string;
  status: TerritorialPeaceStatus;
  clauses: TerritorialPeaceClause[];
  openedAtElapsedDay: number;
  signedAtElapsedDay?: number;
};

export type DemilitarizedZone = {
  locationId: string;
  treatyId: string;
  parties: [string, string];
  createdAtElapsedDay: number;
};

type TerritorialPeaceState = {
  settlements: TerritorialPeaceSettlement[];
  demilitarizedZones: DemilitarizedZone[];
};

type Root = typeof globalThis & { __WORLD_STATE_TERRITORIAL_PEACE__?: TerritorialPeaceState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function hash(text: string) { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return Math.abs(h >>> 0); }
function rootState(): TerritorialPeaceState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_TERRITORIAL_PEACE__) root.__WORLD_STATE_TERRITORIAL_PEACE__ = { settlements: [], demilitarizedZones: [] };
  return root.__WORLD_STATE_TERRITORIAL_PEACE__;
}
function publish(state: TerritorialPeaceState) {
  (globalThis as Root).__WORLD_STATE_TERRITORIAL_PEACE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-territorial-peace', { detail: state }));
}
export function resetTerritorialPeace() { publish({ settlements: [], demilitarizedZones: [] }); }
export function territorialPeaceState() {
  const state = rootState();
  return {
    settlements: state.settlements.map((item) => ({ ...item, clauses: item.clauses.map((clause) => ({ ...clause })) })),
    demilitarizedZones: state.demilitarizedZones.map((item) => ({ ...item, parties: [...item.parties] as [string, string] })),
  };
}

function winnerInfo(war: War, entityId: string) {
  if (war.status !== 'ended' || war.victor === 'stalemate') return undefined;
  const winnerSide = war.victor === 'attackers' ? war.attackers : war.defenders;
  if (!winnerSide.includes(entityId)) return undefined;
  return {
    leaderId: war.victor === 'attackers' ? war.attackerId : war.defenderId,
    opponentId: war.victor === 'attackers' ? war.defenderId : war.attackerId,
  };
}

export function openTerritorialSettlement(war: War, entityId: string, simulation: SimulationState) {
  const winner = winnerInfo(war, entityId);
  if (!winner || winner.leaderId !== entityId) return undefined;
  const state = rootState();
  const existing = state.settlements.find((item) => item.warId === war.id);
  if (existing) return existing;
  const settlement: TerritorialPeaceSettlement = {
    id: `territorial-peace-${war.id}`,
    warId: war.id,
    leaderId: winner.leaderId,
    opponentId: winner.opponentId,
    status: 'draft',
    clauses: [],
    openedAtElapsedDay: simulation.elapsedDays,
  };
  publish({ ...state, settlements: [settlement, ...state.settlements].slice(0, 50) });
  return settlement;
}

export function eligiblePeaceLocations(war: War, year: number, control: TerritorialControlState) {
  const loserId = war.victor === 'attackers' ? war.defenderId : war.attackerId;
  const own = locationsForEntity(loserId, year);
  const occupied = Object.values(control.occupations).filter((item) => item.warId === war.id || item.ownerId === loserId);
  const ids = new Set([...own.map((item) => item.id), ...occupied.map((item) => item.locationId)]);
  const map = new Map(locationsForYear(year).map((item) => [item.id, item]));
  return [...ids].map((id) => map.get(id)).filter((item): item is NonNullable<typeof item> => !!item);
}

export function eligibleEmergentBeneficiaries(opponentId: string, locationId?: string) {
  const civil = civilConflictState();
  const statehood = emergentStatehoodState();
  return Object.values(civil.factions)
    .filter((faction) => faction.parentEntityId === opponentId && (faction.status === 'victorious' || faction.status === 'active'))
    .filter((faction) => !locationId || faction.controlledLocationIds.includes(locationId) || statehood.states[faction.id]?.claimedLocationIds.includes(locationId))
    .map((faction) => faction.id);
}

function occupationFor(locationId: string, loserId: string, warId: string, simulation: SimulationState, control: TerritorialControlState): OccupationState {
  return control.occupations[locationId] ?? {
    locationId,
    ownerId: loserId,
    controllerId: loserId,
    warId,
    progress: 0,
    contested: false,
    lastOutcome: 'defender-hold',
    battleCount: 0,
    updatedAt: simulation.date,
  };
}

function annexationAllowed(war: War, locationId: string, control: TerritorialControlState) {
  const occupation = control.occupations[locationId];
  const winnerController = war.victor === 'attackers' ? war.attackerId : war.defenderId;
  const controlled = occupation?.controllerId === winnerController && (occupation.progress >= 70 || !occupation.contested);
  return controlled || Math.abs(war.score) >= 55;
}

function plebisciteResult(war: War, locationId: string, beneficiaryId: string, simulation: SimulationState) {
  const loserId = war.victor === 'attackers' ? war.defenderId : war.attackerId;
  const loser = simulation.entities[loserId];
  const beneficiary = simulation.entities[beneficiaryId];
  const seed = hash(`${war.id}:${locationId}:${beneficiaryId}:${simulation.elapsedDays}`) % 100;
  const challenger = (beneficiary?.stability ?? 45) * .28 + (beneficiary?.economyIndex ?? 45) * .12;
  const incumbent = (loser?.stability ?? 50) * .24 + (loser?.economyIndex ?? 50) * .08;
  return seed + challenger - incumbent >= 48;
}

export function addTerritorialPeaceClause(
  settlementId: string,
  war: War,
  type: TerritorialPeaceTerm,
  simulation: SimulationState,
  control: TerritorialControlState,
  options: { locationId?: string; beneficiaryId?: string; value?: number },
) {
  const state = rootState();
  const settlement = state.settlements.find((item) => item.id === settlementId);
  if (!settlement || settlement.status !== 'draft') return { accepted: false, message: 'O tratado territorial não está aberto.' };
  const locationId = options.locationId;
  const beneficiaryId = options.beneficiaryId;
  if (type !== 'reparations' && !locationId) return { accepted: false, message: 'Selecione uma região para esta cláusula.' };
  if (locationId && settlement.clauses.some((item) => item.locationId === locationId && item.type !== 'demilitarized')) return { accepted: false, message: 'Essa região já possui uma cláusula territorial principal neste tratado.' };
  if (type === 'annexation' && locationId && !annexationAllowed(war, locationId, control)) return { accepted: false, message: 'Anexação direta exige controle militar relevante ou vitória decisiva.' };
  if ((type === 'autonomy' || type === 'independence') && (!beneficiaryId || !eligibleEmergentBeneficiaries(settlement.opponentId, locationId).includes(beneficiaryId))) return { accepted: false, message: 'Selecione uma entidade emergente compatível com a região.' };
  if (type === 'plebiscite' && !beneficiaryId) return { accepted: false, message: 'Selecione o beneficiário proposto para o plebiscito.' };

  const result = type === 'plebiscite' && locationId && beneficiaryId ? (plebisciteResult(war, locationId, beneficiaryId, simulation) ? 'approved' : 'rejected') : undefined;
  const clause: TerritorialPeaceClause = {
    id: `peace-clause-${settlement.id}-${settlement.clauses.length + 1}`,
    type,
    locationId,
    fromEntityId: type === 'restitution' ? settlement.leaderId : settlement.opponentId,
    beneficiaryId: beneficiaryId ?? (type === 'annexation' ? settlement.leaderId : type === 'restitution' ? settlement.opponentId : undefined),
    value: type === 'reparations' ? clamp(options.value ?? 8, 2, 25) : undefined,
    result,
    note: type === 'plebiscite' ? `Consulta política abstrata: ${result === 'approved' ? 'mudança aprovada' : 'mudança rejeitada'}.` : 'Cláusula territorial negociada na conferência pós-guerra.',
  };
  const next = { ...settlement, clauses: [...settlement.clauses, clause] };
  publish({ ...state, settlements: state.settlements.map((item) => item.id === settlement.id ? next : item) });
  return { accepted: true, clause, message: type === 'plebiscite' ? clause.note : 'Cláusula adicionada ao tratado territorial.' };
}

function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, memory: string) {
  const key = pairKey(a, b);
  const relation = simulation.diplomacy[key];
  if (!relation) return simulation;
  return { ...simulation, diplomacy: { ...simulation.diplomacy, [key]: { ...relation, score: clamp(relation.score + scoreDelta, -100, 100), trust: clamp(relation.trust + trustDelta), memory: [memory, ...relation.memory].slice(0, 8) } } };
}

export function signTerritorialSettlement(settlementId: string, war: War, simulation: SimulationState, control: TerritorialControlState) {
  const state = rootState();
  const settlement = state.settlements.find((item) => item.id === settlementId);
  if (!settlement || settlement.status !== 'draft') return { accepted: false, simulation, territorialControl: control, message: 'O tratado já foi encerrado ou não existe.' };
  if (!settlement.clauses.length) return { accepted: false, simulation, territorialControl: control, message: 'Adicione ao menos uma cláusula antes de assinar.' };

  let nextSimulation = simulation;
  let occupations = { ...control.occupations };
  let zones = [...state.demilitarizedZones];
  const events: WorldEvent[] = [];

  for (const clause of settlement.clauses) {
    if (clause.type === 'reparations') {
      const payer = nextSimulation.entities[settlement.opponentId];
      const receiver = nextSimulation.entities[settlement.leaderId];
      const value = clause.value ?? 8;
      if (payer && receiver) nextSimulation = { ...nextSimulation, entities: { ...nextSimulation.entities, [payer.id]: { ...payer, treasuryIndex: clamp(payer.treasuryIndex - value) }, [receiver.id]: { ...receiver, treasuryIndex: clamp(receiver.treasuryIndex + value * .75) } } };
      continue;
    }
    if (!clause.locationId) continue;
    const current = occupationFor(clause.locationId, settlement.opponentId, war.id, simulation, { ...control, occupations });
    if (clause.type === 'demilitarized') {
      if (!zones.some((item) => item.locationId === clause.locationId)) zones.push({ locationId: clause.locationId, treatyId: settlement.id, parties: [settlement.leaderId, settlement.opponentId], createdAtElapsedDay: simulation.elapsedDays });
      continue;
    }
    if (clause.type === 'plebiscite' && clause.result !== 'approved') continue;
    const beneficiary = clause.beneficiaryId;
    if (!beneficiary) continue;
    if (clause.type === 'autonomy') {
      occupations[clause.locationId] = { ...current, ownerId: settlement.opponentId, controllerId: beneficiary, warId: settlement.id, progress: 100, contested: false, updatedAt: simulation.date };
    } else {
      occupations[clause.locationId] = { ...current, ownerId: beneficiary, controllerId: beneficiary, warId: settlement.id, progress: 0, contested: false, updatedAt: simulation.date };
    }
  }

  const signed: TerritorialPeaceSettlement = { ...settlement, status: 'signed', signedAtElapsedDay: simulation.elapsedDays };
  const severity = settlement.clauses.filter((item) => item.type === 'annexation' || item.type === 'independence').length;
  nextSimulation = mutateRelation(nextSimulation, settlement.leaderId, settlement.opponentId, -6 - severity * 4, -5 - severity * 3, 'Tratado territorial pós-guerra redefiniu fronteiras e soberania.');
  events.push({ id: `territorial-peace-${war.id}-${simulation.elapsedDays}`, date: simulation.date, entityId: settlement.leaderId, category: 'diplomacy', title: 'Tratado territorial pós-guerra assinado', text: `O acordo encerrou a negociação territorial com ${settlement.clauses.length} cláusula(s), alterando soberania, controle, reparações ou restrições militares conforme a partilha acordada.` });
  nextSimulation = { ...nextSimulation, events: [...events, ...nextSimulation.events].slice(0, 50) };
  publish({ settlements: state.settlements.map((item) => item.id === settlement.id ? signed : item), demilitarizedZones: zones });
  return { accepted: true, simulation: nextSimulation, territorialControl: { ...control, occupations }, settlement: signed, message: 'Tratado assinado. As mudanças territoriais e econômicas foram aplicadas à campanha.' };
}

export function settlementsForEntity(entityId: string, warState: WarState) {
  const warIds = new Set(warState.wars.filter((war) => [war.attackerId, war.defenderId, ...war.attackers, ...war.defenders].includes(entityId)).map((war) => war.id));
  return rootState().settlements.filter((item) => warIds.has(item.warId)).map((item) => ({ ...item, clauses: item.clauses.map((clause) => ({ ...clause })) }));
}

export function demilitarizedZoneFor(locationId: string) { return rootState().demilitarizedZones.find((item) => item.locationId === locationId); }
