import React from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { ArmyState } from '../engine/army';
import type { MobilizationLevel, WarGoal, WarState } from '../engine/war';
import { CasusBelliPlanner } from './CasusBelliPlanner';
import { CrisisConferencePanel } from './CrisisConferencePanel';
import { CoalitionInterestsPanel } from './CoalitionInterestsPanel';
import { CoalitionPoliticsPanel } from './CoalitionPoliticsPanel';
import { AllianceCommandPanel } from './AllianceCommandPanel';
import { PostWarConferencePanel } from './PostWarConferencePanel';
import { PostWarDisputePanel } from './PostWarDisputePanel';
import { GeopoliticalAlignmentPanel } from './GeopoliticalAlignmentPanel';
import { DiplomaticOrganizationsPanel } from './DiplomaticOrganizationsPanel';
import { OrganizationObligationsPanel } from './OrganizationObligationsPanel';
import { JointOrganizationForcesPanel } from './JointOrganizationForcesPanel';
import { MultinationalTheaterCommandPanel } from './MultinationalTheaterCommandPanel';
import { OperationalCampaignPlansPanel } from './OperationalCampaignPlansPanel';
import { MilitaryIntelligencePanel } from './MilitaryIntelligencePanel';
import { InformationWarfarePanel } from './InformationWarfarePanel';
import { AdaptiveEnemyCommandPanel } from './AdaptiveEnemyCommandPanel';
import { MilitaryLegacyPanel } from './MilitaryLegacyPanel';
import { PeacetimeMilitaryReformsPanel } from './PeacetimeMilitaryReformsPanel';
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
    <GeopoliticalAlignmentPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation}/>
    <DiplomaticOrganizationsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation}/>
    <OrganizationObligationsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} onWarStateChange={props.onWarStateChange}/>
    <JointOrganizationForcesPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <MultinationalTheaterCommandPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <InformationWarfarePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onWarStateChange={props.onWarStateChange}/>
    <MilitaryIntelligencePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState}/>
    <AdaptiveEnemyCommandPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} territorialControl={props.territorialControl} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <MilitaryLegacyPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} territorialControl={props.territorialControl} onArmyStateChange={props.onArmyStateChange}/>
    <PeacetimeMilitaryReformsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange}/>
    <OperationalCampaignPlansPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <CasusBelliPlanner entity={entity} entities={props.entities} simulation={props.simulation} onMobilize={props.onMobilize} onDeclareWar={props.onDeclareWar}/>
    <CrisisConferencePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} onWarStateChange={props.onWarStateChange}/>
    <PostWarDisputePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation}/>
    <CoalitionInterestsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} territorialControl={props.territorialControl}/>
    <CoalitionPoliticsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} territorialControl={props.territorialControl} onWarStateChange={props.onWarStateChange}/>
    <AllianceCommandPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} territorialControl={props.territorialControl} onWarStateChange={props.onWarStateChange}/>
    <PostWarConferencePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} territorialControl={props.territorialControl}/>
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
