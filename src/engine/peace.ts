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

export type PeaceResolution = {
  accepted: boolean;
  message: string;
  warState: WarState;
  territorialControl: TerritorialControlState;
  simulation: SimulationState;
  transferredLocationIds: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
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

  const victor = side === 'attacker' ? 'attackers' : 'defenders';
  const wars = warState.wars.map((item) => item.id === war.id ? { ...item, status: 'ended' as const, victor } : item);
  const termLabel: Record<PeaceTerm, string> = {
    status_quo: 'cessar-fogo com restauração do status territorial',
    reparations: 'paz com reparações financeiras',
    limited_annexation: `paz com cessão limitada de ${transferredLocationIds.length} location(s)`,
    recognition: 'paz com reconhecimento político do objetivo negociado',
  };

  return {
    accepted: true,
    message: `A outra parte aceitou: ${termLabel[term]}. A ocupação restante foi encerrada e a guerra terminou por acordo negociado.`,
    warState: { ...warState, wars },
    territorialControl: nextControl,
    simulation: nextSimulation,
    transferredLocationIds,
  };
}
