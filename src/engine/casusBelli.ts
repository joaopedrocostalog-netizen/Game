import { locationsForEntity, type ResolvedLocation } from '../data/territories';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState, WorldEvent } from './simulation';
import { activeTruceBetween, claimsForEntity } from './peace';
import type { WarGoal } from './war';

export type CasusBelliType = 'territorial_claim' | 'border_dispute' | 'retaliation' | 'trade_dispute' | 'independence' | 'prestige' | 'unjustified';

export type CasusBelliOption = {
  id: string;
  type: CasusBelliType;
  label: string;
  description: string;
  legitimacy: number;
  stabilityCost: number;
  diplomaticCost: number;
  preparationDays: number;
  allowedGoals: WarGoal[];
  available: boolean;
  reason: string;
  claimLocationIds?: string[];
};

export type WarPreparation = {
  id: string;
  attackerId: string;
  targetId: string;
  casusBelliType: CasusBelliType;
  startedAtElapsedDay: number;
  readyAtElapsedDay: number;
  legitimacy: number;
};

type PreparationGlobal = typeof globalThis & { __WORLD_STATE_WAR_PREPARATIONS__?: WarPreparation[] };

function rootState() {
  const root = globalThis as PreparationGlobal;
  if (!root.__WORLD_STATE_WAR_PREPARATIONS__) root.__WORLD_STATE_WAR_PREPARATIONS__ = [];
  return root.__WORLD_STATE_WAR_PREPARATIONS__;
}

function publish(preparations: WarPreparation[]) {
  const root = globalThis as PreparationGlobal;
  root.__WORLD_STATE_WAR_PREPARATIONS__ = preparations;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-war-preparation', { detail: preparations }));
}

export function resetWarPreparations() {
  publish([]);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function distanceKm(a?: ResolvedLocation, b?: ResolvedLocation) {
  if (!a || !b) return 9999;
  const radius = 6371;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function relationBetween(simulation: SimulationState, a: string, b: string) {
  return Object.values(simulation.diplomacy).find((relation) => relation.parties.includes(a) && relation.parties.includes(b));
}

function hasNearBorder(attackerId: string, targetId: string, year: number) {
  const a = locationsForEntity(attackerId, year);
  const b = locationsForEntity(targetId, year);
  return a.some((left) => b.some((right) => distanceKm(left, right) <= 700));
}

function preparationScale(year: number) {
  if (year < 1650) return 1.45;
  if (year < 1850) return 1.25;
  if (year < 1945) return 1.05;
  return 0.9;
}

function days(base: number, year: number) {
  return Math.max(7, Math.round(base * preparationScale(year)));
}

export function casusBelliOptions(attacker: ScenarioEntity, target: ScenarioEntity, simulation: SimulationState): CasusBelliOption[] {
  const relation = relationBetween(simulation, attacker.id, target.id);
  const claims = claimsForEntity(attacker.id).filter((claim) => claim.holderId === target.id && claim.active);
  const border = hasNearBorder(attacker.id, target.id, simulation.date.year);
  const retaliation = (relation?.threat ?? 0) >= 58 || (relation?.score ?? 0) <= -48 || (relation?.trust ?? 50) <= 24;
  const tradeDispute = (relation?.tradeInterest ?? 0) >= 58 && (relation?.score ?? 0) < 25;
  const dependent = /col[oô]nia|vassal|depend|tribut|protetor/i.test(`${attacker.type} ${attacker.government}`);
  const truce = activeTruceBetween(attacker.id, target.id, simulation.elapsedDays);
  const truceReason = truce ? 'Existe uma trégua em vigor entre as duas entidades.' : '';

  const options: CasusBelliOption[] = [
    {
      id: `claim-${attacker.id}-${target.id}`,
      type: 'territorial_claim',
      label: 'Reivindicação territorial',
      description: 'Recuperar território cedido anteriormente ou reivindicado por memória pós-guerra.',
      legitimacy: claims.length ? clamp(76 + claims.length * 6) : 0,
      stabilityCost: 1.2,
      diplomaticCost: 4,
      preparationDays: days(32, simulation.date.year),
      allowedGoals: ['territory', 'defense'],
      available: claims.length > 0 && !truce,
      reason: truceReason || (claims.length ? `${claims.length} reivindicação(ões) ativa(s) sustentam a justificativa.` : 'Não existem reivindicações territoriais ativas contra este alvo.'),
      claimLocationIds: claims.map((claim) => claim.locationId),
    },
    {
      id: `border-${attacker.id}-${target.id}`,
      type: 'border_dispute',
      label: 'Disputa de fronteira',
      description: 'Escalar uma disputa em uma zona próxima ou fronteiriça sem reivindicação pós-guerra formal.',
      legitimacy: border ? 62 : 0,
      stabilityCost: 2.3,
      diplomaticCost: 8,
      preparationDays: days(55, simulation.date.year),
      allowedGoals: ['territory', 'defense'],
      available: border && !truce,
      reason: truceReason || (border ? 'Existem locations suficientemente próximas para sustentar uma disputa fronteiriça abstrata.' : 'Não há proximidade territorial suficiente nos dados atualmente mapeados.'),
    },
    {
      id: `retaliation-${attacker.id}-${target.id}`,
      type: 'retaliation',
      label: 'Retaliação estratégica',
      description: 'Responder a ameaça, hostilidade ou deterioração grave das relações bilaterais.',
      legitimacy: retaliation ? 70 : 28,
      stabilityCost: retaliation ? 1.8 : 4,
      diplomaticCost: retaliation ? 7 : 14,
      preparationDays: days(retaliation ? 28 : 70, simulation.date.year),
      allowedGoals: ['reparations', 'defense'],
      available: retaliation && !truce,
      reason: truceReason || (retaliation ? 'A relação bilateral registra ameaça ou hostilidade suficiente.' : 'A hostilidade atual não sustenta uma retaliação legitimada.'),
    },
    {
      id: `trade-${attacker.id}-${target.id}`,
      type: 'trade_dispute',
      label: 'Disputa comercial',
      description: 'Transformar tensão econômica e interesse comercial em coerção interestatal.',
      legitimacy: tradeDispute ? 48 : 20,
      stabilityCost: 3.1,
      diplomaticCost: 12,
      preparationDays: days(75, simulation.date.year),
      allowedGoals: ['reparations'],
      available: tradeDispute && !truce,
      reason: truceReason || (tradeDispute ? 'Há interesse comercial relevante combinado com relação política deteriorada.' : 'As condições econômicas e diplomáticas não justificam esta escalada.'),
    },
    {
      id: `independence-${attacker.id}-${target.id}`,
      type: 'independence',
      label: 'Independência / emancipação',
      description: 'Romper uma relação de dependência quando a entidade jogável possui estrutura compatível com esse objetivo.',
      legitimacy: dependent ? 82 : 0,
      stabilityCost: 2,
      diplomaticCost: 5,
      preparationDays: days(45, simulation.date.year),
      allowedGoals: ['independence'],
      available: dependent && !truce,
      reason: truceReason || (dependent ? 'O tipo institucional da entidade permite um objetivo de emancipação nesta abstração.' : 'A entidade não está marcada como dependência, colônia, vassalo ou estrutura equivalente.'),
    },
    {
      id: `prestige-${attacker.id}-${target.id}`,
      type: 'prestige',
      label: simulation.date.year < 1800 ? 'Prestígio dinástico / estatal' : 'Demonstração de poder',
      description: 'Escalada baseada em prestígio, influência ou rivalidade sem uma causa territorial forte.',
      legitimacy: 30,
      stabilityCost: 5.5,
      diplomaticCost: 18,
      preparationDays: days(95, simulation.date.year),
      allowedGoals: ['reparations', 'regime'],
      available: !truce,
      reason: truceReason || 'É possível preparar esta justificativa, mas ela terá baixa legitimidade e custo diplomático elevado.',
    },
    {
      id: `unjustified-${attacker.id}-${target.id}`,
      type: 'unjustified',
      label: 'Guerra sem justificativa reconhecida',
      description: 'Iniciar hostilidades sem uma causa legitimada; rápido, porém politicamente e diplomaticamente caro.',
      legitimacy: 8,
      stabilityCost: 9,
      diplomaticCost: 28,
      preparationDays: days(10, simulation.date.year),
      allowedGoals: ['territory', 'reparations', 'regime'],
      available: !truce,
      reason: truceReason || 'Disponível como último recurso, com forte penalidade política e diplomática.',
    },
  ];
  return options;
}

export function startWarPreparation(attackerId: string, targetId: string, option: CasusBelliOption, elapsedDay: number) {
  if (!option.available) return undefined;
  const existing = rootState().filter((item) => !(item.attackerId === attackerId && item.targetId === targetId));
  const preparation: WarPreparation = {
    id: `prep-${attackerId}-${targetId}-${option.type}-${elapsedDay}`,
    attackerId,
    targetId,
    casusBelliType: option.type,
    startedAtElapsedDay: elapsedDay,
    readyAtElapsedDay: elapsedDay + option.preparationDays,
    legitimacy: option.legitimacy,
  };
  publish([preparation, ...existing].slice(0, 30));
  return preparation;
}

export function preparationBetween(attackerId: string, targetId: string) {
  return rootState().find((item) => item.attackerId === attackerId && item.targetId === targetId);
}

export function preparationReady(preparation: WarPreparation | undefined, option: CasusBelliOption, elapsedDay: number) {
  return !!preparation && preparation.casusBelliType === option.type && elapsedDay >= preparation.readyAtElapsedDay;
}

export function consumePreparation(attackerId: string, targetId: string) {
  publish(rootState().filter((item) => !(item.attackerId === attackerId && item.targetId === targetId)));
}

export function applyCasusBelliCosts(simulation: SimulationState, attackerId: string, targetId: string, option: CasusBelliOption): SimulationState {
  const attacker = simulation.entities[attackerId];
  if (!attacker) return simulation;
  const diplomacy = Object.fromEntries(Object.entries(simulation.diplomacy).map(([key, relation]) => {
    if (!relation.parties.includes(attackerId)) return [key, relation];
    const directlyTargeted = relation.parties.includes(targetId);
    const trustPenalty = directlyTargeted ? option.diplomaticCost * 0.55 : option.diplomaticCost * 0.16;
    const scorePenalty = directlyTargeted ? option.diplomaticCost * 0.7 : option.diplomaticCost * 0.12;
    return [key, {
      ...relation,
      trust: clamp(relation.trust - trustPenalty),
      score: clamp(relation.score - scorePenalty, -100, 100),
      threat: clamp(relation.threat + (directlyTargeted ? option.diplomaticCost * 0.65 : option.diplomaticCost * 0.12)),
      memory: [`Guerra iniciada sob o casus belli: ${option.label}.`, ...relation.memory].slice(0, 8),
    }];
  }));
  const event: WorldEvent = {
    id: `casus-belli-${attackerId}-${targetId}-${simulation.elapsedDays}`,
    date: simulation.date,
    entityId: attackerId,
    category: 'diplomacy',
    title: `Casus belli: ${option.label}`,
    text: `A guerra foi iniciada com legitimidade ${option.legitimacy.toFixed(0)}/100. Custo político ${option.stabilityCost.toFixed(1)} e pressão diplomática ${option.diplomaticCost.toFixed(0)}.`,
  };
  return {
    ...simulation,
    entities: { ...simulation.entities, [attackerId]: { ...attacker, stability: clamp(attacker.stability - option.stabilityCost) } },
    diplomacy,
    events: [event, ...simulation.events].slice(0, 80),
  };
}
