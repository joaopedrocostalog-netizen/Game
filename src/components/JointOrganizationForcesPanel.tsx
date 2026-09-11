import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import { organizationsForEntity } from '../engine/diplomaticOrganizations';
import {
  changeJointCommand,
  contributeFormation,
  createJointOrganizationForce,
  deployJointForce,
  forcesForOrganization,
  jointForceState,
  type JointCommandDoctrine,
} from '../engine/jointOrganizationForces';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './joint-organization-forces.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

const doctrineLabels: Record<JointCommandDoctrine, string> = {
  consensus: 'Comando por consenso',
  lead_nation: 'Nação líder',
  unified_command: 'Comando unificado',
};

export function JointOrganizationForcesPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const memberships = organizationsForEntity(entityId);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-joint-forces', refresh);
    return () => window.removeEventListener('world-state-joint-forces', refresh);
  }, []);

  void revision;
  const globalState = jointForceState();
  const visibleOrganizations = memberships.filter((organization) => ['security', 'stability', 'influence'].includes(organization.agenda) || organization.type !== 'commercial_bloc');
  if (!visibleOrganizations.length && !globalState.forces.some((force) => force.contributions.some((item) => item.memberId === entityId))) return null;

  function applySimulation(next: SimulationState) {
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.treaties.splice(0, simulation.treaties.length, ...next.treaties);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function create(organizationId: string, doctrine: JointCommandDoctrine) {
    const force = createJointOrganizationForce(organizationId, entityId, simulation, doctrine);
    setMessage(force ? `${force.name} foi criado. Agora os membros precisam destacar contingentes.` : 'Não foi possível criar o comando conjunto.');
    setRevision((value) => value + 1);
  }

  function contribute(forceId: string, memberId: string) {
    const result = contributeFormation(forceId, memberId, simulation, armyState);
    if (result.accepted) {
      applySimulation(result.simulation);
      onArmyStateChange(result.armyState);
    }
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function requestContributions(forceId: string, organizationId: string) {
    const organization = memberships.find((item) => item.id === organizationId);
    if (!organization || organization.leaderId !== entityId) return;
    let nextArmy = armyState;
    let nextSimulation = simulation;
    let accepted = 0;
    for (const memberId of organization.memberIds) {
      if (memberId === entityId) continue;
      const relation = simulation.diplomacy[[memberId, entityId].sort().join('::')];
      const willingness = 42 + organization.cohesion * .35 + (relation?.trust ?? 45) * .25 + (relation?.score ?? 0) * .15;
      if (willingness < 65) continue;
      const result = contributeFormation(forceId, memberId, nextSimulation, nextArmy);
      if (!result.accepted) continue;
      nextArmy = result.armyState;
      nextSimulation = result.simulation;
      accepted += 1;
    }
    if (accepted) {
      applySimulation(nextSimulation);
      onArmyStateChange(nextArmy);
    }
    setMessage(accepted ? `${accepted} membro(s) aceitaram destacar contingentes.` : 'Nenhum membro aceitou contribuir neste momento.');
    setRevision((value) => value + 1);
  }

  function deploy(forceId: string, warId: string, side: 'attackers' | 'defenders') {
    const result = deployJointForce(forceId, warId, side, simulation, armyState, warState);
    if (result.accepted) {
      applySimulation(result.simulation);
      onWarStateChange(result.warState);
      onArmyStateChange(result.armyState);
    }
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function changeCommand(forceId: string, commanderId: string, doctrine: JointCommandDoctrine) {
    const updated = changeJointCommand(forceId, entityId, commanderId, doctrine, simulation, armyState);
    setMessage(updated ? `Comando transferido para ${names[commanderId] ?? commanderId}.` : 'A liderança da organização não autorizou a mudança de comando.');
    setRevision((value) => value + 1);
  }

  return <div className="joint-force-panel">
    <div className="joint-force-heading">
      <span>FORÇAS MILITARES CONJUNTAS</span>
      <strong>Comando multinacional e contingentes expedicionários</strong>
    </div>

    {visibleOrganizations.map((organization) => {
      const force = forcesForOrganization(organization.id)[0];
      const isLeader = organization.leaderId === entityId;
      const activeWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.some((id) => organization.memberIds.includes(id)) || war.defenders.some((id) => organization.memberIds.includes(id))));
      if (!force) return <div className="joint-force-card forming" key={organization.id}>
        <div className="joint-force-card-head"><div><b>{organization.name}</b><span>Sem comando militar permanente</span></div><em>COESÃO {organization.cohesion.toFixed(0)}%</em></div>
        {isLeader ? <div className="joint-force-create-actions">
          <button onClick={() => create(organization.id, 'consensus')}>Criar por consenso</button>
          <button onClick={() => create(organization.id, 'lead_nation')}>Criar com nação líder</button>
          <button onClick={() => create(organization.id, 'unified_command')}>Criar comando unificado</button>
        </div> : <small>A liderança do bloco ainda não estabeleceu um comando multinacional.</small>}
      </div>;

      const contributed = force.contributions.some((item) => item.memberId === entityId);
      return <div className={`joint-force-card ${force.status}`} key={force.id}>
        <div className="joint-force-card-head">
          <div><b>{force.name}</b><span>{doctrineLabels[force.doctrine]} • {force.status}</span></div>
          <strong>{force.readiness.toFixed(0)}% PRONTIDÃO</strong>
        </div>

        <div className="joint-force-metrics">
          <span>Comandante <b>{names[force.commanderEntityId] ?? force.commanderEntityId}</b></span>
          <span>Coesão de comando <b>{force.commandCohesion.toFixed(0)}%</b></span>
          <span>Orçamento comum <b>{force.sharedBudget.toFixed(1)}</b></span>
          <span>Efetivo <b>{force.contributions.reduce((sum, item) => sum + item.personnel, 0).toLocaleString('pt-BR')}</b></span>
        </div>

        <div className="joint-force-contributions">
          {force.contributions.length ? force.contributions.map((item) => <div key={item.memberId}>
            <b>{names[item.memberId] ?? item.memberId}</b>
            <span>{item.personnel.toLocaleString('pt-BR')} militares</span>
            <em>apoio {item.politicalSupport.toFixed(0)}%</em>
          </div>) : <span className="joint-force-empty">Nenhum contingente destacado.</span>}
        </div>

        {!contributed && <button className="joint-force-primary" onClick={() => contribute(force.id, entityId)}>Destacar contingente nacional</button>}
        {isLeader && <div className="joint-force-leader-actions">
          <button onClick={() => requestContributions(force.id, organization.id)}>Solicitar contingentes aos membros</button>
          {organization.memberIds.map((memberId) => <button key={memberId} onClick={() => changeCommand(force.id, memberId, force.doctrine)}>Comando → {names[memberId] ?? memberId}</button>)}
        </div>}

        {activeWars.length > 0 && (force.status === 'ready' || force.status === 'deployed') && <div className="joint-force-deployments">
          <div className="context-kicker">Emprego operacional</div>
          {activeWars.map((war) => {
            const organizationOnAttack = war.attackers.some((id) => organization.memberIds.includes(id));
            const organizationOnDefense = war.defenders.some((id) => organization.memberIds.includes(id));
            return <div key={war.id} className="joint-war-row"><span>{war.name}</span><div>
              {organizationOnAttack && <button onClick={() => deploy(force.id, war.id, 'attackers')}>Destacar aos atacantes</button>}
              {organizationOnDefense && <button onClick={() => deploy(force.id, war.id, 'defenders')}>Destacar aos defensores</button>}
            </div></div>;
          })}
        </div>}
      </div>;
    })}

    {message && <div className="joint-force-message">{message}</div>}
    <small className="joint-force-note">Contingentes conjuntos são retirados de formações nacionais existentes. O efetivo permanece associado ao país de origem, portanto baixas, logística e responsabilidade política continuam rastreáveis por membro.</small>
  </div>;
}
