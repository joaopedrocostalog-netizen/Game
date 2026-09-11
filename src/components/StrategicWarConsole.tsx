import React from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { ArmyState } from '../engine/army';
import type { MobilizationLevel, WarGoal, WarState } from '../engine/war';
import { CasusBelliPlanner } from './CasusBelliPlanner';
import { CrisisConferencePanel } from './CrisisConferencePanel';
import { CoalitionInterestsPanel } from './CoalitionInterestsPanel';
import { WarConsole } from './WarConsole';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
  onMobilize: (level: MobilizationLevel) => void;
  onDeclareWar: (targetId: string, goal: WarGoal) => void;
};

export function StrategicWarConsole(props: Props) {
  const entity = props.entities.find((item) => item.id === props.entityId) ?? props.entities[0];
  if (!entity) return null;
  return <div className="strategic-war-wrapper">
    <CasusBelliPlanner entity={entity} entities={props.entities} simulation={props.simulation} onMobilize={props.onMobilize} onDeclareWar={props.onDeclareWar}/>
    <CrisisConferencePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} onWarStateChange={props.onWarStateChange}/>
    <CoalitionInterestsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} territorialControl={props.territorialControl}/>
    <WarConsole
      entityId={props.entityId}
      entities={props.entities}
      simulation={props.simulation}
      warState={props.warState}
      armyState={props.armyState}
      territorialControl={props.territorialControl}
      onArmyStateChange={props.onArmyStateChange}
      onWarStateChange={props.onWarStateChange}
      onMobilize={props.onMobilize}
      onDeclareWar={() => undefined}
    />
  </div>;
}
