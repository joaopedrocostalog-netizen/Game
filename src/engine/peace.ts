import type { SimulationState } from './simulation';
import type { TerritorialControlState } from './territorialControl';
import type { War, WarState } from './war';

export type PeaceTerm = 'status_quo' | 'reparations' | 'limited_annexation' | 'recognition';
export type PeaceSide = 'attacker' | 'defender';

export type PeaceEvaluation = {
  acceptance: number;
  leverage: number;
  occupiedLocations: number;
  eligible: boolean;
  reason: string;
};

export type TruceRecord = {
  id: string;
  parties: [string, string];
  sourceWarId: string;
  signedAtElapsedDay: number;
  expiresAtElapsedDay: number;
  term: PeaceTerm;
};

export type TerritorialClaim = {
  id: string;
  claimantId: string;
  holderId: string;
  locationId: string;
  sourceWarId: string;
  createdAtElapsedDay: number;
  strength: number;
  active: boolean;
};

export type PeaceMemory = {
  id: string;
  warId: string;
  parties: [string, string];
  winnerId: string;
  loserId: string;
  term: PeaceTerm;
  signedAtElapsedDay: number;
  transferredLocationIds: string[];
};

export type PostWarState = {
  truces: TruceRecord[];
  claims: TerritorialClaim[];
  peaceHistory: PeaceMemory[];
};

export type PeaceResolution = {
  accepted: boolean;
  message: string;
  warState: WarState;
  territorialControl: TerritorialControlState;
  simulation: SimulationState;
  transferredLocationIds: string[];
};

type PostWarGlobal = typeof globalThis & { __WORLD_STATE_POSTWAR__?: PostWarState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function currentPostWarState(): PostWarState {
  const root = globalThis as PostWarGlobal;
  if (!root.__WORLD_STATE_POSTWAR__) root.__WORLD_STATE_POSTWAR__ = { truces: [], claims: [], peaceHistory: [] };
  return root.__WORLD_STATE_POSTWAR__;
}

function publishPostWarState(state: PostWarState) {
  const root = globalThis as PostWarGlobal;
  root.__WORLD_STATE_POSTWAR__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-postwar', { detail: state }));
}

export function postWarState(): PostWarState {
  const state = currentPostWarState();
  return { truces: [...state.truces], claims: [...state.claims], peaceHistory: [...state.peaceHistory] };
}

export function resetPostWarState() {
  publishPostWarState({ truces: [], claims: [], peaceHistory: [] });
}

export function activeTruceBetween(a: string, b: string, elapsedDay: number) {
  return currentPostWarState().truces.find((truce) =>
    truce.expiresAtElapsedDay > elapsedDay && truce.parties.includes(a) && truce.parties.includes(b),
  );
}

export function claimsForEntity(entityId: string) {
  return currentPostWarState().claims.filter((claim) => claim.active && claim.claimantId === entityId);
}

export function revanchismForEntity(entityId: string, elapsedDay: number) {
  const state = currentPostWarState();
  const claims = state.claims.filter((claim) => claim.active && claim.claimantId === entityId);
  if (!claims.length) return 0;
  const activeTruces = state.truces.filter((truce) => truce.expiresAtElapsedDay > elapsedDay && truce.parties.includes(entityId)).length;
  return clamp(claims.reduce((sum, claim) => sum + claim.strength, 0) / claims.length + claims.length * 6 - activeTruces * 5, 0, 100);
}

function warById(state: WarState, warId: string) {
  return state.wars.find((war) => war.id === warId);
}

function leaderForSide(war: War, side: PeaceSide) {
  return side === 'attacker' ? war.attackerId : war.defenderId;
}

function enemyLeader(war: War, side: PeaceSide) {
  return side === 'attacker' ? war.defenderId : war.attackerId;
}

function occupiedBySide(war: War, side: PeaceSide, control: TerritorialControlState) {
  const leader = leaderForSide(war, side);
  const enemy = new Set(side === 'attacker' ? war.defenders : war.attackers);
  return Object.values(control.occupations).filter((occupation) =>
    occupation.warId === war.id &&
    occupation.progress >= 100 &&
    occupation.controllerId === leader &&
    enemy.has(occupation.ownerId),
  );
}

export function evaluatePeaceOffer(
  war: War,
  side: PeaceSide,
  term: PeaceTerm,
  control: TerritorialControlState,
): PeaceEvaluation {
  const scoreForSide = side === 'attacker' ? war.score : -war.score;
  const ownSupport = side === 'attacker' ? war.attackerSupport : war.defenderSupport;
  const enemySupport = side === 'attacker' ? war.defenderSupport : war.attackerSupport;
  const occupied = occupiedBySide(war, side, control);
  const supportPressure = (100 - enemySupport) * 0.32 - (100 - ownSupport) * 0.12;
  const leverage = clamp(50 + scoreForSide * 0.42 + occupied.length * 8 + supportPressure, 0, 100);

  const threshold: Record<PeaceTerm, number> = {
    status_quo: 24,
    reparations: 54,
    limited_annexation: 67,
    recognition: 61,
  };
  const eligible = term !== 'limited_annexation' || occupied.length > 0;
  const acceptance = eligible ? clamp(50 + (leverage - threshold[term]) * 1.55, 2, 98) : 0;
  const reason = !eligible
    ? 'Nenhuma location inimiga está completamente ocupada; anexação territorial não pode ser exigida.'
    : leverage >= threshold[term]
      ? 'A situação militar e política cria alavancagem suficiente para apresentar estes termos.'
      : 'Os termos excedem a alavancagem atual; a outra parte tende a rejeitar.';

  return { acceptance, leverage, occupiedLocations: occupied.length, eligible, reason };
}

function deterministicRoll(war: War, term: PeaceTerm, side: PeaceSide) {
  const seed = `${war.id}:${term}:${side}:${war.elapsedDays}:${war.score.toFixed(2)}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100;
}

function restoreWarOccupations(control: TerritorialControlState, warId: string) {
  const occupations = { ...control.occupations };
  for (const [locationId, occupation] of Object.entries(occupations)) {
    if (occupation.warId !== warId) continue;
    occupations[locationId] = {
      ...occupation,
      controllerId: occupation.ownerId,
      progress: 0,
      contested: false,
    };
  }
  return { ...control, occupations };
}

function transferLimitedTerritory(
  control: TerritorialControlState,
  war: War,
  side: PeaceSide,
) {
  const leader = leaderForSide(war, side);
  const occupied = occupiedBySide(war, side, control)
    .sort((a, b) => b.battleCount - a.battleCount || b.progress - a.progress)
    .slice(0, Math.max(1, Math.min(2, Math.floor(Math.abs(war.score) / 45) || 1)));
  const selected = new Set(occupied.map((item) => item.locationId));
  const occupations = { ...control.occupations };

  for (const [locationId, occupation] of Object.entries(occupations)) {
    if (occupation.warId !== war.id) continue;
    if (selected.has(locationId)) {
      occupations[locationId] = {
        ...occupation,
        ownerId: leader,
        controllerId: leader,
        progress: 0,
        contested: false,
        warId: `peace-${war.id}`,
      };
    } else {
      occupations[locationId] = {
        ...occupation,
        controllerId: occupation.ownerId,
        progress: 0,
        contested: false,
      };
    }
  }
  return { state: { ...control, occupations }, transferred: [...selected] };
}

function applyReparations(simulation: SimulationState, war: War, side: PeaceSide) {
  const winnerId = leaderForSide(war, side);
  const payerId = enemyLeader(war, side);
  const winner = simulation.entities[winnerId];
  const payer = simulation.entities[payerId];
  if (!winner || !payer) return simulation;
  const payment = Math.min(8, Math.max(2, Math.abs(war.score) / 16));
  return {
    ...simulation,
    entities: {
      ...simulation.entities,
      [winnerId]: { ...winner, treasuryIndex: clamp(winner.treasuryIndex + payment) },
      [payerId]: { ...payer, treasuryIndex: clamp(payer.treasuryIndex - payment) },
    },
  };
}

function registerPostWarConsequences(
  simulation: SimulationState,
  war: War,
  side: PeaceSide,
  term: PeaceTerm,
  transferredLocationIds: string[],
) {
  const current = currentPostWarState();
  const winnerId = leaderForSide(war, side);
  const loserId = enemyLeader(war, side);
  const truceDays = simulation.date.year < 1800 ? 1460 : 1825;
  const parties: [string, string] = [war.attackerId, war.defenderId];
  const truce: TruceRecord = {
    id: `truce-${war.id}`,
    parties,
    sourceWarId: war.id,
    signedAtElapsedDay: simulation.elapsedDays,
    expiresAtElapsedDay: simulation.elapsedDays + truceDays,
    term,
  };
  const memory: PeaceMemory = {
    id: `peace-memory-${war.id}`,
    warId: war.id,
    parties,
    winnerId,
    loserId,
    term,
    signedAtElapsedDay: simulation.elapsedDays,
    transferredLocationIds,
  };
  const newClaims: TerritorialClaim[] = transferredLocationIds.map((locationId, index) => ({
    id: `claim-${loserId}-${locationId}-${war.id}`,
    claimantId: loserId,
    holderId: winnerId,
    locationId,
    sourceWarId: war.id,
    createdAtElapsedDay: simulation.elapsedDays,
    strength: clamp(62 + Math.abs(war.score) * 0.18 - index * 4, 45, 92),
    active: true,
  }));
  publishPostWarState({
    truces: [truce, ...current.truces.filter((item) => !(item.parties.includes(war.attackerId) && item.parties.includes(war.defenderId)))].slice(0, 40),
    claims: [...newClaims, ...current.claims].slice(0, 80),
    peaceHistory: [memory, ...current.peaceHistory].slice(0, 40),
  });
}

export function resolvePeaceOffer(
  warState: WarState,
  control: TerritorialControlState,
  simulation: SimulationState,
  warId: string,
  side: PeaceSide,
  term: PeaceTerm,
): PeaceResolution {
  const war = warById(warState, warId);
  if (!war || war.status !== 'active') {
    return { accepted: false, message: 'A guerra já não está disponível para negociação.', warState, territorialControl: control, simulation, transferredLocationIds: [] };
  }

  const evaluation = evaluatePeaceOffer(war, side, term, control);
  if (!evaluation.eligible) {
    return { accepted: false, message: evaluation.reason, warState, territorialControl: control, simulation, transferredLocationIds: [] };
  }

  const accepted = deterministicRoll(war, term, side) < evaluation.acceptance;
  if (!accepted) {
    return {
      accepted: false,
      message: `A proposta foi rejeitada. Aceitação estimada: ${evaluation.acceptance.toFixed(0)}%. ${evaluation.reason}`,
      warState,
      territorialControl: control,
      simulation,
      transferredLocationIds: [],
    };
  }

  let nextControl = restoreWarOccupations(control, war.id);
  let nextSimulation = simulation;
  let transferredLocationIds: string[] = [];
  if (term === 'limited_annexation') {
    const transfer = transferLimitedTerritory(control, war, side);
    nextControl = transfer.state;
    transferredLocationIds = transfer.transferred;
  }
  if (term === 'reparations') nextSimulation = applyReparations(simulation, war, side);

  const victor: War['victor'] = side === 'attacker' ? 'attackers' : 'defenders';
  const wars: War[] = warState.wars.map((item) => item.id === war.id ? { ...item, status: 'ended' as const, victor } : item);
  registerPostWarConsequences(simulation, war, side, term, transferredLocationIds);
  const termLabel: Record<PeaceTerm, string> = {
    status_quo: 'cessar-fogo com restauração do status territorial',
    reparations: 'paz com reparações financeiras',
    limited_annexation: `paz com cessão limitada de ${transferredLocationIds.length} location(s)`,
    recognition: 'paz com reconhecimento político do objetivo negociado',
  };

  return {
    accepted: true,
    message: `A outra parte aceitou: ${termLabel[term]}. Uma trégua temporária entrou em vigor; violações futuras terão custo político.`,
    warState: { ...warState, wars },
    territorialControl: nextControl,
    simulation: nextSimulation,
    transferredLocationIds,
  };
}