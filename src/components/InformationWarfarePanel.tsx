import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  createStrategicDeceptionPlan,
  deceptionPlansForEntity,
  incidentsForEntity,
  informationWarfareState,
  processInformationWarfare,
  setOperationalSecurity,
  type OperationalSecurityPosture,
} from '../engine/informationWarfare';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './information-warfare.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onWarStateChange: (state: WarState) => void;
};

const securityLabels: Record<OperationalSecurityPosture, string> = {
  open: 'Coordenação aberta',
  standard: 'Segurança padrão',
  restricted: 'Acesso restrito',
  compartmented: 'Compartimentalização máxima',
};

const securityNotes: Record<OperationalSecurityPosture, string> = {
  open: 'Coordenação rápida, alto risco de exposição.',
  standard: 'Equilíbrio entre coordenação e proteção.',
  restricted: 'Menos vazamentos, maior atrito de comando.',
  compartmented: 'Proteção máxima, preparação e coordenação mais lentas.',
};

export function InformationWarfarePanel({ entityId, entities, simulation, armyState, warState, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-information-warfare', refresh);
    return () => window.removeEventListener('world-state-information-warfare', refresh);
  }, []);

  useEffect(() => {
    const result = processInformationWarfare(simulation, armyState, warState);
    if (!result.changed) return;
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onWarStateChange(result.warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const state = informationWarfareState();
  const posture = state.security[entityId] ?? 'standard';
  const incidents = incidentsForEntity(entityId).slice(0, 8);
  const deceptionPlans = deceptionPlansForEntity(entityId).slice(0, 8);
  const wars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
  if (!wars.length && !incidents.length && !deceptionPlans.length) return null;

  function setSecurity(next: OperationalSecurityPosture) {
    setOperationalSecurity(entityId, next);
    setMessage(`Postura alterada para ${securityLabels[next]}.`);
    setRevision((value) => value + 1);
  }

  function launchDeception(warId: string, decoyFrontId: string, trueFrontId?: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const enemies = war.attackers.includes(entityId) ? war.defenders : war.attackers;
    const targetId = enemies[0];
    if (!targetId) return;
    const plan = createStrategicDeceptionPlan(entityId, targetId, warId, decoyFrontId, trueFrontId, simulation, warState);
    setMessage(plan ? 'Plano falso entrou em preparação.' : 'Já existe uma operação de engano ativa ou a frente escolhida é inválida.');
    setRevision((value) => value + 1);
  }

  return <div className="information-warfare-panel">
    <div className="information-warfare-heading">
      <span>CONTRAINTELIGÊNCIA E GUERRA DE INFORMAÇÃO</span>
      <strong>Segurança operacional, vazamentos e engano estratégico</strong>
    </div>

    <div className="information-security-card">
      <div><b>Postura de segurança</b><span>{securityNotes[posture]}</span></div>
      <div className="information-security-actions">
        {(Object.keys(securityLabels) as OperationalSecurityPosture[]).map((item) => <button className={item === posture ? 'active' : ''} key={item} onClick={() => setSecurity(item)}>{securityLabels[item]}</button>)}
      </div>
    </div>

    {wars.map((war) => {
      const enemyIds = war.attackers.includes(entityId) ? war.defenders : war.attackers;
      const active = deceptionPlans.find((plan) => plan.ownerId === entityId && plan.warId === war.id && ['preparing', 'active'].includes(plan.status));
      return <div className="information-war-card" key={war.id}>
        <div className="information-war-head"><div><b>{war.name}</b><span>Adversário principal: {names[enemyIds[0]] ?? enemyIds[0]}</span></div>{active && <em>ENGANO EM CURSO</em>}</div>
        {!active && war.fronts.length >= 2 && <div className="information-decoy-grid">
          {war.fronts.map((front) => {
            const trueFront = war.fronts.find((item) => item.id !== front.id);
            return <button key={front.id} onClick={() => launchDeception(war.id, front.id, trueFront?.id)}>
              <b>Fingir concentração em {front.name}</b>
              <span>Objetivo real preservado em outra frente</span>
            </button>;
          })}
        </div>}
        {!active && war.fronts.length < 2 && <small>É necessária mais de uma frente ativa para criar um desvio estratégico convincente.</small>}
      </div>;
    })}

    {!!deceptionPlans.length && <div className="information-history">
      <div className="context-kicker">Planos de engano</div>
      {deceptionPlans.map((plan) => {
        const war = warState.wars.find((item) => item.id === plan.warId);
        const front = war?.fronts.find((item) => item.id === plan.decoyFrontId);
        return <div className={`information-history-row ${plan.status}`} key={plan.id}>
          <div><b>{front?.name ?? 'Frente de despiste'}</b><span>{plan.ownerId === entityId ? 'Operação própria' : 'Operação adversária detectada'} • {plan.status}</span></div>
          <em>{plan.enemyReaction === 'committed' ? 'adversário comprometido' : plan.enemyReaction === 'reinforcing' ? 'reforços desviados' : plan.enemyReaction === 'watching' ? 'sob observação' : 'sem reação confirmada'}</em>
        </div>;
      })}
    </div>}

    {!!incidents.length && <div className="information-history">
      <div className="context-kicker">Incidentes de inteligência</div>
      {incidents.map((incident) => <div className={`information-history-row severity-${incident.severity}`} key={incident.id}>
        <div><b>{incident.targetId === entityId ? 'Possível comprometimento próprio' : 'Informação adversária obtida'}</b><span>{incident.text}</span></div>
        <em>{incident.severity}</em>
      </div>)}
    </div>}

    {message && <div className="information-warfare-message">{message}</div>}
    <small className="information-warfare-note">As ações de guerra de informação são abstratas e representam decisões estratégicas do Estado. O jogo não descreve métodos operacionais reais de espionagem, interceptação ou sabotagem.</small>
  </div>;
}
