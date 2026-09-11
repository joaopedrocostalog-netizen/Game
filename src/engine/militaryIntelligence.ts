import type { ArmyState } from './army';
import type { SimulationState, WorldEvent } from './simulation';
import type { WarState } from './war';

export type IntelligenceSource = 'scouts' | 'patrols' | 'agents' | 'signals' | 'aerial' | 'satellite';
export type IntelligenceConfidence = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
export type IntelligenceFreshness = 'current' | 'recent' | 'stale' | 'obsolete';
export type EstimateBand = 'minimal' | 'limited' | 'moderate' | 'strong' | 'overwhelming' | 'unknown';

export type FrontIntelligenceReport = {
  id: string;
  observerId: string;
  warId: string;
  frontId: string;
  enemySide: 'attackers' | 'defenders';
  source: IntelligenceSource;
  observedAtElapsedDay: number;
  confidenceScore: number;
  confidence: IntelligenceConfidence;
  freshness: IntelligenceFreshness;
  estimatedEnemyFormations: EstimateBand;
  estimatedEnemyPower: EstimateBand;
  estimatedEnemyLogistics: EstimateBand;
  surpriseRisk: 'low' | 'guarded' | 'elevated' | 'severe';
  uncertainty: number;
  possiblyDeceived: boolean;
};

export type DeceptionPosture = 'none' | 'concealment' | 'false_concentration' | 'feigned_weakness';

export type MilitaryIntelligenceState = {
  reports: FrontIntelligenceReport[];
  deception: Record<string, DeceptionPosture>;
};

type IntelligenceGlobal = typeof globalThis & { __WORLD_STATE_MILITARY_INTELLIGENCE__?: MilitaryIntelligenceState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): MilitaryIntelligenceState {
  const root = globalThis as IntelligenceGlobal;
  if (!root.__WORLD_STATE_MILITARY_INTELLIGENCE__) root.__WORLD_STATE_MILITARY_INTELLIGENCE__ = { reports: [], deception: {} };
  return root.__WORLD_STATE_MILITARY_INTELLIGENCE__;
}

function publish(state: MilitaryIntelligenceState) {
  (globalThis as IntelligenceGlobal).__WORLD_STATE_MILITARY_INTELLIGENCE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-military-intelligence', { detail: state }));
}

export function resetMilitaryIntelligence() {
  publish({ reports: [], deception: {} });
}

export function militaryIntelligenceState() {
  const state = rootState();
  return { reports: state.reports.map((item) => ({ ...item })), deception: { ...state.deception } };
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

export function availableIntelligenceSources(year: number): IntelligenceSource[] {
  if (year < 1750) return ['scouts', 'patrols', 'agents'];
  if (year < 1910) return ['scouts', 'patrols', 'agents', 'signals'];
  if (year < 1957) return ['scouts', 'patrols', 'agents', 'signals', 'aerial'];
  return ['scouts', 'patrols', 'agents', 'signals', 'aerial', 'satellite'];
}

function sourceQuality(source: IntelligenceSource, year: number) {
  const base: Record<IntelligenceSource, number> = {
    scouts: 44,
    patrols: 49,
    agents: 52,
    signals: 63,
    aerial: 72,
    satellite: 82,
  };
  const eraPenalty = year < 1700 ? 13 : year < 1900 ? 7 : year < 1945 ? 3 : 0;
  return clamp(base[source] - eraPenalty);
}

function confidenceLabel(score: number): IntelligenceConfidence {
  if (score >= 82) return 'very_high';
  if (score >= 67) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 32) return 'low';
  return 'very_low';
}

function freshnessFor(age: number, year: number): IntelligenceFreshness {
  const scale = year < 1700 ? 2.4 : year < 1900 ? 1.7 : year < 1945 ? 1.25 : 1;
  if (age <= 7 * scale) return 'current';
  if (age <= 24 * scale) return 'recent';
  if (age <= 70 * scale) return 'stale';
  return 'obsolete';
}

function estimateBand(value: number, maxReference: number): EstimateBand {
  if (!Number.isFinite(value)) return 'unknown';
  const ratio = value / Math.max(1, maxReference);
  if (ratio < .18) return 'minimal';
  if (ratio < .36) return 'limited';
  if (ratio < .58) return 'moderate';
  if (ratio < .82) return 'strong';
  return 'overwhelming';
}

function deceptionKey(warId: string, side: 'attackers' | 'defenders') {
  return `${warId}::${side}`;
}

export function setDeceptionPosture(warId: string, side: 'attackers' | 'defenders', posture: DeceptionPosture) {
  const state = rootState();
  publish({ ...state, deception: { ...state.deception, [deceptionKey(warId, side)]: posture } });
}

function deceptionBias(posture: DeceptionPosture, seed: number) {
  if (posture === 'false_concentration') return 1.18 + (seed % 9) / 100;
  if (posture === 'feigned_weakness') return .72 + (seed % 12) / 100;
  if (posture === 'concealment') return .86 + (seed % 8) / 100;
  return 1;
}

function enemyMetrics(warId: string, frontId: string, observerId: string, armyState: ArmyState, warState: WarState) {
  const war = warState.wars.find((item) => item.id === warId);
  const front = war?.fronts.find((item) => item.id === frontId);
  if (!war || !front) return undefined;
  const observerOnAttack = war.attackers.includes(observerId);
  const enemyIds = observerOnAttack ? war.defenders : war.attackers;
  const enemySide: 'attackers' | 'defenders' = observerOnAttack ? 'defenders' : 'attackers';
  const assignedIds = new Set(enemySide === 'attackers' ? front.attackerAssignments : front.defenderAssignments);
  const allEnemyUnits = armyState.units.filter((unit) => enemyIds.includes(unit.entityId));
  const assigned = allEnemyUnits.filter((unit) => assignedIds.has(unit.id));
  const units = assigned.length ? assigned : allEnemyUnits;
  const formations = units.length;
  const power = units.reduce((sum, unit) => sum + unit.strength * .28 + unit.organization * .24 + unit.morale * .16 + unit.supply * .14 + unit.equipment * .18, 0);
  const logistics = units.length ? units.reduce((sum, unit) => sum + unit.supply, 0) / units.length : 0;
  return { enemySide, formations, power, logistics, front };
}

export function conductFrontReconnaissance(
  observerId: string,
  warId: string,
  frontId: string,
  source: IntelligenceSource,
  simulation: SimulationState,
  armyState: ArmyState,
  warState: WarState,
) {
  if (!availableIntelligenceSources(simulation.date.year).includes(source)) return { accepted: false, simulation, message: 'Esse meio de reconhecimento não é adequado à época.' };
  const metrics = enemyMetrics(warId, frontId, observerId, armyState, warState);
  if (!metrics) return { accepted: false, simulation, message: 'Frente indisponível para reconhecimento.' };
  const observer = simulation.entities[observerId];
  if (!observer) return { accepted: false, simulation, message: 'Capacidade de inteligência indisponível.' };

  const seed = hash(`${observerId}:${warId}:${frontId}:${source}:${simulation.elapsedDays}`);
  const technologyBonus = observer.technology * .18;
  const treasuryBonus = observer.treasuryIndex * .07;
  const baseConfidence = clamp(sourceQuality(source, simulation.date.year) + technologyBonus + treasuryBonus - 12);
  const deception = rootState().deception[deceptionKey(warId, metrics.enemySide)] ?? 'none';
  const bias = deceptionBias(deception, seed);
  const deceptionPenalty = deception === 'none' ? 0 : deception === 'concealment' ? 10 : 15;
  const confidenceScore = clamp(baseConfidence - deceptionPenalty + ((seed >> 5) % 11) - 5);
  const uncertainty = clamp(100 - confidenceScore + (simulation.date.year < 1700 ? 12 : simulation.date.year < 1900 ? 6 : 0));
  const noise = 1 + ((((seed >> 9) % 200) / 100) - 1) * (uncertainty / 100) * .55;
  const estimatedFormations = metrics.formations * bias * noise;
  const estimatedPower = metrics.power * bias * noise;
  const estimatedLogistics = metrics.logistics * (deception === 'feigned_weakness' ? .88 : 1) * noise;
  const ownUnits = armyState.units.filter((unit) => unit.entityId === observerId);
  const ownPower = ownUnits.reduce((sum, unit) => sum + unit.strength + unit.organization + unit.morale, 0) || 100;
  const surpriseScore = clamp(uncertainty * .58 + Math.max(0, estimatedPower - ownPower) * .015 + (deception !== 'none' ? 12 : 0));
  const surpriseRisk = surpriseScore >= 72 ? 'severe' : surpriseScore >= 52 ? 'elevated' : surpriseScore >= 32 ? 'guarded' : 'low';

  const maxFormations = Math.max(4, armyState.units.length * .32);
  const maxPower = Math.max(260, armyState.units.reduce((sum, unit) => sum + unit.strength + unit.organization, 0) * .42);
  const report: FrontIntelligenceReport = {
    id: `intel-${observerId}-${warId}-${frontId}-${simulation.elapsedDays}`,
    observerId,
    warId,
    frontId,
    enemySide: metrics.enemySide,
    source,
    observedAtElapsedDay: simulation.elapsedDays,
    confidenceScore,
    confidence: confidenceLabel(confidenceScore),
    freshness: 'current',
    estimatedEnemyFormations: estimateBand(estimatedFormations, maxFormations),
    estimatedEnemyPower: estimateBand(estimatedPower, maxPower),
    estimatedEnemyLogistics: estimateBand(estimatedLogistics, 100),
    surpriseRisk,
    uncertainty,
    possiblyDeceived: deception !== 'none' && confidenceScore < 72,
  };
  const state = rootState();
  const reports = [report, ...state.reports.filter((item) => !(item.observerId === observerId && item.warId === warId && item.frontId === frontId))].slice(0, 120);
  publish({ ...state, reports });
  const event: WorldEvent = {
    id: `intel-event-${report.id}`,
    date: simulation.date,
    entityId: observerId,
    category: 'military',
    title: 'Novo relatório de inteligência militar',
    text: `O reconhecimento da ${metrics.front.name} foi atualizado com confiança ${report.confidence.replace('_', ' ')}.`,
  };
  return { accepted: true, report, simulation: { ...simulation, events: [event, ...simulation.events].slice(0, 50) }, message: 'Relatório de inteligência atualizado.' };
}

export function latestFrontIntelligence(observerId: string, warId: string, frontId: string, simulation: SimulationState) {
  const report = rootState().reports.find((item) => item.observerId === observerId && item.warId === warId && item.frontId === frontId);
  if (!report) return undefined;
  const age = Math.max(0, simulation.elapsedDays - report.observedAtElapsedDay);
  const freshness = freshnessFor(age, simulation.date.year);
  const decay = freshness === 'current' ? 0 : freshness === 'recent' ? 8 : freshness === 'stale' ? 22 : 40;
  const confidenceScore = clamp(report.confidenceScore - decay);
  return {
    ...report,
    freshness,
    confidenceScore,
    confidence: confidenceLabel(confidenceScore),
    uncertainty: clamp(report.uncertainty + decay),
    surpriseRisk: freshness === 'obsolete' ? 'severe' as const : freshness === 'stale' && report.surpriseRisk === 'low' ? 'guarded' as const : report.surpriseRisk,
  };
}

export function intelligenceRiskModifier(observerId: string, warId: string, frontId: string, simulation: SimulationState) {
  const report = latestFrontIntelligence(observerId, warId, frontId, simulation);
  if (!report) return 18;
  const freshnessPenalty = report.freshness === 'current' ? 0 : report.freshness === 'recent' ? 4 : report.freshness === 'stale' ? 11 : 22;
  return clamp((report.uncertainty - 35) * .35 + freshnessPenalty, -8, 28);
}
