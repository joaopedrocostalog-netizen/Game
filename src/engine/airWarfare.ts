import { militaryIndustryFor } from './militaryIndustry';
import { airIndustrialSupport } from './airIndustry';
import { airDoctrineMissionModifier, airDoctrineSupport } from './airDoctrine';
import { airOperationalReach, processAirBaseNetwork } from './airBaseNetwork';
import {
  airBaseDefenseModifier,
  airDetectionCombatModifier,
  processAirDefenseNetwork,
} from './airDefenseNetwork';
import { airCampaignState, type AirCampaignState, type AirFormation } from './airCampaign';
import type { SimulationState } from './simulation';
import type { War, WarState } from './war';

export type AirEngagementOutcome = 'decisive' | 'advantage' | 'inconclusive';
export type AirBaseCondition = 'operational' | 'strained' | 'damaged' | 'critical';

export type AirEngagement = {
  id: string;
  warId: string;
  occurredAtElapsedDay: number;
  attackers: string[];
  defenders: string[];
  attackerLosses: number;
  defenderLosses: number;
  outcome: AirEngagementOutcome;
  winnerSide?: 'attackers' | 'defenders';
};

export type AirBaseStatus = {
  entityId: string;
  locationId: string;
  damage: number;
  airDefense: number;
  condition: AirBaseCondition;
};

export type AirWarfareState = {
  engagements: AirEngagement[];
  bases: Record<string, AirBaseStatus>;
  lastEngagementByWar: Record<string, number>;
};

type AirWarfareGlobal = typeof globalThis & {
  __WORLD_STATE_AIR_WARFARE__?: AirWarfareState;
  __WORLD_STATE_AIR_CAMPAIGN__?: AirCampaignState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): AirWarfareState {
  const root = globalThis as AirWarfareGlobal;
  if (!root.__WORLD_STATE_AIR_WARFARE__) root.__WORLD_STATE_AIR_WARFARE__ = { engagements: [], bases: {}, lastEngagementByWar: {} };
  return root.__WORLD_STATE_AIR_WARFARE__;
}
function publish(state: AirWarfareState) {
  (globalThis as AirWarfareGlobal).__WORLD_STATE_AIR_WARFARE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-warfare', { detail: state }));
}
function publishCampaign(state: AirCampaignState) {
  (globalThis as AirWarfareGlobal).__WORLD_STATE_AIR_CAMPAIGN__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-air-campaign', { detail: state }));
}
export function resetAirWarfare() { publish({ engagements: [], bases: {}, lastEngagementByWar: {} }); }
export function airWarfareState() {
  const state = rootState();
  return {
    engagements: state.engagements.map((item) => ({ ...item, attackers: [...item.attackers], defenders: [...item.defenders] })),
    bases: Object.fromEntries(Object.entries(state.bases).map(([id, base]) => [id, { ...base }])),
    lastEngagementByWar: { ...state.lastEngagementByWar },
  };
}

function deterministic(seed: string) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return .9 + (Math.abs(h >>> 0) % 21) / 100;
}
function operationalFactor(formation: AirFormation, war: War, simulation: SimulationState) {
  if (!war.fronts.length) return 1;
  let best = 0;
  for (const front of war.fronts) {
    if (!front.locationId) {
      best = Math.max(best, 1);
      continue;
    }
    const reach = airOperationalReach(formation, front.locationId, simulation);
    if (reach.reachable) best = Math.max(best, reach.factor);
  }
  return best;
}
function combatFactor(formation: AirFormation, simulation: SimulationState, reachFactor = 1, detectionFactor = 1) {
  const mission = formation.mission === 'air-superiority' ? 1.18
    : formation.mission === 'reconnaissance' ? .78
      : formation.mission === 'ground-support' ? .92
        : formation.mission === 'interdiction' ? .96
          : formation.mission === 'maritime-patrol' ? .82
            : formation.mission === 'air-transport' ? .28
              : .35;
  const specialized = airIndustrialSupport(formation.entityId, simulation);
  const doctrine = airDoctrineSupport(formation.entityId, simulation);
  const modernization = .78 + specialized.effectiveness / 420 - specialized.obsolescence / 500;
  const pilotQuality = .9 + specialized.pilotTraining / 600;
  const doctrinalFit = airDoctrineMissionModifier(formation.entityId, formation.mission, simulation);
  const coordination = .9 + doctrine.combatCoordination / 650;
  return formation.strength * formation.readiness / 100 * formation.supply / 100 * (0.76 + formation.experience / 230) * mission * modernization * pilotQuality * doctrinalFit * coordination * reachFactor * detectionFactor;
}
function airDefenseFor(entityId: string, simulation: SimulationState) {
  const runtime = simulation.entities[entityId];
  if (!runtime || simulation.date.year < 1914) return simulation.date.year < 1903 ? 2 : 8;
  const era = simulation.date.year < 1945 ? .72 : simulation.date.year < 1990 ? .9 : 1;
  const doctrine = airDoctrineSupport(entityId, simulation);
  const doctrineBonus = doctrine.school === 'air-defense' ? doctrine.mastery * .12 : doctrine.school === 'air-superiority' ? doctrine.mastery * .05 : 0;
  return clamp((runtime.technology * .48 + runtime.militaryReadiness * .32 + runtime.treasuryIndex * .2 + doctrineBonus) * era);
}
function baseCondition(damage: number): AirBaseCondition {
  if (damage >= 76) return 'critical';
  if (damage >= 50) return 'damaged';
  if (damage >= 24) return 'strained';
  return 'operational';
}
function ensureBases(formations: AirFormation[], simulation: SimulationState, existing: Record<string, AirBaseStatus>) {
  const bases = { ...existing };
  for (const formation of formations) {
    const key = `${formation.entityId}:${formation.baseLocationId}`;
    if (!bases[key]) bases[key] = { entityId: formation.entityId, locationId: formation.baseLocationId, damage: 0, airDefense: airDefenseFor(formation.entityId, simulation), condition: 'operational' };
    else bases[key] = { ...bases[key], airDefense: airDefenseFor(formation.entityId, simulation), condition: baseCondition(bases[key].damage) };
  }
  return bases;
}
function activeFormations(formations: AirFormation[], ids: Set<string>, war: War, simulation: SimulationState) {
  return formations.filter((item) => {
    if (!ids.has(item.entityId) || item.mission === 'reserve' || item.mission === 'air-transport' || item.strength <= 3 || item.readiness <= 8) return false;
    return operationalFactor(item, war, simulation) > 0;
  });
}
function distributeLosses(formations: AirFormation[], participants: AirFormation[], losses: number, defensePressure: number, simulation: SimulationState) {
  if (!participants.length || losses <= 0) return formations;
  const total = Math.max(1, participants.reduce((sum, item) => sum + item.strength, 0));
  return formations.map((formation) => {
    const participant = participants.find((item) => item.id === formation.id);
    if (!participant) return formation;
    const share = losses * participant.strength / total;
    const doctrine = airDoctrineSupport(formation.entityId, simulation);
    const cohesion = 1 - Math.min(.18, doctrine.mastery / 700 + doctrine.flexibility / 1200);
    return {
      ...formation,
      strength: clamp(formation.strength - share),
      readiness: clamp(formation.readiness - (share * .85 + defensePressure * .025) * cohesion),
      supply: clamp(formation.supply - share * .35),
      experience: clamp(formation.experience + Math.max(.3, share * .08)),
    };
  });
}

export function processAirWarfare(simulation: SimulationState, warState: WarState) {
  processAirBaseNetwork(simulation);
  processAirDefenseNetwork(simulation, warState);
  const warfare = rootState();
  const campaign = airCampaignState();
  if (!campaign.formations.length) return { changed: false };
  let formations = campaign.formations.map((item) => ({ ...item }));
  let bases = ensureBases(formations, simulation, warfare.bases);
  let engagements = [...warfare.engagements];
  const lastEngagementByWar = { ...warfare.lastEngagementByWar };
  let changed = false;

  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    const last = lastEngagementByWar[war.id] ?? -9999;
    if (simulation.elapsedDays - last < 10) continue;
    const attackers = activeFormations(formations, new Set(war.attackers), war, simulation);
    const defenders = activeFormations(formations, new Set(war.defenders), war, simulation);
    if (!attackers.length || !defenders.length) continue;

    const attackerEnemy = defenders[0].entityId;
    const defenderEnemy = attackers[0].entityId;
    const attackerDefense = defenders.reduce((sum, item) => sum + Math.max(airDefenseFor(item.entityId, simulation), airBaseDefenseModifier(item.entityId, defenderEnemy, simulation)), 0) / defenders.length;
    const defenderDefense = attackers.reduce((sum, item) => sum + Math.max(airDefenseFor(item.entityId, simulation), airBaseDefenseModifier(item.entityId, attackerEnemy, simulation)), 0) / attackers.length;
    const attackPower = attackers.reduce((sum, item) => sum + combatFactor(
      item,
      simulation,
      operationalFactor(item, war, simulation),
      airDetectionCombatModifier(item.entityId, attackerEnemy, simulation),
    ), 0) * deterministic(`${war.id}:air:a:${simulation.elapsedDays}`);
    const defendPower = defenders.reduce((sum, item) => sum + combatFactor(
      item,
      simulation,
      operationalFactor(item, war, simulation),
      airDetectionCombatModifier(item.entityId, defenderEnemy, simulation),
    ), 0) * deterministic(`${war.id}:air:d:${simulation.elapsedDays}`);
    const total = Math.max(1, attackPower + defendPower);
    const shareA = attackPower / total;
    const attackerLosses = clamp((.7 + (1 - shareA) * 3.3 + attackerDefense * .012) * deterministic(`${war.id}:loss:a:${simulation.elapsedDays}`), .4, 8);
    const defenderLosses = clamp((.7 + shareA * 3.3 + defenderDefense * .012) * deterministic(`${war.id}:loss:d:${simulation.elapsedDays}`), .4, 8);
    formations = distributeLosses(formations, attackers, attackerLosses, attackerDefense, simulation);
    formations = distributeLosses(formations, defenders, defenderLosses, defenderDefense, simulation);

    const gap = Math.abs(attackPower - defendPower) / Math.max(attackPower, defendPower, 1);
    const outcome: AirEngagementOutcome = gap > .42 ? 'decisive' : gap > .18 ? 'advantage' : 'inconclusive';
    const winnerSide = gap > .1 ? (attackPower > defendPower ? 'attackers' as const : 'defenders' as const) : undefined;
    engagements = [{
      id: `air-engagement-${war.id}-${simulation.elapsedDays}`,
      warId: war.id,
      occurredAtElapsedDay: simulation.elapsedDays,
      attackers: [...new Set(attackers.map((item) => item.entityId))],
      defenders: [...new Set(defenders.map((item) => item.entityId))],
      attackerLosses,
      defenderLosses,
      outcome,
      winnerSide,
    }, ...engagements].slice(0, 100);
    lastEngagementByWar[war.id] = simulation.elapsedDays;
    changed = true;

    const interdictingAttackers = attackers.filter((item) => item.mission === 'interdiction');
    const interdictingDefenders = defenders.filter((item) => item.mission === 'interdiction');
    for (const formation of [...interdictingAttackers, ...interdictingDefenders]) {
      const enemyIds = interdictingAttackers.includes(formation) ? new Set(war.defenders) : new Set(war.attackers);
      const enemyBases = formations.filter((item) => enemyIds.has(item.entityId));
      if (!enemyBases.length) continue;
      const target = enemyBases[Math.abs(formation.id.length + simulation.elapsedDays) % enemyBases.length];
      const key = `${target.entityId}:${target.baseLocationId}`;
      const base = bases[key];
      if (!base) continue;
      const integratedDefense = Math.max(base.airDefense, airBaseDefenseModifier(target.entityId, formation.entityId, simulation));
      const attackDetection = airDetectionCombatModifier(formation.entityId, target.entityId, simulation);
      const pressure = combatFactor(formation, simulation, operationalFactor(formation, war, simulation), attackDetection) * .055 * (1 - integratedDefense / 160);
      bases[key] = { ...base, damage: clamp(base.damage + pressure), condition: baseCondition(clamp(base.damage + pressure)) };
    }
  }

  for (const formation of formations) {
    const industry = militaryIndustryFor(formation.entityId, simulation);
    const specialized = airIndustrialSupport(formation.entityId, simulation);
    const doctrine = airDoctrineSupport(formation.entityId, simulation);
    const key = `${formation.entityId}:${formation.baseLocationId}`;
    const base = bases[key];
    const damagePenalty = base ? 1 - base.damage / 135 : 1;
    const replacement = simulation.date.year < 1903
      ? .01
      : (industry.armamentsCapacity * .00035 + industry.replacementEfficiency * .00028 + specialized.production * .00062 + specialized.maintenance * .00034) * damagePenalty * (.72 + specialized.modernization / 260) * (.9 + doctrine.flexibility / 900);
    const repair = simulation.date.year < 1903 ? .008 : (industry.supplyCapacity * .00035 + specialized.maintenance * .00055);
    formation.strength = clamp(formation.strength + replacement);
    formation.readiness = clamp(formation.readiness + specialized.maintenance * .00012 + doctrine.mastery * .000025);
    formation.experience = clamp(formation.experience + specialized.pilotTraining * .00005 + doctrine.mastery * .000018);
    if (base && base.damage > 0) {
      const nextDamage = clamp(base.damage - repair);
      bases[key] = { ...base, damage: nextDamage, condition: baseCondition(nextDamage) };
    }
  }

  if (changed || Object.keys(bases).length !== Object.keys(warfare.bases).length) {
    publishCampaign({ ...campaign, formations });
    publish({ engagements, bases, lastEngagementByWar });
  }
  return { changed };
}

export function airBaseStatus(entityId: string, locationId: string) {
  const base = rootState().bases[`${entityId}:${locationId}`];
  return base ? { ...base } : undefined;
}
