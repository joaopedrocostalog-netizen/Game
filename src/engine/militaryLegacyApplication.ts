import type { ArmyState } from './army';
import { militaryInstitutionalModifiers } from './militaryLegacy';
import type { WarState } from './war';

export type MilitaryLegacyApplicationState = { appliedKeys: string[] };
type LegacyApplicationGlobal = typeof globalThis & { __WORLD_STATE_MILITARY_LEGACY_APPLICATION__?: MilitaryLegacyApplicationState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function rootState(): MilitaryLegacyApplicationState {
  const root = globalThis as LegacyApplicationGlobal;
  if (!root.__WORLD_STATE_MILITARY_LEGACY_APPLICATION__) root.__WORLD_STATE_MILITARY_LEGACY_APPLICATION__ = { appliedKeys: [] };
  return root.__WORLD_STATE_MILITARY_LEGACY_APPLICATION__;
}

function publish(state: MilitaryLegacyApplicationState) {
  (globalThis as LegacyApplicationGlobal).__WORLD_STATE_MILITARY_LEGACY_APPLICATION__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-military-legacy-application', { detail: state }));
}

export function resetMilitaryLegacyApplication() {
  publish({ appliedKeys: [] });
}

export function applyMilitaryLegacyToActiveCampaigns(armyState: ArmyState, warState: WarState) {
  const state = rootState();
  const applied = new Set(state.appliedKeys);
  let changed = false;
  const units = armyState.units.map((unit) => {
    const war = warState.wars.find((item) => item.status === 'active' && (item.attackers.includes(unit.entityId) || item.defenders.includes(unit.entityId)));
    if (!war) return unit;
    const key = `${war.id}::${unit.id}`;
    if (applied.has(key)) return unit;
    applied.add(key);
    const modifier = militaryInstitutionalModifiers(unit.entityId);
    if (modifier.experience <= 0 && modifier.trauma <= 0) return unit;
    changed = true;
    return {
      ...unit,
      organization: clamp(unit.organization + modifier.organization),
      morale: clamp(unit.morale + modifier.morale),
      supply: clamp(unit.supply + modifier.supply),
      commander: {
        ...unit.commander,
        skill: clamp(unit.commander.skill + modifier.commanderSkill),
        logistics: clamp(unit.commander.logistics + modifier.commanderLogistics),
        initiative: clamp(unit.commander.initiative + modifier.commanderInitiative),
      },
    };
  });
  const appliedKeys = [...applied].slice(-500);
  if (appliedKeys.length !== state.appliedKeys.length || changed) publish({ appliedKeys });
  return { armyState: changed ? { ...armyState, units } : armyState, changed };
}
