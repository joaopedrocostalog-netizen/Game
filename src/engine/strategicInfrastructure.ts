import { locationsForEntity, locationsForYear } from '../data/territories';
import type { ArmyState } from './army';
import { airCampaignState, type AirFormation } from './airCampaign';
import { airOperationalReach } from './airBaseNetwork';
import { airBaseDefenseModifier } from './airDefenseNetwork';
import type { MilitaryIndustryState } from './militaryIndustry';
import type { SimulationState } from './simulation';
import type { War, WarState } from './war';

export type StrategicInfrastructureType = 'industry' | 'transport' | 'energy' | 'depot' | 'port' | 'command' | 'communications';
export type InfrastructureCondition = 'operational' | 'strained' | 'damaged' | 'critical';

export type StrategicInfrastructureNode = {
  id: string;
  entityId: string;
  locationId: string;
  type: StrategicInfrastructureType;
  integrity: number;
  capacity: number;
  importance: number;
  repairRate: number;
  condition: InfrastructureCondition;
  lastProcessedElapsedDay: number;
};

export type StrategicInfrastructureStrike = {
  id: string;
  warId: string;
  attackerId: string;
  defenderId: string;
  locationId: string;
  type: StrategicInfrastructureType;
  occurredAtElapsedDay: number;
  severity: 'limited' | 'significant' | 'heavy';
  estimatedDamage: number;
};

export type StrategicInfrastructureState = {
  nodes: Record<string, StrategicInfrastructureNode>;
  strikes: StrategicInfrastructureStrike[];
  lastStrikeByWar: Record<string, number>;
};

type Root = typeof globalThis & {
  __WORLD_STATE_STRATEGIC_INFRASTRUCTURE__?: StrategicInfrastructureState;
  __WORLD_STATE_MILITARY_INDUSTRY__?: MilitaryIndustryState;
};

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function hash(text: string) { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return Math.abs(h >>> 0); }
function rootState(): StrategicInfrastructureState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__) root.__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__ = { nodes: {}, strikes: [], lastStrikeByWar: {} };
  return root.__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__;
}
function publish(state: StrategicInfrastructureState) {
  (globalThis as Root).__WORLD_STATE_STRATEGIC_INFRASTRUCTURE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-strategic-infrastructure', { detail: state }));
}
export function resetStrategicInfrastructure() { publish({ nodes: {}, strikes: [], lastStrikeByWar: {} }); }
export function strategicInfrastructureState() {
  const state = rootState();
  return { nodes: Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => [id, { ...node }])), strikes: state.strikes.map((strike) => ({ ...strike })), lastStrikeByWar: { ...state.lastStrikeByWar } };
}

export function strategicInfrastructureEraLabel(year: number) {
  if (year < 1700) return 'Infraestrutura de arsenais, estradas, portos e depósitos';
  if (year < 1850) return 'Rede de manufaturas, estradas, portos e depósitos';
  if (year < 1914) return 'Infraestrutura industrial, ferroviária e portuária';
  if (year < 1945) return 'Infraestrutura industrial e logística de guerra';
  return 'Infraestrutura crítica e base econômico-logística';
}
export function strategicInfrastructureTypeLabel(type: StrategicInfrastructureType, year: number) {
  if (type === 'industry') return year < 1850 ? 'Arsenais e manufaturas' : 'Complexo industrial';
  if (type === 'transport') return year < 1850 ? 'Estradas e eixos logísticos' : 'Ferrovias e corredores logísticos';
  if (type === 'energy') return year < 1850 ? 'Capacidade motriz e abastecimento' : 'Energia e utilidades';
  if (type === 'depot') return 'Depósitos e centros de suprimento';
  if (type === 'port') return 'Portos e instalações marítimas';
  if (type === 'command') return year < 1914 ? 'Sedes e centros administrativos' : 'Centros de comando';
  return year < 1914 ? 'Correios e comunicações' : 'Rede de comunicações';
}
function condition(integrity: number): InfrastructureCondition {
  if (integrity < 25) return 'critical';
  if (integrity < 50) return 'damaged';
  if (integrity < 75) return 'strained';
  return 'operational';
}
function typesForLocation(kind: string, year: number): StrategicInfrastructureType[] {
  const base: StrategicInfrastructureType[] = ['transport', 'depot', 'communications'];
  if (kind === 'capital' || kind === 'city') base.push('industry', 'command');
  if (kind === 'port') base.push('port');
  if (year >= 1850 && (kind === 'capital' || kind === 'city')) base.push('energy');
  return [...new Set(base)];
}
function ensureNodes(simulation: SimulationState, existing: Record<string, StrategicInfrastructureNode>) {
  const nodes = { ...existing };
  for (const entityId of Object.keys(simulation.entities)) {
    const runtime = simulation.entities[entityId];
    for (const location of locationsForEntity(entityId, simulation.date.year)) {
      for (const type of typesForLocation(location.kind, simulation.date.year)) {
        const id = `${entityId}:${location.id}:${type}`;
        const previous = nodes[id];
        const seed = hash(id);
        const tech = runtime?.technology ?? 35;
        const economy = runtime?.economyIndex ?? 40;
        const treasury = runtime?.treasuryIndex ?? 40;
        const terrain = location.terrain === 'plains' || location.terrain === 'coastal' ? 5 : location.terrain === 'mountains' ? -7 : 0;
        const capacity = clamp(34 + economy * .38 + tech * .28 + terrain + (seed % 9));
        const importance = clamp(34 + (location.kind === 'capital' ? 26 : location.kind === 'city' ? 15 : location.kind === 'port' ? 18 : 7) + economy * .18 + (seed % 8));
        const repairRate = clamp(20 + treasury * .35 + tech * .28);
        nodes[id] = previous ? { ...previous, capacity, importance, repairRate, condition: condition(previous.integrity) } : {
          id, entityId, locationId: location.id, type, integrity: 100, capacity, importance, repairRate, condition: 'operational', lastProcessedElapsedDay: simulation.elapsedDays,
        };
      }
    }
  }
  return nodes;
}
function activeInterdictors(entityIds: Set<string>, formations: AirFormation[]) {
  return formations.filter((formation) => entityIds.has(formation.entityId) && formation.mission === 'interdiction' && formation.strength > 5 && formation.readiness > 12 && formation.supply > 15);
}
function chooseTarget(nodes: StrategicInfrastructureNode[], formation: AirFormation, simulation: SimulationState) {
  const reachable = nodes.filter((node) => airOperationalReach(formation, node.locationId, simulation).reachable && node.integrity > 8);
  if (!reachable.length) return undefined;
  return reachable.map((node) => ({ node, score: node.importance * .62 + node.capacity * .28 + (hash(`${formation.id}:${node.id}:${Math.floor(simulation.elapsedDays / 7)}`) % 12) }))
    .sort((a, b) => b.score - a.score)[0]?.node;
}
function strikePower(formation: AirFormation, target: StrategicInfrastructureNode, defenderId: string, simulation: SimulationState) {
  const reach = airOperationalReach(formation, target.locationId, simulation);
  const defense = airBaseDefenseModifier(defenderId, formation.entityId, simulation);
  const raw = formation.strength * .24 + formation.readiness * .2 + formation.supply * .12 + formation.experience * .08;
  return clamp(raw * Math.max(.35, reach.factor) * (1 - defense / 155) / 18, .35, 10);
}
function applyIndustryConsequences(entityId: string, industrialIntegrity: number, logisticsIntegrity: number) {
  const root = globalThis as Root;
  const industry = root.__WORLD_STATE_MILITARY_INDUSTRY__;
  const profile = industry?.profiles?.[entityId];
  if (!industry || !profile) return;
  const industrialPenalty = Math.max(0, 55 - industrialIntegrity) / 220;
  const logisticsPenalty = Math.max(0, 55 - logisticsIntegrity) / 250;
  if (industrialPenalty <= 0 && logisticsPenalty <= 0) return;
  root.__WORLD_STATE_MILITARY_INDUSTRY__ = {
    ...industry,
    profiles: {
      ...industry.profiles,
      [entityId]: {
        ...profile,
        armamentsStockpile: clamp(profile.armamentsStockpile - industrialPenalty * 1.4),
        supplyStockpile: clamp(profile.supplyStockpile - logisticsPenalty * 1.6),
        replacementEfficiency: clamp(profile.replacementEfficiency - industrialPenalty * .7 - logisticsPenalty * .45),
      },
    },
  };
}
function averageIntegrity(nodes: StrategicInfrastructureNode[], types: StrategicInfrastructureType[]) {
  const relevant = nodes.filter((node) => types.includes(node.type));
  if (!relevant.length) return 100;
  return relevant.reduce((sum, node) => sum + node.integrity, 0) / relevant.length;
}

export function strategicInfrastructureEffects(entityId: string) {
  const nodes = Object.values(rootState().nodes).filter((node) => node.entityId === entityId);
  const industry = averageIntegrity(nodes, ['industry', 'energy']);
  const logistics = averageIntegrity(nodes, ['transport', 'depot', 'port']);
  const command = averageIntegrity(nodes, ['command', 'communications']);
  return {
    industryIntegrity: industry,
    logisticsIntegrity: logistics,
    commandIntegrity: command,
    industrialModifier: clamp(45 + industry * .55, 45, 100) / 100,
    logisticsModifier: clamp(40 + logistics * .6, 40, 100) / 100,
    commandModifier: clamp(55 + command * .45, 55, 100) / 100,
  };
}

export function processStrategicInfrastructure(simulation: SimulationState, warState: WarState, armyState: ArmyState) {
  const state = rootState();
  let nodes = ensureNodes(simulation, state.nodes);
  let strikes = [...state.strikes];
  const lastStrikeByWar = { ...state.lastStrikeByWar };
  const campaign = airCampaignState();
  let changed = false;

  for (const [id, node] of Object.entries(nodes)) {
    const days = Math.max(0, simulation.elapsedDays - node.lastProcessedElapsedDay);
    if (!days) continue;
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(node.entityId) || war.defenders.includes(node.entityId)));
    const repair = days * node.repairRate * (atWar ? .0016 : .0032);
    if (node.integrity < 100 && repair > 0) {
      const integrity = clamp(node.integrity + repair);
      nodes[id] = { ...node, integrity, condition: condition(integrity), lastProcessedElapsedDay: simulation.elapsedDays };
      changed = true;
    } else nodes[id] = { ...node, lastProcessedElapsedDay: simulation.elapsedDays };
  }

  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    const last = lastStrikeByWar[war.id] ?? -9999;
    if (simulation.elapsedDays - last < 12) continue;
    const sides: Array<[Set<string>, Set<string>]> = [[new Set(war.attackers), new Set(war.defenders)], [new Set(war.defenders), new Set(war.attackers)]];
    let anyStrike = false;
    for (const [attackers, defenders] of sides) {
      for (const formation of activeInterdictors(attackers, campaign.formations)) {
        const defenderNodes = Object.values(nodes).filter((node) => defenders.has(node.entityId));
        const target = chooseTarget(defenderNodes, formation, simulation);
        if (!target) continue;
        const damage = strikePower(formation, target, target.entityId, simulation);
        const nextIntegrity = clamp(target.integrity - damage);
        nodes[target.id] = { ...target, integrity: nextIntegrity, condition: condition(nextIntegrity), lastProcessedElapsedDay: simulation.elapsedDays };
        const severity: StrategicInfrastructureStrike['severity'] = damage >= 6 ? 'heavy' : damage >= 3 ? 'significant' : 'limited';
        strikes = [{ id: `infra-strike-${war.id}-${formation.id}-${target.id}-${simulation.elapsedDays}`, warId: war.id, attackerId: formation.entityId, defenderId: target.entityId, locationId: target.locationId, type: target.type, occurredAtElapsedDay: simulation.elapsedDays, severity, estimatedDamage: damage }, ...strikes].slice(0, 120);
        anyStrike = true;
        changed = true;
      }
    }
    if (anyStrike) lastStrikeByWar[war.id] = simulation.elapsedDays;
  }

  let nextArmy: ArmyState = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  for (const entityId of Object.keys(simulation.entities)) {
    const entityNodes = Object.values(nodes).filter((node) => node.entityId === entityId);
    const industrialIntegrity = averageIntegrity(entityNodes, ['industry', 'energy']);
    const logisticsIntegrity = averageIntegrity(entityNodes, ['transport', 'depot', 'port']);
    const commandIntegrity = averageIntegrity(entityNodes, ['command', 'communications']);
    applyIndustryConsequences(entityId, industrialIntegrity, logisticsIntegrity);
    const logisticsPenalty = Math.max(0, 60 - logisticsIntegrity) / 100;
    const commandPenalty = Math.max(0, 55 - commandIntegrity) / 100;
    if (logisticsPenalty > 0 || commandPenalty > 0) {
      nextArmy = { ...nextArmy, units: nextArmy.units.map((unit) => unit.entityId !== entityId ? unit : {
        ...unit,
        supply: clamp(unit.supply - logisticsPenalty * .7),
        organization: clamp(unit.organization - logisticsPenalty * .3 - commandPenalty * .35),
      }) };
    }
  }

  if (changed || Object.keys(nodes).length !== Object.keys(state.nodes).length) publish({ nodes, strikes, lastStrikeByWar });
  return { armyState: nextArmy, changed };
}

export function strategicInfrastructureForEntity(entityId: string, simulation: SimulationState) {
  const nodes = ensureNodes(simulation, rootState().nodes);
  return Object.values(nodes).filter((node) => node.entityId === entityId).map((node) => ({ ...node }));
}
export function recentStrategicInfrastructureStrikes(entityId: string) {
  return rootState().strikes.filter((strike) => strike.attackerId === entityId || strike.defenderId === entityId).map((strike) => ({ ...strike }));
}
