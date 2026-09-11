import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import { organizationsForEntity } from '../engine/diplomaticOrganizations';
import { forcesForOrganization } from '../engine/jointOrganizationForces';
import {
  applyTheaterPlan,
  createMultinationalTheaterHQ,
  headquartersForForce,
  requestContingentWithdrawal,
  setNationalCaveat,
  setTheaterPosture,
  theaterCommandState,
  updateFrontPlan,
  type NationalCaveat,
  type TheaterPosture,
} from '../engine/multinationalTheaterCommand';
import type { SimulationState } from '../engine/simulation';
import type { FrontOrder, FrontPriority, WarState } from '../engine/war';
import './multinational-theater-command.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

const postureLabels: Record<TheaterPosture, string> = {
  defensive: 'Defensiva',
  balanced: 'Equilibrada',
  offensive: 'Ofensiva',
  breakthrough: 'Ruptura',
};

const caveatLabels: Record<NationalCaveat, string> = {
  full_authority: 'Autoridade total',
  limited_offensive: 'Ofensiva limitada',
  defensive_only: 'Somente defesa',
  national_reserve: 'Reserva nacional',
  withdrawal_requested: 'Retirada solicitada',
};

const priorities: FrontPriority[] = ['low', 'normal', 'high', 'main'];
const orders: FrontOrder[] = ['defend', 'cautious', 'offensive', 'breakthrough', 'reserve', 'withdraw'];

export function MultinationalTheaterCommandPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const memberships = organizationsForEntity(entityId);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-theater-hq', refresh);
    window.addEventListener('world-state-joint-forces', refresh);
    return () => {
      window.removeEventListener('world-state-theater-hq', refresh);
      window.removeEventListener('world-state-joint-forces', refresh);
    };
  }, []);

  void revision;
  void theaterCommandState();

  function applySimulation(next: SimulationState) {
    Object.assign(simulation.entities, next.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, next.diplomacy);
    simulation.treaties.splice(0, simulation.treaties.length, ...next.treaties);
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function createHQ(forceId: string, warId: string) {
    const hq = createMultinationalTheaterHQ(forceId, warId, simulation, warState);
    setMessage(hq ? 'Quartel-general multinacional estabelecido para este teatro.' : 'A força precisa estar destacada para uma guerra antes de criar o quartel-general.');
    setRevision((value) => value + 1);
  }

  function changePosture(hqId: string, posture: TheaterPosture) {
    const hq = setTheaterPosture(hqId, posture);
    setMessage(hq ? `Postura do teatro alterada para ${postureLabels[posture]}.` : 'Não foi possível alterar a postura.');
    setRevision((value) => value + 1);
  }

  function changeCaveat(hqId: string, memberId: string, caveat: NationalCaveat) {
    const updated = setNationalCaveat(hqId, memberId, caveat, simulation);
    setMessage(updated ? `${names[memberId] ?? memberId}: ${caveatLabels[caveat]}.` : 'Restrição nacional não pôde ser registrada.');
    setRevision((value) => value + 1);
  }

  function changeFront(hqId: string, frontId: string, priority: FrontPriority, order: FrontOrder, objective: string) {
    updateFrontPlan(hqId, frontId, priority, order, objective);
    setMessage('Diretriz de frente atualizada. Aplique o plano para emitir as ordens às formações.');
    setRevision((value) => value + 1);
  }

  function applyPlan(hqId: string) {
    const result = applyTheaterPlan(hqId, simulation, armyState, warState);
    if (result.accepted) {
      applySimulation(result.simulation);
      onWarStateChange(result.warState);
      onArmyStateChange(result.armyState);
    }
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function withdraw(hqId: string, memberId: string) {
    const result = requestContingentWithdrawal(hqId, memberId, simulation, armyState, warState);
    if (result.accepted) {
      applySimulation(result.simulation);
      onWarStateChange(result.warState);
      onArmyStateChange(result.armyState);
    }
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  const rows = memberships.flatMap((organization) => forcesForOrganization(organization.id).map((force) => ({ organization, force })));
  if (!rows.length) return null;

  return <div className="theater-command-panel">
    <div className="theater-command-heading">
      <span>QUARTÉIS-GENERAIS MULTINACIONAIS</span>
      <strong>Cadeia de comando, planos por frente e soberania nacional</strong>
    </div>

    {rows.map(({ organization, force }) => {
      const hq = headquartersForForce(force.id)[0];
      const war = force.deployedWarId ? warState.wars.find((item) => item.id === force.deployedWarId) : undefined;
      if (!hq) return <div className="theater-command-card forming" key={force.id}>
        <div className="theater-command-card-head">
          <div><b>{force.name}</b><span>{force.status === 'deployed' ? 'Destacada, porém sem HQ de teatro' : 'Aguardando emprego operacional'}</span></div>
          <em>{force.commandCohesion.toFixed(0)}% coesão</em>
        </div>
        {force.status === 'deployed' && war ? <button onClick={() => createHQ(force.id, war.id)}>Estabelecer quartel-general de teatro</button> : <small>O comando de teatro é criado depois que a força conjunta é empregada em uma guerra.</small>}
      </div>;

      const isOrganizationLeader = organization.leaderId === entityId;
      const isCommanderNation = hq.commanderEntityId === entityId;
      const canDirect = isOrganizationLeader || isCommanderNation;
      const currentWar = warState.wars.find((item) => item.id === hq.warId);
      return <div className="theater-command-card" key={hq.id}>
        <div className="theater-command-card-head">
          <div><b>{force.name}</b><span>{currentWar?.name ?? hq.warId} • lado {hq.side === 'attackers' ? 'atacante' : 'defensor'}</span></div>
          <strong>{hq.coordination.toFixed(0)}% COORDENAÇÃO</strong>
        </div>

        <div className="theater-command-metrics">
          <span>Comando <b>{names[hq.commanderEntityId] ?? hq.commanderEntityId}</b></span>
          <span>Autoridade <b>{hq.authority.toFixed(0)}%</b></span>
          <span>Postura <b>{postureLabels[hq.posture]}</b></span>
          <span>Disputas <b>{hq.disputes.filter((item) => !item.resolved).length}</b></span>
        </div>

        {canDirect && <div className="theater-posture-actions">
          {(Object.keys(postureLabels) as TheaterPosture[]).map((posture) => <button className={hq.posture === posture ? 'active' : ''} key={posture} onClick={() => changePosture(hq.id, posture)}>{postureLabels[posture]}</button>)}
        </div>}

        <div className="theater-front-plans">
          {hq.frontPlans.map((plan) => {
            const front = currentWar?.fronts.find((item) => item.id === plan.frontId);
            return <div className="theater-front-row" key={plan.frontId}>
              <div><b>{front?.name ?? plan.frontId}</b><span>{plan.objective}</span></div>
              <div className="theater-front-selects">
                <select value={plan.priority} disabled={!canDirect} onChange={(event) => changeFront(hq.id, plan.frontId, event.target.value as FrontPriority, plan.order, plan.objective)}>{priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select>
                <select value={plan.order} disabled={!canDirect} onChange={(event) => changeFront(hq.id, plan.frontId, plan.priority, event.target.value as FrontOrder, plan.objective)}>{orders.map((order) => <option key={order} value={order}>{order}</option>)}</select>
              </div>
              <em>{plan.assignedUnitIds.length} formação(ões) conjuntas</em>
            </div>;
          })}
        </div>

        <div className="theater-national-caveats">
          <div className="context-kicker">Autoridade nacional sobre contingentes</div>
          {hq.restrictions.map((restriction) => {
            const self = restriction.memberId === entityId;
            const canChange = self || isOrganizationLeader;
            return <div className={`theater-caveat-row ${restriction.caveat}`} key={restriction.memberId}>
              <div><b>{names[restriction.memberId] ?? restriction.memberId}</b><span>{caveatLabels[restriction.caveat]} • pressão {restriction.politicalPressure.toFixed(0)}%</span></div>
              {canChange && <select value={restriction.caveat} onChange={(event) => changeCaveat(hq.id, restriction.memberId, event.target.value as NationalCaveat)}>
                {(Object.keys(caveatLabels) as NationalCaveat[]).map((caveat) => <option key={caveat} value={caveat}>{caveatLabels[caveat]}</option>)}
              </select>}
              {self && restriction.caveat !== 'withdrawal_requested' && <button className="danger" onClick={() => withdraw(hq.id, restriction.memberId)}>Retirar contingente das frentes</button>}
            </div>;
          })}
        </div>

        {hq.disputes.filter((item) => !item.resolved).slice(0, 4).map((dispute) => <div className="theater-dispute" key={dispute.id}>
          <b>CONFLITO DE COMANDO • {names[dispute.memberId] ?? dispute.memberId}</b>
          <span>{dispute.reason}</span>
          <em>gravidade {dispute.severity.toFixed(0)}%</em>
        </div>)}

        {canDirect && <button className="theater-apply-plan" onClick={() => applyPlan(hq.id)}>Aplicar plano operacional às frentes</button>}
      </div>;
    })}

    {message && <div className="theater-command-message">{message}</div>}
    <small className="theater-command-note">O quartel-general não cria tropas novas: ele distribui as formações expedicionárias já existentes. Governos nacionais podem limitar ofensivas, colocar tropas em reserva ou retirar seus contingentes, reduzindo a coordenação do comando conjunto.</small>
  </div>;
}
