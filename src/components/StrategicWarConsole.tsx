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
import { StrategicResourcesPanel } from './StrategicResourcesPanel';
import { TradePressurePanel } from './TradePressurePanel';
import { NavalForcesPanel } from './NavalForcesPanel';
import { NavalWarfarePanel } from './NavalWarfarePanel';
import { AmphibiousOperationsPanel } from './AmphibiousOperationsPanel';
import { BeachheadLogisticsPanel } from './BeachheadLogisticsPanel';
import { AirCampaignPanel } from './AirCampaignPanel';
import { AirBaseNetworkPanel } from './AirBaseNetworkPanel';
import { AirfieldInfrastructurePanel } from './AirfieldInfrastructurePanel';
import { AirborneOperationsPanel } from './AirborneOperationsPanel';
import { AirborneLogisticsPanel } from './AirborneLogisticsPanel';
import { AirIndustryPanel } from './AirIndustryPanel';
import { AirDoctrinePanel } from './AirDoctrinePanel';
import { AirDefenseNetworkPanel } from './AirDefenseNetworkPanel';
import { AirWarfarePanel } from './AirWarfarePanel';
import { StrategicInfrastructurePanel } from './StrategicInfrastructurePanel';
import { WartimeEconomyPanel } from './WartimeEconomyPanel';
import { NationalMoralePanel } from './NationalMoralePanel';
import { WarPoliticsPanel } from './WarPoliticsPanel';
import { CivilConflictPanel } from './CivilConflictPanel';
import { EmergentStatehoodPanel } from './EmergentStatehoodPanel';
import { MilitaryIndustryPanel } from './MilitaryIndustryPanel';
import { WarConsole } from './WarConsole';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onSimulationStateChange?: (state: SimulationState) => void;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
  onMobilize: (level: MobilizationLevel) => void;
  onDeclareWar: (targetId: string, goal: WarGoal) => void;
};

export function StrategicWarConsole(props: Props) {
  const entity = props.entities.find((item) => item.id === props.entityId) ?? props.entities[0];
  if (!entity) return null;
  const applySimulationState = props.onSimulationStateChange ?? ((next: SimulationState) => { Object.assign(props.simulation, next); });
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
    <StrategicResourcesPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <TradePressurePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <NavalForcesPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <NavalWarfarePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <AirCampaignPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} onArmyStateChange={props.onArmyStateChange}/>
    <AirBaseNetworkPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <AirfieldInfrastructurePanel entityId={props.entityId} simulation={props.simulation} territorialControl={props.territorialControl}/>
    <AirborneOperationsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} territorialControl={props.territorialControl} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <AirborneLogisticsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} territorialControl={props.territorialControl} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <AirIndustryPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <AirDoctrinePanel entityId={props.entityId} simulation={props.simulation}/>
    <AirDefenseNetworkPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <AirWarfarePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState}/>
    <StrategicInfrastructurePanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} onArmyStateChange={props.onArmyStateChange}/>
    <WartimeEconomyPanel entityId={props.entityId} simulation={props.simulation} warState={props.warState} armyState={props.armyState} onSimulationStateChange={applySimulationState} onArmyStateChange={props.onArmyStateChange}/>
    <NationalMoralePanel entityId={props.entityId} simulation={props.simulation} warState={props.warState} armyState={props.armyState} onSimulationStateChange={applySimulationState}/>
    <WarPoliticsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} onSimulationStateChange={applySimulationState} onWarStateChange={props.onWarStateChange} onArmyStateChange={props.onArmyStateChange}/>
    <CivilConflictPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} warState={props.warState} armyState={props.armyState} territorialControl={props.territorialControl} onSimulationStateChange={applySimulationState} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <EmergentStatehoodPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} territorialControl={props.territorialControl} onSimulationStateChange={applySimulationState}/>
    <AmphibiousOperationsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <BeachheadLogisticsPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} territorialControl={props.territorialControl} onArmyStateChange={props.onArmyStateChange} onWarStateChange={props.onWarStateChange}/>
    <MilitaryIndustryPanel entityId={props.entityId} entities={props.entities} simulation={props.simulation} armyState={props.armyState} warState={props.warState} onArmyStateChange={props.onArmyStateChange}/>
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
