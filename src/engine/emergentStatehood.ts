import type { ScenarioEntity } from '../data/scenarios';
import { civilConflictState, type CivilFaction } from './civilConflict';
import { pairKey, type DiplomaticRelation, type SimulationState, type WorldEvent } from './simulation';
import type { TerritorialControlState } from './territorialControl';

export type RecognitionStatus = 'unrecognized' | 'limited' | 'recognized';
export type EmergentSettlement = 'disputed' | 'ceasefire' | 'recognized-independence' | 'successor-authority';

export type EmergentStateRecord = {
  entityId: string;
  parentEntityId: string;
  name: string;
  recognitionStatus: RecognitionStatus;
  recognizers: string[];
  recognitionScore: number;
  settlement: EmergentSettlement;
  claimedLocationIds: string[];
  foundedAtElapsedDay: number;
  lastDiplomaticReviewElapsedDay: number;
};

export type EmergentStatehoodState = { states: Record<string, EmergentStateRecord> };

type Root = typeof globalThis & { __WORLD_STATE_EMERGENT_STATEHOOD__?: EmergentStatehoodState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function hash(text: string) { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return Math.abs(h >>> 0); }
function rootState(): EmergentStatehoodState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_EMERGENT_STATEHOOD__) root.__WORLD_STATE_EMERGENT_STATEHOOD__ = { states: {} };
  return root.__WORLD_STATE_EMERGENT_STATEHOOD__;
}
function publish(state: EmergentStatehoodState) {
  (globalThis as Root).__WORLD_STATE_EMERGENT_STATEHOOD__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-emergent-statehood', { detail: state }));
}
export function resetEmergentStatehood() { publish({ states: {} }); }
export function emergentStatehoodState() { return { states: Object.fromEntries(Object.entries(rootState().states).map(([id, item]) => [id, { ...item, recognizers: [...item.recognizers], claimedLocationIds: [...item.claimedLocationIds] }])) }; }

function factionScenarioEntity(faction: CivilFaction, simulation: SimulationState, baseEntities: ScenarioEntity[]): ScenarioEntity | undefined {
  const runtime = simulation.entities[faction.id];
  const parent = baseEntities.find((item) => item.id === faction.parentEntityId);
  if (!runtime) return undefined;
  const government = faction.goal === 'regime' ? 'Autoridade política sucessora' : faction.goal === 'government' ? 'Governo rival' : faction.goal === 'independence' ? 'Autoridade emergente independente' : 'Autoridade autônoma emergente';
  return {
    id: faction.id,
    name: faction.name,
    type: faction.goal === 'independence' ? 'Entidade política emergente' : 'Autoridade política emergente',
    population: 'População sob controle em consolidação',
    treasury: 'Tesouro emergente',
    stability: runtime.stability,
    military: runtime.militaryReadiness,
    technology: runtime.technology,
    culture: parent?.culture ?? 'Identidade em consolidação',
    government,
    specialty: faction.goal === 'independence' ? 'Consolidar soberania, reconhecimento e sobrevivência diplomática' : 'Consolidar autoridade e acordo político pós-conflito',
  };
}

export function emergentScenarioEntities(simulation: SimulationState, baseEntities: ScenarioEntity[]) {
  const factions = Object.values(civilConflictState().factions).filter((item) => (item.status === 'active' || item.status === 'victorious') && simulation.entities[item.id]);
  return factions.map((item) => factionScenarioEntity(item, simulation, baseEntities)).filter((item): item is ScenarioEntity => !!item);
}

function relationForEmergent(faction: CivilFaction, otherId: string): DiplomaticRelation {
  const parent = otherId === faction.parentEntityId;
  const seed = hash(`${faction.id}:${otherId}`);
  if (parent) return { parties: [faction.id, otherId], score: 12, trust: 9, tradeInterest: 22, threat: 78, treaties: [], memory: ['Guerra civil recente e disputa de soberania'] };
  return {
    parties: [faction.id, otherId],
    score: 34 + seed % 23,
    trust: 28 + (seed >> 4) % 25,
    tradeInterest: 35 + (seed >> 8) % 38,
    threat: 18 + (seed >> 12) % 32,
    treaties: [],
    memory: ['Relação iniciada após o surgimento de uma nova autoridade política'],
  };
}

function ensureDiplomaticRelations(simulation: SimulationState, faction: CivilFaction) {
  let diplomacy = { ...simulation.diplomacy };
  let changed = false;
  for (const otherId of Object.keys(simulation.entities)) {
    if (otherId === faction.id) continue;
    const key = pairKey(faction.id, otherId);
    if (diplomacy[key]) continue;
    diplomacy[key] = relationForEmergent(faction, otherId);
    changed = true;
  }
  return changed ? { ...simulation, diplomacy } : simulation;
}

function statusFor(recognizers: number, score: number): RecognitionStatus {
  if (recognizers >= 3 || score >= 64) return 'recognized';
  if (recognizers >= 1 || score >= 28) return 'limited';
  return 'unrecognized';
}

function initialRecord(faction: CivilFaction, simulation: SimulationState): EmergentStateRecord {
  return {
    entityId: faction.id,
    parentEntityId: faction.parentEntityId,
    name: faction.name,
    recognitionStatus: 'unrecognized',
    recognizers: [],
    recognitionScore: faction.status === 'victorious' ? 18 : 4,
    settlement: faction.goal === 'regime' || faction.goal === 'government' ? 'successor-authority' : 'disputed',
    claimedLocationIds: [...faction.controlledLocationIds],
    foundedAtElapsedDay: faction.createdAtElapsedDay,
    lastDiplomaticReviewElapsedDay: simulation.elapsedDays,
  };
}

function aiRecognitionCandidates(record: EmergentStateRecord, simulation: SimulationState) {
  return Object.keys(simulation.entities).filter((id) => id !== record.entityId && id !== record.parentEntityId && id !== simulation.playerEntityId && !record.recognizers.includes(id));
}

export function processEmergentStatehood(simulation: SimulationState, territorialControl: TerritorialControlState) {
  const civil = civilConflictState();
  const state = rootState();
  let states = { ...state.states };
  let nextSimulation = simulation;
  let nextControl = territorialControl;
  let events = [...simulation.events];
  let changed = false;

  for (const faction of Object.values(civil.factions)) {
    if (faction.status !== 'victorious' || !simulation.entities[faction.id]) continue;
    nextSimulation = ensureDiplomaticRelations(nextSimulation, faction);
    const current = states[faction.id] ?? initialRecord(faction, simulation);
    let recognizers = [...current.recognizers];
    let score = current.recognitionScore;
    let lastReview = current.lastDiplomaticReviewElapsedDay;
    const days = Math.max(0, simulation.elapsedDays - lastReview);
    if (days >= 90) {
      const runtime = simulation.entities[faction.id];
      const age = simulation.elapsedDays - current.foundedAtElapsedDay;
      const candidates = aiRecognitionCandidates(current, simulation);
      for (const candidate of candidates) {
        const gate = hash(`${candidate}:${faction.id}:${Math.floor(simulation.elapsedDays / 90)}`) % 100;
        const threshold = clamp(24 + (runtime?.stability ?? 40) * .32 + Math.min(24, age / 45) + faction.support * .12);
        if (gate < threshold * .22) { recognizers.push(candidate); score += 14; break; }
      }
      score = clamp(score + Math.min(8, days / 120) + (runtime?.stability ?? 40) * .012);
      lastReview = simulation.elapsedDays;
      changed = true;
    }
    const recognitionStatus = statusFor(recognizers.length, score);
    if (!states[faction.id] || recognitionStatus !== current.recognitionStatus || recognizers.length !== current.recognizers.length) changed = true;
    states[faction.id] = { ...current, name: faction.name, claimedLocationIds: [...faction.controlledLocationIds], recognizers, recognitionScore: score, recognitionStatus, lastDiplomaticReviewElapsedDay: lastReview };
  }

  if (changed) {
    const newlyRecognized = Object.values(states).filter((item) => item.recognitionStatus === 'recognized' && state.states[item.entityId]?.recognitionStatus !== 'recognized');
    for (const item of newlyRecognized) {
      const event: WorldEvent = { id: `recognition-${item.entityId}-${simulation.elapsedDays}`, date: simulation.date, entityId: item.entityId, category: 'diplomacy', title: 'Entidade emergente obtém reconhecimento internacional relevante', text: `${item.name} acumulou reconhecimento externo suficiente para atuar de forma mais estável no sistema diplomático. A disputa com o Estado de origem, porém, só termina por acordo ou resultado político próprio.` };
      events = [event, ...events].slice(0, 50);
    }
    nextSimulation = { ...nextSimulation, events };
    publish({ states });
  }
  return { simulation: nextSimulation, territorialControl: nextControl, changed };
}

export function recognizeEmergentState(observerId: string, emergentId: string, simulation: SimulationState, territorialControl: TerritorialControlState) {
  const state = rootState();
  const record = state.states[emergentId];
  if (!record) return { simulation, territorialControl, message: 'A entidade ainda não possui um processo diplomático de reconhecimento consolidado.' };
  if (observerId === emergentId) return { simulation, territorialControl, message: 'A entidade não pode reconhecer a si própria.' };
  if (record.recognizers.includes(observerId)) return { simulation, territorialControl, message: 'Este Estado já reconheceu a entidade emergente.' };

  const recognizers = [observerId, ...record.recognizers];
  const recognitionScore = clamp(record.recognitionScore + (observerId === record.parentEntityId ? 35 : 20));
  let settlement = record.settlement;
  let nextControl = territorialControl;
  let diplomacy = { ...simulation.diplomacy };
  const key = pairKey(observerId, emergentId);
  const relation = diplomacy[key];
  if (relation) diplomacy[key] = { ...relation, score: clamp(relation.score + 24), trust: clamp(relation.trust + 18), threat: clamp(relation.threat - 20), memory: ['Reconhecimento diplomático formal concedido durante a campanha', ...relation.memory].slice(0, 8) };

  if (observerId === record.parentEntityId && record.claimedLocationIds.length) {
    settlement = 'recognized-independence';
    const occupations = { ...territorialControl.occupations };
    for (const locationId of record.claimedLocationIds) {
      const occupation = occupations[locationId];
      if (!occupation || occupation.controllerId !== emergentId) continue;
      occupations[locationId] = { ...occupation, ownerId: emergentId, controllerId: emergentId, progress: 0, contested: false, updatedAt: simulation.date };
    }
    nextControl = { ...territorialControl, occupations };
  }

  const recognitionStatus = statusFor(recognizers.length, recognitionScore);
  const nextRecord = { ...record, recognizers, recognitionScore, recognitionStatus, settlement };
  publish({ states: { ...state.states, [emergentId]: nextRecord } });
  const event: WorldEvent = { id: `recognize-${observerId}-${emergentId}-${simulation.elapsedDays}`, date: simulation.date, entityId: emergentId, category: 'diplomacy', title: observerId === record.parentEntityId ? 'Estado de origem reconhece novo arranjo político' : 'Novo reconhecimento diplomático', text: observerId === record.parentEntityId ? `${record.name} teve sua nova soberania reconhecida pela antiga autoridade central nas regiões sob seu controle.` : `${observerId} reconheceu formalmente ${record.name} como interlocutor político.` };
  return { simulation: { ...simulation, diplomacy, events: [event, ...simulation.events].slice(0, 50) }, territorialControl: nextControl, message: observerId === record.parentEntityId ? 'Reconhecimento concedido. A disputa de soberania nas regiões controladas foi encerrada.' : 'Reconhecimento diplomático concedido.' };
}

export function emergentStatesForObserver(observerId: string) {
  return Object.values(rootState().states).filter((item) => item.entityId !== observerId).map((item) => ({ ...item, recognizers: [...item.recognizers], claimedLocationIds: [...item.claimedLocationIds] }));
}
