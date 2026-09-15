import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  operationalConstraintLabel,
  politicalOrderLabel,
  processWarPolitics,
  requestArmistice,
  respondArmisticeOffer,
  warPoliticsFor,
  warPoliticsState,
} from '../engine/warPolitics';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './war-politics.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  onSimulationStateChange: (state: SimulationState) => void;
  onWarStateChange: (state: WarState) => void;
  onArmyStateChange: (state: ArmyState) => void;
};

function band(value: number) {
  if (value < 22) return 'BAIXO';
  if (value < 45) return 'MODERADO';
  if (value < 68) return 'ELEVADO';
  if (value < 84) return 'MUITO ELEVADO';
  return 'CRÍTICO';
}

export function WarPoliticsPanel({ entityId, entities, simulation, warState, armyState, onSimulationStateChange, onWarStateChange, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-war-politics', refresh);
    window.addEventListener('world-state-national-morale', refresh);
    return () => {
      window.removeEventListener('world-state-war-politics', refresh);
      window.removeEventListener('world-state-national-morale', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processWarPolitics(simulation, warState, armyState, entities);
    if (result.changed) {
      onSimulationStateChange(result.simulation);
      onWarStateChange(result.warState);
      onArmyStateChange(result.armyState);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const profile = warPoliticsFor(entityId, simulation);
  const activeWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
  const offers = warPoliticsState().armisticeOffers.filter((offer) => offer.toId === entityId && offer.status === 'pending');

  function answerOffer(id: string, accept: boolean) {
    const result = respondArmisticeOffer(id, accept, warState);
    onWarStateChange(result.warState);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function seekArmistice(warId: string) {
    const result = requestArmistice(entityId, warId, simulation, warState, armyState);
    onWarStateChange(result.warState);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  return <section className="war-politics-panel">
    <header className="war-politics-heading">
      <div><span>CRISE POLÍTICA E CONDUÇÃO DA GUERRA</span><strong>{operationalConstraintLabel(profile.operationalConstraint, simulation.date.year)}</strong></div>
      <em>{politicalOrderLabel(profile.politicalOrder, simulation.date.year)}</em>
    </header>

    <div className="war-politics-grid">
      <span><small>Pressão política agregada</small><b>{band(profile.crisisScore)}</b><i><em style={{ width: `${profile.crisisScore}%` }}/></i></span>
      <span><small>Risco de deserção/desmobilização</small><b>{band(profile.desertionPressure)}</b><i><em style={{ width: `${profile.desertionPressure}%` }}/></i></span>
      <span><small>Pressão de fragmentação interna</small><b>{band(profile.fragmentationPressure)}</b><i><em style={{ width: `${profile.fragmentationPressure}%` }}/></i></span>
      <span><small>Mudanças de liderança acumuladas</small><b>{profile.leadershipChanges}</b></span>
    </div>

    {profile.operationalConstraint !== 'none' && <div className="war-politics-warning">
      A política interna está limitando a liberdade operacional. Ordens ofensivas extremas podem ser reduzidas automaticamente para posturas cautelosas ou defensivas enquanto a crise persistir.
    </div>}

    {offers.length > 0 && <div className="war-politics-offers">
      <strong>PROPOSTAS DE ARMISTÍCIO RECEBIDAS</strong>
      {offers.map((offer) => <article key={offer.id}>
        <div><b>{names[offer.fromId] ?? offer.fromId}</b><p>{offer.rationale}</p></div>
        <div className="war-politics-actions"><button onClick={() => answerOffer(offer.id, true)}>Aceitar</button><button onClick={() => answerOffer(offer.id, false)}>Recusar</button></div>
      </article>)}
    </div>}

    {activeWars.length > 0 && <div className="war-politics-wars">
      <strong>PRESSÃO POR NEGOCIAÇÃO</strong>
      {activeWars.map((war) => <article key={war.id}>
        <div><b>{war.name}</b><small>{war.elapsedDays} dias de guerra • placar {war.score.toFixed(1)}</small></div>
        <button onClick={() => seekArmistice(war.id)}>Solicitar armistício</button>
      </article>)}
    </div>}

    {message && <div className="war-politics-message">{message}</div>}
    <small className="war-politics-note">A crise não usa uma regra política moderna única. Dependendo da época e do regime, “mudança de liderança” pode representar troca de gabinete, substituição ministerial, regência, deposição, reorganização da corte ou transição institucional. Pressão extrema pode reduzir ofensivas, gerar deserções e abrir negociações de armistício; ruptura de regime só ocorre em condições excepcionalmente graves.</small>
  </section>;
}
