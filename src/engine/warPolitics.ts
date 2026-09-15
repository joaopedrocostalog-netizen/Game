import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from './army';
import { nationalMoraleFor } from './nationalMorale';
import type { SimulationState, WorldEvent } from './simulation';
import type { FrontOrder, War, WarState } from './war';

export type OperationalConstraint = 'none' | 'limited-offensives' | 'defensive-posture' | 'armistice-mandate';
export type PoliticalOrderState = 'continuity' | 'government-reorganization' | 'leadership-transition' | 'regime-transition';
export type ArmisticeOfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export type WarPoliticsProfile = {
  entityId: string;
  crisisScore: number;
  operationalConstraint: OperationalConstraint;
  desertionPressure: number;
  fragmentationPressure: number;
  politicalOrder: PoliticalOrderState;
  leadershipChanges: number;
  lastProcessedElapsedDay: number;
  lastTransitionElapsedDay: number;
};

export type ArmisticeOffer = {
  id: string;
  warId: string;
  fromId: string;
  toId: string;
  createdAtElapsedDay: number;
  status: ArmisticeOfferStatus;
  rationale: string;
};

export type WarPoliticsState = {
  profiles: Record<string, WarPoliticsProfile>;
  armisticeOffers: ArmisticeOffer[];
};

type Root = typeof globalThis & { __WORLD_STATE_WAR_POLITICS__?: WarPoliticsState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): WarPoliticsState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_WAR_POLITICS__) root.__WORLD_STATE_WAR_POLITICS__ = { profiles: {}, armisticeOffers: [] };
  return root.__WORLD_STATE_WAR_POLITICS__;
}
function publish(state: WarPoliticsState) {
  (globalThis as Root).__WORLD_STATE_WAR_POLITICS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-war-politics', { detail: state }));
}
export function resetWarPolitics() { publish({ profiles: {}, armisticeOffers: [] }); }
export function warPoliticsState() {
  const state = rootState();
  return {
    profiles: Object.fromEntries(Object.entries(state.profiles).map(([id, profile]) => [id, { ...profile }])),
    armisticeOffers: state.armisticeOffers.map((offer) => ({ ...offer })),
  };
}

function initialProfile(entityId: string, simulation: SimulationState): WarPoliticsProfile {
  return { entityId, crisisScore: 8, operationalConstraint: 'none', desertionPressure: 2, fragmentationPressure: 1, politicalOrder: 'continuity', leadershipChanges: 0, lastProcessedElapsedDay: simulation.elapsedDays, lastTransitionElapsedDay: -9999 };
}
function ensureProfile(entityId: string, simulation: SimulationState) {
  const state = rootState();
  if (state.profiles[entityId]) return state.profiles[entityId];
  const profile = initialProfile(entityId, simulation);
  publish({ ...state, profiles: { ...state.profiles, [entityId]: profile } });
  return profile;
}
export function warPoliticsFor(entityId: string, simulation: SimulationState) { return { ...ensureProfile(entityId, simulation) }; }

export function operationalConstraintLabel(value: OperationalConstraint, year: number) {
  if (value === 'none') return 'CONDUÇÃO MILITAR SEM RESTRIÇÃO POLÍTICA';
  if (value === 'limited-offensives') return year < 1850 ? 'PRESSÃO PARA EVITAR CAMPANHAS CUSTOSAS' : 'OFENSIVAS POLITICAMENTE LIMITADAS';
  if (value === 'defensive-posture') return year < 1850 ? 'CORPOS POLÍTICOS EXIGEM POSTURA DEFENSIVA' : 'MANDATO POLÍTICO DEFENSIVO';
  return year < 1850 ? 'PRESSÃO FORMAL POR NEGOCIAÇÃO' : 'MANDATO INTERNO POR ARMISTÍCIO';
}
export function politicalOrderLabel(value: PoliticalOrderState, year: number) {
  if (value === 'continuity') return year < 1850 ? 'AUTORIDADE MANTIDA' : 'CONTINUIDADE DE GOVERNO';
  if (value === 'government-reorganization') return year < 1850 ? 'REORGANIZAÇÃO DA CORTE/CONSELHO' : 'REORGANIZAÇÃO DE GOVERNO';
  if (value === 'leadership-transition') return year < 1850 ? 'MUDANÇA DE LIDERANÇA/REGENCIA' : 'TRANSIÇÃO DE LIDERANÇA';
  return year < 1850 ? 'RUPTURA DA ORDEM POLÍTICA' : 'TRANSIÇÃO DE REGIME';
}

function entityDescriptor(entity?: ScenarioEntity) {
  return `${entity?.type ?? ''} ${entity?.government ?? ''}`.toLowerCase();
}
function fragmentationSusceptibility(entity?: ScenarioEntity) {
  const text = entityDescriptor(entity);
  return /império|empire|federa|confedera|sultan|reino|kingdom|união|union/.test(text) ? 1.18 : .82;
}
function operationalConstraint(crisis: number, warSupport: number, peacePressure: number): OperationalConstraint {
  if (peacePressure >= 82 && warSupport <= 24 && crisis >= 74) return 'armistice-mandate';
  if (crisis >= 76) return 'defensive-posture';
  if (crisis >= 58) return 'limited-offensives';
  return 'none';
}
function crisisScoreFor(entityId: string, simulation: SimulationState, armyState: ArmyState) {
  const morale = nationalMoraleFor(entityId, simulation, armyState);
  const runtime = simulation.entities[entityId];
  return clamp(
    morale.peacePressure * .28 + morale.protestPressure * .24 + morale.casualtyBurden * .16
    + (100 - morale.warSupport) * .14 + (100 - morale.authorityConfidence) * .1
    + (100 - (runtime?.stability ?? 50)) * .08,
  );
}
function constrainedOrder(order: FrontOrder, constraint: OperationalConstraint, side: 'attacker' | 'defender'): FrontOrder {
  if (constraint === 'none') return order;
  if (constraint === 'limited-offensives') return order === 'breakthrough' ? 'offensive' : order;
  if (constraint === 'defensive-posture') {
    if (order === 'breakthrough' || order === 'offensive') return side === 'defender' ? 'defend' : 'cautious';
    return order;
  }
  if (order === 'breakthrough' || order === 'offensive') return side === 'defender' ? 'defend' : 'cautious';
  return order === 'reserve' ? 'reserve' : side === 'defender' ? 'defend' : 'cautious';
}
function applyOperationalConstraints(warState: WarState, profiles: Record<string, WarPoliticsProfile>) {
  return {
    ...warState,
    wars: warState.wars.map((war) => {
      if (war.status !== 'active') return war;
      const attackerConstraint = war.attackers.map((id) => profiles[id]?.operationalConstraint ?? 'none').sort((a, b) => rankConstraint(b) - rankConstraint(a))[0] ?? 'none';
      const defenderConstraint = war.defenders.map((id) => profiles[id]?.operationalConstraint ?? 'none').sort((a, b) => rankConstraint(b) - rankConstraint(a))[0] ?? 'none';
      return {
        ...war,
        fronts: war.fronts.map((front) => ({
          ...front,
          attackerOrder: constrainedOrder(front.attackerOrder, attackerConstraint, 'attacker'),
          defenderOrder: constrainedOrder(front.defenderOrder, defenderConstraint, 'defender'),
        })),
      };
    }),
  };
}
function rankConstraint(value: OperationalConstraint) {
  if (value === 'armistice-mandate') return 3;
  if (value === 'defensive-posture') return 2;
  if (value === 'limited-offensives') return 1;
  return 0;
}
function otherPrincipal(war: War, entityId: string) {
  if (war.attackers.includes(entityId)) return war.defenderId;
  if (war.defenders.includes(entityId)) return war.attackerId;
  return '';
}
function offerExists(offers: ArmisticeOffer[], warId: string, fromId: string) {
  return offers.some((offer) => offer.warId === warId && offer.fromId === fromId && offer.status === 'pending');
}
function canAiAcceptArmistice(entityId: string, war: War, profiles: Record<string, WarPoliticsProfile>) {
  const profile = profiles[entityId];
  if (!profile) return false;
  const losingBadly = war.attackers.includes(entityId) ? war.score < -28 : war.score > 28;
  const stalemate = Math.abs(war.score) < 24 && war.elapsedDays >= 240;
  return profile.crisisScore >= 56 || profile.operationalConstraint === 'armistice-mandate' || losingBadly || stalemate;
}
function endWarAsArmistice(warState: WarState, warId: string) {
  return { ...warState, wars: warState.wars.map((war) => war.id === warId ? { ...war, status: 'ended' as const, victor: 'stalemate' as const } : war) };
}

export function respondArmisticeOffer(offerId: string, accept: boolean, warState: WarState) {
  const state = rootState();
  const offer = state.armisticeOffers.find((item) => item.id === offerId && item.status === 'pending');
  if (!offer) return { warState, message: 'A proposta de armistício já não está disponível.' };
  const armisticeOffers = state.armisticeOffers.map((item) => item.id === offerId ? { ...item, status: accept ? 'accepted' as const : 'rejected' as const } : item);
  publish({ ...state, armisticeOffers });
  return { warState: accept ? endWarAsArmistice(warState, offer.warId) : warState, message: accept ? 'Armistício aceito. A guerra foi encerrada sem vitória decisiva.' : 'Armistício recusado. A guerra continua.' };
}

export function requestArmistice(entityId: string, warId: string, simulation: SimulationState, warState: WarState, armyState: ArmyState) {
  const state = rootState();
  const war = warState.wars.find((item) => item.id === warId && item.status === 'active');
  if (!war || (!war.attackers.includes(entityId) && !war.defenders.includes(entityId))) return { warState, message: 'Nenhuma guerra ativa compatível foi encontrada.' };
  const targetId = otherPrincipal(war, entityId);
  if (!targetId) return { warState, message: 'Não foi possível identificar a contraparte principal.' };
  const own = warPoliticsFor(entityId, simulation);
  const target = warPoliticsFor(targetId, simulation);
  const morale = nationalMoraleFor(entityId, simulation, armyState);
  const chance = target.crisisScore + (war.elapsedDays >= 300 ? 18 : 0) + (Math.abs(war.score) < 20 ? 12 : 0) + (own.crisisScore >= 70 ? 7 : 0);
  const accepted = chance >= 66 || morale.peacePressure >= 90;
  const offer: ArmisticeOffer = { id: `armistice-${war.id}-${entityId}-${simulation.elapsedDays}`, warId: war.id, fromId: entityId, toId: targetId, createdAtElapsedDay: simulation.elapsedDays, status: accepted ? 'accepted' : 'rejected', rationale: 'Pressões políticas e militares levaram o governo a buscar uma interrupção negociada das hostilidades.' };
  publish({ ...state, armisticeOffers: [offer, ...state.armisticeOffers].slice(0, 50) });
  return { warState: accepted ? endWarAsArmistice(warState, war.id) : warState, message: accepted ? 'A contraparte aceitou um armistício negociado.' : 'A contraparte rejeitou o armistício neste momento.' };
}

export function processWarPolitics(simulation: SimulationState, warState: WarState, armyState: ArmyState, entities: ScenarioEntity[]) {
  const state = rootState();
  let profiles = { ...state.profiles };
  let offers = state.armisticeOffers.map((offer) => ({ ...offer }));
  let nextSimulation = simulation;
  let nextArmy: ArmyState = { ...armyState, units: armyState.units.map((unit) => ({ ...unit, commander: { ...unit.commander } })) };
  let nextWarState = warState;
  let events = [...simulation.events];
  let changed = false;

  for (const entityId of Object.keys(simulation.entities)) {
    const current = profiles[entityId] ?? initialProfile(entityId, simulation);
    const days = Math.max(0, simulation.elapsedDays - current.lastProcessedElapsedDay);
    if (!days) { profiles[entityId] = current; continue; }
    const runtime = nextSimulation.entities[entityId];
    if (!runtime) continue;
    const morale = nationalMoraleFor(entityId, simulation, armyState);
    const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
    const score = crisisScoreFor(entityId, simulation, armyState);
    const constraint = atWar ? operationalConstraint(score, morale.warSupport, morale.peacePressure) : 'none';
    const desertionPressure = clamp(current.desertionPressure + days * (atWar ? Math.max(0, score - 48) * .0009 + morale.casualtyBurden * .00025 : -.028));
    const entity = entities.find((item) => item.id === entityId);
    const fragmentationPressure = clamp(current.fragmentationPressure + days * ((Math.max(0, score - 68) * .0007 + Math.max(0, 28 - runtime.stability) * .0008) * fragmentationSusceptibility(entity) - (!atWar ? .012 : 0)));
    let politicalOrder = current.politicalOrder;
    let leadershipChanges = current.leadershipChanges;
    let lastTransitionElapsedDay = current.lastTransitionElapsedDay;

    if (score >= 86 && simulation.elapsedDays - lastTransitionElapsedDay >= 120) {
      const regimeBreak = runtime.stability < 16 && morale.authorityConfidence < 18 && fragmentationPressure >= 58;
      const leadershipBreak = morale.authorityConfidence < 28 || morale.eliteSupport < 26;
      politicalOrder = regimeBreak ? 'regime-transition' : leadershipBreak ? 'leadership-transition' : 'government-reorganization';
      leadershipChanges += 1;
      lastTransitionElapsedDay = simulation.elapsedDays;
      const transitionDrain = regimeBreak ? 7 : leadershipBreak ? 3.5 : 1.5;
      nextSimulation = { ...nextSimulation, entities: { ...nextSimulation.entities, [entityId]: { ...runtime, stability: clamp(runtime.stability - transitionDrain + (leadershipBreak && !regimeBreak ? 2 : 0)) } } };
      const event: WorldEvent = {
        id: `war-politics-transition-${entityId}-${simulation.elapsedDays}`,
        date: simulation.date,
        entityId,
        category: 'politics',
        title: regimeBreak ? 'Ruptura da ordem política durante a guerra' : leadershipBreak ? 'Mudança de liderança sob pressão da guerra' : 'Reorganização do governo em meio à crise',
        text: regimeBreak
          ? 'A combinação de baixa autoridade, fragmentação interna e desgaste de guerra provocou uma transição profunda da ordem política.'
          : leadershipBreak
            ? 'A crise de confiança e apoio interno levou à substituição ou reorganização da liderança do Estado.'
            : 'A liderança reorganizou o governo para tentar recuperar autoridade e capacidade de condução do conflito.',
      };
      events = [event, ...events].slice(0, 50);
    } else if (!atWar && score < 42 && politicalOrder !== 'continuity') politicalOrder = 'continuity';

    if (atWar && desertionPressure > 50) {
      const desertionRate = days * Math.max(0, desertionPressure - 45) / 100 * .00012;
      nextArmy = { ...nextArmy, units: nextArmy.units.map((unit) => unit.entityId !== entityId ? unit : {
        ...unit,
        personnel: Math.max(0, Math.round(unit.personnel * (1 - desertionRate))),
        morale: clamp(unit.morale - days * desertionPressure * .00018),
        organization: clamp(unit.organization - days * desertionPressure * .00012),
      }) };
    }

    profiles[entityId] = { ...current, crisisScore: score, operationalConstraint: constraint, desertionPressure, fragmentationPressure, politicalOrder, leadershipChanges, lastProcessedElapsedDay: simulation.elapsedDays, lastTransitionElapsedDay };
    changed = true;
  }

  nextWarState = applyOperationalConstraints(nextWarState, profiles);

  for (const war of nextWarState.wars) {
    if (war.status !== 'active') continue;
    for (const entityId of [...war.attackers, ...war.defenders]) {
      if (entityId === simulation.playerEntityId) continue;
      const profile = profiles[entityId];
      if (!profile || profile.operationalConstraint !== 'armistice-mandate' || offerExists(offers, war.id, entityId)) continue;
      const targetId = otherPrincipal(war, entityId);
      if (!targetId) continue;
      const offer: ArmisticeOffer = { id: `armistice-${war.id}-${entityId}-${simulation.elapsedDays}`, warId: war.id, fromId: entityId, toId: targetId, createdAtElapsedDay: simulation.elapsedDays, status: 'pending', rationale: 'O colapso do apoio interno e a pressão política obrigaram a liderança a buscar uma interrupção negociada das hostilidades.' };
      if (targetId !== simulation.playerEntityId && canAiAcceptArmistice(targetId, war, profiles)) {
        offer.status = 'accepted';
        nextWarState = endWarAsArmistice(nextWarState, war.id);
        const armisticeEvent: WorldEvent = { id: `armistice-event-${war.id}-${simulation.elapsedDays}`, date: simulation.date, entityId, category: 'diplomacy', title: 'Armistício negociado', text: 'Pressões políticas internas em ambos os lados abriram caminho para uma suspensão negociada das hostilidades.' };
        events = [armisticeEvent, ...events].slice(0, 50);
      }
      offers = [offer, ...offers].slice(0, 50);
      changed = true;
    }
  }

  offers = offers.map((offer) => offer.status === 'pending' && simulation.elapsedDays - offer.createdAtElapsedDay > 90 ? { ...offer, status: 'expired' as const } : offer);
  if (changed) publish({ profiles, armisticeOffers: offers });
  return { simulation: { ...nextSimulation, events }, warState: nextWarState, armyState: nextArmy, changed };
}
