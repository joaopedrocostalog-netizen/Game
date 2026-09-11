import { locationsForYear } from '../data/territories';
import type { GameDate } from './simulation';
import type { WarState } from './war';

export type BattleOutcome = 'attacker-advance' | 'defender-hold' | 'contested';

export type OccupationState = {
  locationId: string;
  ownerId: string;
  controllerId: string;
  warId: string;
  progress: number;
  contested: boolean;
  lastOutcome: BattleOutcome;
  battleCount: number;
  updatedAt: GameDate;
};

export type BattleRecord = {
  id: string;
  warId: string;
  frontId: string;
  locationId?: string;
  date: GameDate;
  outcome: BattleOutcome;
  attackerPower: number;
  defenderPower: number;
  intensity: number;
  occupationProgress: number;
};

export type TerritorialControlState = {
  occupations: Record<string, OccupationState>;
  battles: BattleRecord[];
};

export function createInitialTerritorialControlState(): TerritorialControlState {
  return { occupations: {}, battles: [] };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function outcomeFromEdge(edge: number): BattleOutcome {
  if (edge > 0.08) return 'attacker-advance';
  if (edge < -0.08) return 'defender-hold';
  return 'contested';
}

export function simulateTerritorialControl(
  state: TerritorialControlState,
  warState: WarState,
  year: number,
  date: GameDate,
  days: number,
): TerritorialControlState {
  if (days <= 0) return state;

  const locations = new Map(locationsForYear(year).map((location) => [location.id, location]));
  const occupations = { ...state.occupations };
  const newBattles: BattleRecord[] = [];

  for (const war of warState.wars) {
    if (war.status !== 'active') continue;

    for (const front of war.fronts) {
      if (!front.locationId) continue;
      const location = locations.get(front.locationId);
      if (!location?.ownerId) continue;

      const totalPower = Math.max(1, front.attackerPower + front.defenderPower);
      const edge = (front.attackerPower - front.defenderPower) / totalPower;
      const logisticsEdge = (front.attackerLogistics - front.defenderLogistics) / 100;
      const outcome = outcomeFromEdge(edge + logisticsEdge * 0.22);
      const existing = occupations[location.id];
      const ownerId = existing?.ownerId ?? location.ownerId;
      let progress = existing?.progress ?? 0;

      if (outcome === 'attacker-advance') {
        progress += days * (0.18 + Math.max(0, edge) * 0.95 + Math.max(0, logisticsEdge) * 0.28) * Math.max(0.35, front.intensity / 65);
      } else if (outcome === 'defender-hold') {
        progress -= days * (0.15 + Math.max(0, -edge) * 0.8 + Math.max(0, -logisticsEdge) * 0.22) * Math.max(0.3, front.intensity / 70);
      } else {
        progress += days * edge * 0.12;
      }

      progress = clamp(progress);
      let controllerId = existing?.controllerId ?? ownerId;
      if (progress >= 100) controllerId = war.attackerId;
      else if (progress <= 0) controllerId = ownerId;

      const previousBattleCount = existing?.battleCount ?? 0;
      const pulse = Math.floor(war.elapsedDays / 14);
      const crossedBattlePulse = pulse > previousBattleCount;
      const battleCount = crossedBattlePulse ? pulse : previousBattleCount;

      occupations[location.id] = {
        locationId: location.id,
        ownerId,
        controllerId,
        warId: war.id,
        progress,
        contested: progress > 0 && progress < 100,
        lastOutcome: outcome,
        battleCount,
        updatedAt: date,
      };

      if (crossedBattlePulse) {
        newBattles.push({
          id: `battle-${war.id}-${front.id}-${battleCount}`,
          warId: war.id,
          frontId: front.id,
          locationId: front.locationId,
          date,
          outcome,
          attackerPower: front.attackerPower,
          defenderPower: front.defenderPower,
          intensity: front.intensity,
          occupationProgress: progress,
        });
      }
    }
  }

  for (const war of warState.wars) {
    if (war.status !== 'ended' || war.victor !== 'defenders') continue;
    for (const [locationId, occupation] of Object.entries(occupations)) {
      if (occupation.warId !== war.id) continue;
      occupations[locationId] = {
        ...occupation,
        controllerId: occupation.ownerId,
        progress: 0,
        contested: false,
        lastOutcome: 'defender-hold',
        updatedAt: date,
      };
    }
  }

  return {
    occupations,
    battles: [...newBattles, ...state.battles].slice(0, 80),
  };
}

export function occupationForLocation(state: TerritorialControlState, locationId?: string) {
  return locationId ? state.occupations[locationId] : undefined;
}
