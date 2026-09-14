import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  airCampaignState,
  airEraAvailable,
  airEraLabel,
  airFormationsForEntity,
  airMissionLabel,
  processAirCampaign,
  setAirMission,
  type AirMission,
} from '../engine/airCampaign';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './air-campaign.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  onArmyStateChange: (state: ArmyState) => void;
};

const baseMissions: AirMission[] = ['reserve', 'air-superiority', 'reconnaissance', 'ground-support', 'interdiction', 'maritime-patrol'];

function missionsForYear(year: number): AirMission[] {
  return year >= 1930 ? [...baseMissions, 'air-transport'] : baseMissions;
}

function band(value: number) {
  if (value < 22) return 'MUITO BAIXA';
  if (value < 40) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}
function controlLabel(value: string, controlledIsAttacker: boolean) {
  if (value === 'limited') return 'PRESENÇA LIMITADA';
  if (value === 'contested') return 'ESPAÇO AÉREO DISPUTADO';
  if (value === 'attacker-dominant') return controlledIsAttacker ? 'DOMÍNIO AÉREO FAVORÁVEL' : 'DOMÍNIO AÉREO ADVERSÁRIO';
  return controlledIsAttacker ? 'DOMÍNIO AÉREO ADVERSÁRIO' : 'DOMÍNIO AÉREO FAVORÁVEL';
}

export function AirCampaignPanel({ entityId, entities, simulation, warState, armyState, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const missions = missionsForYear(simulation.date.year);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-campaign', refresh);
    return () => window.removeEventListener('world-state-air-campaign', refresh);
  }, []);

  useEffect(() => {
    const result = processAirCampaign(simulation, warState, armyState);
    if (result.changed) onArmyStateChange(result.armyState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState]);

  void revision;
  const available = airEraAvailable(simulation.date.year);
  const formations = airFormationsForEntity(entityId);
  const state = airCampaignState();
  const relevantTheaters = state.theaters.filter((theater) => {
    const war = warState.wars.find((item) => item.id === theater.warId);
    return !!war && (war.attackers.includes(entityId) || war.defenders.includes(entityId));
  });

  function changeMission(id: string, mission: AirMission) {
    if (!setAirMission(id, mission)) return;
    setMessage(`Missão alterada para ${airMissionLabel(mission, simulation.date.year)}.`);
    setRevision((value) => value + 1);
  }

  return <section className="air-campaign-panel">
    <header className="air-campaign-heading">
      <div><span>COMANDO AÉREO</span><strong>{airEraLabel(simulation.date.year)}</strong></div>
      <em>{available ? `${formations.length} formação${formations.length === 1 ? '' : 'ões'}` : 'INDISPONÍVEL NESTA ÉPOCA'}</em>
    </header>

    {!available && <div className="air-era-empty">Nesta data, o Estado ainda não dispõe de uma estrutura aérea militar capaz de operar como campanha independente. O sistema será ativado automaticamente quando a tecnologia e a época permitirem.</div>}

    {available && !formations.length && <div className="air-era-empty">A época permite poder aéreo, mas esta entidade ainda não possui base ou capacidade suficiente para manter uma formação aérea operacional.</div>}

    {!!formations.length && <div className="air-formation-grid">
      {formations.map((formation) => <article key={formation.id}>
        <div className="air-formation-head"><div><b>{formation.name}</b><small>Base: {formation.baseLocationId}</small></div><em>{airMissionLabel(formation.mission, simulation.date.year)}</em></div>
        <div className="air-stat-grid">
          <span><small>Força</small><b>{band(formation.strength)}</b></span>
          <span><small>Prontidão</small><b>{band(formation.readiness)}</b></span>
          <span><small>Suprimento</small><b>{band(formation.supply)}</b></span>
          <span><small>Alcance</small><b>{band(formation.range)}</b></span>
          <span><small>Experiência</small><b>{band(formation.experience)}</b></span>
        </div>
        <label>Missão
          <select value={formation.mission} onChange={(event) => changeMission(formation.id, event.target.value as AirMission)}>
            {missions.map((mission) => <option value={mission} key={mission}>{airMissionLabel(mission, simulation.date.year)}</option>)}
          </select>
        </label>
      </article>)}
    </div>}

    {!!relevantTheaters.length && <div className="air-theater-grid">
      <strong>Quadro aéreo das frentes</strong>
      {relevantTheaters.map((theater) => {
        const war = warState.wars.find((item) => item.id === theater.warId)!;
        const front = war.fronts.find((item) => item.id === theater.frontId);
        const controlledIsAttacker = war.attackers.includes(entityId);
        return <div className={`air-theater ${theater.state}`} key={`${theater.warId}-${theater.frontId}`}>
          <span><b>{front?.name ?? theater.frontId}</b><small>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</small></span>
          <em>{controlLabel(theater.state, controlledIsAttacker)}</em>
        </div>;
      })}
    </div>}

    {message && <div className="air-campaign-message">{message}</div>}
    <small className="air-campaign-note">O poder aéreo é agregado por formações estratégicas, não por contagem histórica exata de aeronaves. Superioridade aérea influencia organização e abastecimento; reconhecimento melhora consciência situacional; apoio terrestre e interdição representam pressão operacional; patrulha marítima coopera com forças navais; transporte aéreo sustenta formações terrestres quando a época e a capacidade permitem.</small>
  </section>;
}
