import type { ArmyState } from './army';
import { militaryInstitutionalModifiers } from './militaryLegacy';
import { militaryReformModifiers } from './peacetimeMilitaryReforms';
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
    const legacy = militaryInstitutionalModifiers(unit.entityId);
    const reform = militaryReformModifiers(unit.entityId);
    const hasInstitutionalEffects = legacy.experience > 0 || legacy.trauma > 0 || reform.reformCapacity > 0;
    if (!hasInstitutionalEffects) return unit;
    changed = true;
    return {
      ...unit,
      organization: clamp(unit.organization + legacy.organization + reform.organization),
      morale: clamp(unit.morale + legacy.morale + reform.morale),
      supply: clamp(unit.supply + legacy.supply + reform.supply),
      commander: {
        ...unit.commander,
        skill: clamp(unit.commander.skill + legacy.commanderSkill + reform.commanderSkill),
        logistics: clamp(unit.commander.logistics + legacy.commanderLogistics + reform.commanderLogistics),
        initiative: clamp(unit.commander.initiative + legacy.commanderInitiative + reform.commanderInitiative),
      },
    };
  });
  const appliedKeys = [...applied].slice(-500);
  if (appliedKeys.length !== state.appliedKeys.length || changed) publish({ appliedKeys });
  return { armyState: changed ? { ...armyState, units } : armyState, changed };
}
