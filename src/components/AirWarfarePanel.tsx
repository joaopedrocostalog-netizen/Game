import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { airCampaignState, airEraAvailable } from '../engine/airCampaign';
import { airWarfareState, processAirWarfare } from '../engine/airWarfare';
import { militaryIndustryFor } from '../engine/militaryIndustry';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './air-warfare.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

function band(value: number) {
  if (value < 20) return 'MUITO BAIXA';
  if (value < 38) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}
function conditionLabel(value: string) {
  if (value === 'critical') return 'CRÍTICA';
  if (value === 'damaged') return 'DANIFICADA';
  if (value === 'strained') return 'PRESSIONADA';
  return 'OPERACIONAL';
}
function outcomeLabel(value: string) {
  if (value === 'decisive') return 'RESULTADO DECISIVO';
  if (value === 'advantage') return 'VANTAGEM LOCAL';
  return 'INCONCLUSIVO';
}

export function AirWarfarePanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-warfare', refresh);
    window.addEventListener('world-state-air-campaign', refresh);
    return () => {
      window.removeEventListener('world-state-air-warfare', refresh);
      window.removeEventListener('world-state-air-campaign', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processAirWarfare(simulation, warState);
    if (result.changed) setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState]);

  void revision;
  if (!airEraAvailable(simulation.date.year)) return null;

  const campaign = airCampaignState();
  const warfare = airWarfareState();
  const formations = campaign.formations.filter((item) => item.entityId === entityId);
  if (!formations.length) return null;
  const bases = Object.values(warfare.bases).filter((base) => base.entityId === entityId);
  const engagements = warfare.engagements.filter((item) => item.attackers.includes(entityId) || item.defenders.includes(entityId)).slice(0, 6);
  const industry = militaryIndustryFor(entityId, simulation);
  const averageExperience = formations.reduce((sum, item) => sum + item.experience, 0) / Math.max(1, formations.length);
  const averageStrength = formations.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, formations.length);

  return <section className="air-warfare-panel">
    <header className="air-warfare-heading">
      <div><span>GUERRA AÉREA</span><strong>Interceptação, defesa aérea, desgaste e reposição</strong></div>
      <em>{band(averageStrength)}</em>
    </header>

    <div className="air-warfare-summary">
      <span><small>Experiência média</small><b>{band(averageExperience)}</b></span>
      <span><small>Reposição industrial</small><b>{band(industry.replacementEfficiency)}</b></span>
      <span><small>Capacidade de armamentos</small><b>{band(industry.armamentsCapacity)}</b></span>
      <span><small>Bases ativas</small><b>{bases.length}</b></span>
    </div>

    {!!bases.length && <div className="air-base-grid">
      {bases.map((base) => <article className={`air-base-card ${base.condition}`} key={`${base.entityId}-${base.locationId}`}>
        <div><b>{base.locationId}</b><small>Base aérea / ponto de operação</small></div>
        <span><small>Condição</small><strong>{conditionLabel(base.condition)}</strong></span>
        <span><small>Defesa aérea</small><strong>{band(base.airDefense)}</strong></span>
        <span><small>Danos acumulados</small><strong>{base.damage < 20 ? 'BAIXOS' : base.damage < 50 ? 'MODERADOS' : base.damage < 76 ? 'ALTOS' : 'CRÍTICOS'}</strong></span>
      </article>)}
    </div>}

    <div className="air-engagement-history">
      <strong>Confrontos aéreos recentes</strong>
      {!engagements.length && <p>Nenhum confronto aéreo envolvendo esta entidade foi registrado até agora.</p>}
      {engagements.map((engagement) => {
        const ourAttack = engagement.attackers.includes(entityId);
        const ownLosses = ourAttack ? engagement.attackerLosses : engagement.defenderLosses;
        const enemyLosses = ourAttack ? engagement.defenderLosses : engagement.attackerLosses;
        const opponents = (ourAttack ? engagement.defenders : engagement.attackers).map((id) => names[id] ?? id).join(', ');
        const won = engagement.winnerSide ? (ourAttack ? engagement.winnerSide === 'attackers' : engagement.winnerSide === 'defenders') : false;
        return <div className="air-engagement-row" key={engagement.id}>
          <span><b>{outcomeLabel(engagement.outcome)}</b><small>contra {opponents || 'força adversária'} • dia {engagement.occurredAtElapsedDay}</small></span>
          <em>{engagement.winnerSide ? (won ? 'VANTAGEM FAVORÁVEL' : 'VANTAGEM ADVERSÁRIA') : 'SEM DOMÍNIO CLARO'}</em>
          <small>Desgaste próprio: {band(ownLosses * 12)} • desgaste adversário estimado: {band(enemyLosses * 12)}</small>
        </div>;
      })}
    </div>

    <small className="air-warfare-note">Confrontos são agregados em escala operacional. Defesa aérea representa a capacidade do Estado de proteger bases e espaço aéreo; missões de interdição podem danificar bases adversárias, enquanto indústria, suprimentos e experiência determinam a velocidade de recomposição das formações.</small>
  </section>;
}
