import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import { applyMilitaryLegacyToActiveCampaigns } from '../engine/militaryLegacyApplication';
import { formationExperienceFor, militaryInstitutionFor, processMilitaryLegacy } from '../engine/militaryLegacy';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './military-legacy.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
};

const veteranLabels = { green: 'Novata', seasoned: 'Experiente', veteran: 'Veterana', elite: 'Elite' } as const;

export function MilitaryLegacyPanel({ entityId, entities, simulation, armyState, warState, territorialControl, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-military-legacy', refresh);
    return () => window.removeEventListener('world-state-military-legacy', refresh);
  }, []);

  useEffect(() => {
    const learned = processMilitaryLegacy(simulation, armyState, warState, territorialControl);
    let nextArmy = learned.armyState;
    const applied = applyMilitaryLegacyToActiveCampaigns(nextArmy, warState);
    nextArmy = applied.armyState;
    if (learned.changed) {
      simulation.events.splice(0, simulation.events.length, ...learned.simulation.events);
    }
    if (learned.changed || applied.changed) onArmyStateChange(nextArmy);
    if (learned.changed || applied.changed) setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState.wars]);

  void revision;
  const institution = militaryInstitutionFor(entityId);
  const units = armyState.units.filter((unit) => unit.entityId === entityId);
  if (!institution.warsFought && !units.some((unit) => formationExperienceFor(unit.id))) return null;

  return <div className="military-legacy-panel">
    <div className="military-legacy-heading">
      <span>MEMÓRIA MILITAR</span>
      <strong>Experiência institucional entre guerras</strong>
    </div>

    <div className="military-legacy-metrics">
      <span>Guerras <b>{institution.warsFought}</b></span>
      <span>Vitórias <b>{institution.victories}</b></span>
      <span>Experiência <b>{institution.institutionalExperience.toFixed(0)}%</b></span>
      <span>Trauma <b>{institution.warTrauma.toFixed(0)}%</b></span>
      <span>Logística <b>{institution.logisticsTradition.toFixed(0)}%</b></span>
      <span>Comando <b>{institution.commandCulture.toFixed(0)}%</b></span>
    </div>

    {institution.lastLesson && <div className="military-legacy-lesson">{institution.lastLesson}</div>}

    <div className="military-legacy-traditions">
      <span>Tradição ofensiva <b>{institution.offensiveTradition.toFixed(0)}%</b></span>
      <span>Tradição defensiva <b>{institution.defensiveTradition.toFixed(0)}%</b></span>
      <span>Resiliência <b>{institution.resilience.toFixed(0)}%</b></span>
    </div>

    {units.some((unit) => formationExperienceFor(unit.id)) && <div className="military-legacy-formations">
      {units.map((unit) => {
        const experience = formationExperienceFor(unit.id);
        if (!experience) return null;
        return <div className="military-legacy-unit" key={unit.id}>
          <div><b>{unit.name}</b><span>{names[unit.entityId] ?? unit.entityId} • {experience.campaigns} campanha(s)</span></div>
          <strong>{veteranLabels[experience.veteranStatus]} · {experience.experience.toFixed(0)}%</strong>
        </div>;
      })}
    </div>}

    <small>A memória institucional persiste mesmo após perdas e reformas. Ao entrar em uma nova guerra, as formações recebem uma única preparação baseada nas lições acumuladas; trauma elevado pode reduzir parte desse benefício.</small>
  </div>;
}
