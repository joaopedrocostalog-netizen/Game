import { locationsForEntity, locationsForYear, type ResolvedLocation } from '../data/territories';
import type { SimulationState } from './simulation';
import type { FrontOrder, FrontSide, War, WarState } from './war';
import type { TerritorialControlState } from './territorialControl';

export type UnitType = 'field-army' | 'garrison' | 'mobile-corps';
export type UnitOrder = 'hold' | 'move' | 'prepare' | 'retreat';

export type Commander = {
  id: string;
  name: string;
  skill: number;
  logistics: number;
  initiative: number;
};

export type ArmyUnit = {
  id: string;
  entityId: string;
  name: string;
  type: UnitType;
  commander: Commander;
  locationId: string;
  destinationId?: string;
  order: UnitOrder;
  personnel: number;
  strength: number;
  morale: number;
  organization: number;
  supply: number;
  equipment: number;
  movementProgress: number;
};

export type ArmyState = {
  units: ArmyUnit[];
  lastElapsedDay: number;
};

export type SupplyLineStatus = {
  sourceLocationId?: string;
  distanceKm: number;
  efficiency: number;
  state: 'connected' | 'strained' | 'broken';
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function commander(entityId: string, index: number): Commander {
  const seed = hash(`${entityId}:commander:${index}`);
  return {
    id: `${entityId}-cmd-${index}`,
    name: index === 0 ? 'Comandante do Exército Principal' : index === 1 ? 'Comandante da Reserva' : 'Comandante Regional',
    skill: 42 + (seed % 35),
    logistics: 38 + ((seed >> 5) % 40),
    initiative: 36 + ((seed >> 10) % 43),
  };
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

export function createInitialArmyState(): ArmyState {
  return { units: [], lastElapsedDay: 0 };
}

export function ensureEntityForces(state: ArmyState, simulation: SimulationState, entityId: string, year: number): ArmyState {
  if (!simulation.entities[entityId] || state.units.some((unit) => unit.entityId === entityId)) return state;
  const owned = locationsForEntity(entityId, year);
  if (!owned.length) return state;
  const runtime = simulation.entities[entityId];
  const count = Math.max(1, Math.min(3, Math.ceil(runtime.militaryReadiness / 32)));
  const units: ArmyUnit[] = Array.from({ length: count }, (_, index) => {
    const location = owned[index % owned.length];
    const cmd = commander(entityId, index);
    const basePersonnel = 9000 + Math.round(runtime.militaryReadiness * 170) + index * 2200;
    return {
      id: `${entityId}-army-${index + 1}`,
      entityId,
      name: index === 0 ? 'Exército Principal' : index === 1 ? 'Força de Reserva' : 'Comando Regional',
      type: index === 0 ? 'field-army' : index === 1 ? 'garrison' : 'mobile-corps',
      commander: cmd,
      locationId: location.id,
      order: 'hold',
      personnel: basePersonnel,
      strength: clamp(runtime.militaryReadiness * .82 + runtime.technology * .18),
      morale: clamp(52 + runtime.stability * .34),
      organization: clamp(46 + cmd.skill * .38 + runtime.technology * .18),
      supply: clamp(48 + runtime.treasuryIndex * .46),
      equipment: clamp(44 + runtime.technology * .52),
      movementProgress: 0,
    };
  });
  return { ...state, units: [...state.units, ...units], lastElapsedDay: simulation.elapsedDays };
}

export function issueMove(state: ArmyState, unitId: string, destinationId: string): ArmyState {
  if (!destinationId) return state;
  return {
    ...state,
    units: state.units.map((unit) => unit.id === unitId ? { ...unit, destinationId, order: 'move', movementProgress: 0 } : unit),
  };
}

export function setUnitOrder(state: ArmyState, unitId: string, order: UnitOrder): ArmyState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === unitId ? {
      ...unit,
      order,
      destinationId: order === 'move' || order === 'retreat' ? unit.destinationId : undefined,
      movementProgress: order === 'move' || order === 'retreat' ? unit.movementProgress : 0,
    } : unit),
  };
}

function effectiveController(location: ResolvedLocation, control?: TerritorialControlState) {
  return control?.occupations[location.id]?.controllerId ?? location.controllerId ?? location.ownerId;
}

export function supplyLineForUnit(unit: ArmyUnit, year: number, control?: TerritorialControlState): SupplyLineStatus {
  const all = locationsForYear(year);
  const current = all.find((location) => location.id === unit.locationId);
  const sources = all.filter((location) => location.ownerId === unit.entityId && effectiveController(location, control) === unit.entityId);
  if (!current || !sources.length) return { distanceKm: 9999, efficiency: .2, state: 'broken' };
  const ranked = sources
    .map((source) => ({ source, distance: distanceKm(current, source) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  const commandBonus = unit.commander.logistics / 100;
  let efficiency = 1;
  if (nearest.distance > 600) efficiency = .88;
  if (nearest.distance > 1400) efficiency = .68;
  if (nearest.distance > 2800) efficiency = .48;
  if (nearest.distance > 5000) efficiency = .28;
  efficiency = clamp((efficiency + commandBonus * .18) * 100) / 100;
  return {
    sourceLocationId: nearest.source.id,
    distanceKm: nearest.distance,
    efficiency,
    state: efficiency < .4 ? 'broken' : efficiency < .7 ? 'strained' : 'connected',
  };
}

export function simulateArmyToElapsed(
  state: ArmyState,
  simulation: SimulationState,
  activeWarEntities: Set<string>,
  control?: TerritorialControlState,
): ArmyState {
  const days = Math.max(0, simulation.elapsedDays - state.lastElapsedDay);
  if (!days) return state;
  const units = state.units.map((unit) => {
    const runtime = simulation.entities[unit.entityId];
    if (!runtime) return unit;
    const atWar = activeWarEntities.has(unit.entityId);
    const commandFactor = (unit.commander.logistics + unit.commander.skill) / 200;
    const fiscalFactor = runtime.treasuryIndex / 100;
    const supplyLine = supplyLineForUnit(unit, simulation.date.year, control);
    let supply = unit.supply;
    let organization = unit.organization;
    let morale = unit.morale;
    let strength = unit.strength;
    let equipment = unit.equipment;
    let movementProgress = unit.movementProgress;
    let locationId = unit.locationId;
    let destinationId = unit.destinationId;
    let order = unit.order;

    if ((order === 'move' || order === 'retreat') && destinationId) {
      const retreatBoost = order === 'retreat' ? 1.35 : 1;
      movementProgress += days * (1.15 + unit.commander.initiative / 85) * Math.max(.38, supply / 100) * retreatBoost;
      supply -= days * (order === 'retreat' ? .12 : .085);
      organization -= days * (order === 'retreat' ? .065 : .035);
      morale -= days * (order === 'retreat' ? .055 : .008);
      if (movementProgress >= 100) {
        locationId = destinationId;
        destinationId = undefined;
        movementProgress = 0;
        order = 'hold';
        organization += 4;
      }
    } else if (order === 'prepare') {
      organization += days * .055 * commandFactor;
      supply += days * .04 * fiscalFactor * supplyLine.efficiency;
      morale += days * .018;
    } else {
      supply += days * .025 * fiscalFactor * supplyLine.efficiency;
      organization += days * .018 * commandFactor;
    }

    if (atWar) {
      const linePenalty = 1 + (1 - supplyLine.efficiency) * 1.4;
      supply -= days * .055 * linePenalty;
      organization -= days * .028 * linePenalty;
      morale -= days * .012 * linePenalty;
      equipment -= days * .009 * linePenalty;
      if (supply < 30) strength -= days * .018 * linePenalty;
    }

    return {
      ...unit,
      locationId,
      destinationId,
      order,
      movementProgress: clamp(movementProgress),
      supply: clamp(supply),
      organization: clamp(organization),
      morale: clamp(morale),
      strength: clamp(strength),
      equipment: clamp(equipment),
    };
  });
  return { units, lastElapsedDay: simulation.elapsedDays };
}

function nearestFriendlyRetreat(unit: ArmyUnit, year: number, control?: TerritorialControlState, avoidLocationId?: string) {
  const locations = locationsForYear(year);
  const current = locations.find((location) => location.id === unit.locationId);
  const options = locations
    .filter((location) => location.id !== avoidLocationId && location.ownerId === unit.entityId && effectiveController(location, control) === unit.entityId)
    .map((location) => ({ location, distance: distanceKm(current, location) }))
    .sort((a, b) => a.distance - b.distance);
  return options[0]?.location;
}

function sideForUnit(unit: ArmyUnit, war: War): FrontSide | null {
  if (war.attackers.includes(unit.entityId)) return 'attacker';
  if (war.defenders.includes(unit.entityId)) return 'defender';
  return null;
}

function explicitFrontForUnit(unit: ArmyUnit, war: War, side: FrontSide) {
  return war.fronts.find((front) => (side === 'attacker' ? front.attackerAssignments : front.defenderAssignments).includes(unit.id));
}

function priorityBias(priority: 'low' | 'normal' | 'high' | 'main') {
  if (priority === 'main') return 900;
  if (priority === 'high') return 420;
  if (priority === 'low') return -260;
  return 0;
}

function assignedFrontIdForUnit(unit: ArmyUnit, war: War, locations: Map<string, ResolvedLocation>) {
  const side = sideForUnit(unit, war);
  if (!side) return undefined;
  const manual = explicitFrontForUnit(unit, war, side);
  if (manual) return manual.id;
  const current = locations.get(unit.locationId);
  const ranked = war.fronts
    .filter((front) => front.locationId)
    .map((front) => {
      const priority = side === 'attacker' ? front.attackerPriority : front.defenderPriority;
      return { front, score: distanceKm(current, locations.get(front.locationId!)) - priorityBias(priority) };
    })
    .sort((a, b) => a.score - b.score || a.front.id.localeCompare(b.front.id));
  return ranked[0]?.front.id;
}

function operationForSide(front: War['fronts'][number], side: FrontSide): FrontOrder {
  return side === 'attacker' ? front.attackerOrder : front.defenderOrder;
}

function formationExposure(order: FrontOrder) {
  if (order === 'defend') return .78;
  if (order === 'cautious') return .82;
  if (order === 'offensive') return 1.15;
  if (order === 'breakthrough') return 1.36;
  if (order === 'reserve') return .38;
  return .52;
}

function formationConsumption(order: FrontOrder) {
  if (order === 'defend') return .75;
  if (order === 'cautious') return .82;
  if (order === 'offensive') return 1.2;
  if (order === 'breakthrough') return 1.55;
  if (order === 'reserve') return .42;
  return .68;
}

function beginOrganizedWithdrawal(unit: ArmyUnit, year: number, control: TerritorialControlState, frontLocationId: string) {
  if (unit.order === 'retreat') return unit;
  const fallback = nearestFriendlyRetreat(unit, year, control, frontLocationId);
  if (!fallback) return { ...unit, organization: clamp(unit.organization - 4), morale: clamp(unit.morale - 3) };
  return {
    ...unit,
    destinationId: fallback.id,
    order: 'retreat' as const,
    movementProgress: Math.max(6, unit.movementProgress),
    organization: clamp(unit.organization - 4),
    morale: clamp(unit.morale - 2),
  };
}

export function applyBattleConsequences(
  state: ArmyState,
  warState: WarState,
  simulation: SimulationState,
  control: TerritorialControlState,
  days: number,
): ArmyState {
  if (days <= 0) return state;
  const locations = new Map(locationsForYear(simulation.date.year).map((location) => [location.id, location]));
  let units = state.units.map((unit) => ({ ...unit }));

  for (const war of warState.wars) {
    if (war.status !== 'active') continue;
    for (const front of war.fronts) {
      if (!front.locationId || front.intensity < 8) continue;
      const frontLocation = locations.get(front.locationId);
      if (!frontLocation) continue;
      const occupation = control.occupations[front.locationId];
      const attackerIds = new Set(war.attackers);
      const defenderIds = new Set(war.defenders);
      const total = Math.max(1, front.attackerPower + front.defenderPower);
      const attackerPressure = front.defenderPower / total;
      const defenderPressure = front.attackerPower / total;

      units = units.map((unit) => {
        const side = sideForUnit(unit, war);
        if (!side || assignedFrontIdForUnit(unit, war, locations) !== front.id) return unit;
        const unitLocation = locations.get(unit.locationId);
        const distance = distanceKm(unitLocation, frontLocation);
        if (distance > 1800) return unit;

        const operation = operationForSide(front, side);
        if (operation === 'withdraw' && distance <= 900) {
          return beginOrganizedWithdrawal(unit, simulation.date.year, control, front.locationId!);
        }

        const participation = distance < 300 ? 1 : distance < 800 ? .72 : .42;
        const pressure = side === 'attacker' ? attackerPressure : defenderPressure;
        const logistics = side === 'attacker' ? front.attackerLogistics : front.defenderLogistics;
        const exposure = participation * (front.intensity / 100) * (0.65 + pressure) * (1.2 - logistics / 250) * formationExposure(operation);
        const casualtyRate = clamp(days * exposure * .00075, 0, .18);
        const consumption = formationConsumption(operation) * participation * Math.max(.15, front.intensity / 100);
        const personnel = Math.max(0, Math.round(unit.personnel * (1 - casualtyRate)));
        const strengthLoss = casualtyRate * 120;
        const moraleLoss = casualtyRate * 95;
        const organizationLoss = casualtyRate * 110 + days * consumption * .018;
        const equipmentLoss = casualtyRate * 70 + days * consumption * .012;
        const supplyLoss = days * consumption * .045;
        return {
          ...unit,
          personnel,
          strength: clamp(unit.strength - strengthLoss),
          morale: clamp(unit.morale - moraleLoss),
          organization: clamp(unit.organization - organizationLoss),
          equipment: clamp(unit.equipment - equipmentLoss),
          supply: clamp(unit.supply - supplyLoss),
        };
      });

      if (occupation?.progress >= 100) {
        units = units.map((unit) => {
          if (!defenderIds.has(unit.entityId) || unit.locationId !== front.locationId || unit.order === 'retreat') return unit;
          const fallback = nearestFriendlyRetreat(unit, simulation.date.year, control, front.locationId);
          if (!fallback) return { ...unit, morale: clamp(unit.morale - 18), organization: clamp(unit.organization - 22) };
          return {
            ...unit,
            destinationId: fallback.id,
            order: 'retreat',
            movementProgress: 8,
            morale: clamp(unit.morale - 12),
            organization: clamp(unit.organization - 16),
          };
        });
      } else if (occupation?.progress === 0 && occupation.lastOutcome === 'defender-hold') {
        units = units.map((unit) => {
          if (!attackerIds.has(unit.entityId) || unit.locationId !== front.locationId || unit.order === 'retreat') return unit;
          const fallback = nearestFriendlyRetreat(unit, simulation.date.year, control, front.locationId);
          if (!fallback) return unit;
          return { ...unit, destinationId: fallback.id, order: 'retreat', movementProgress: 8, morale: clamp(unit.morale - 8), organization: clamp(unit.organization - 12) };
        });
      }
    }
  }

  units = units.filter((unit) => unit.personnel > 200 && unit.strength > 3);
  return { ...state, units };
}

export function forcesForEntity(state: ArmyState, entityId: string) {
  return state.units.filter((unit) => unit.entityId === entityId);
}

export function logisticsScore(state: ArmyState, entityId: string) {
  const units = forcesForEntity(state, entityId);
  if (!units.length) return 0;
  return units.reduce((sum, unit) => sum + unit.supply * .42 + unit.organization * .28 + unit.equipment * .18 + unit.commander.logistics * .12, 0) / units.length;
}