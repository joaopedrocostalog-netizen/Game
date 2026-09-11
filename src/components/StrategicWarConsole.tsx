import React from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { ArmyState } from '../engine/army';
import type { CasusBelliOption } from '../engine/casusBelli';
import type { MobilizationLevel, WarGoal, WarState } from '../engine/war';
import { CasusBelliPlanner } from './CasusBelliPlanner';
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
  onDeclareWar: (targetId: string, goal: WarGoal, casusBelli: CasusBelliOption) => boolean;
};

export function StrategicWarConsole(props: Props) {
  const entity = props.entities.find((item) => item.id === props.entityId) ?? props.entities[0];
  if (!entity) return null;
  return <div className="strategic-war-wrapper">
    <CasusBelliPlanner entity={entity} entities={props.entities} simulation={props.simulation} onDeclareWar={props.onDeclareWar}/>
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
