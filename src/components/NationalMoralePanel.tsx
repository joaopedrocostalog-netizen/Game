import React, { useEffect, useState } from 'react';
import type { ArmyState } from '../engine/army';
import {
  communicationPolicyLabel,
  nationalMoraleEraLabel,
  nationalMoraleFor,
  politicalConditionLabel,
  processNationalMorale,
  setPublicCommunicationPolicy,
  type PublicCommunicationPolicy,
} from '../engine/nationalMorale';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './national-morale.css';

type Props = {
  entityId: string;
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  onSimulationStateChange: (state: SimulationState) => void;
};

function band(value: number, inverse = false) {
  const normalized = inverse ? 100 - value : value;
  if (normalized < 22) return 'MUITO BAIXO';
  if (normalized < 42) return 'BAIXO';
  if (normalized < 65) return 'MODERADO';
  if (normalized < 82) return 'ALTO';
  return 'MUITO ALTO';
}

export function NationalMoralePanel({ entityId, simulation, warState, armyState, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-national-morale', refresh);
    window.addEventListener('world-state-wartime-economy', refresh);
    return () => {
      window.removeEventListener('world-state-national-morale', refresh);
      window.removeEventListener('world-state-wartime-economy', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processNationalMorale(simulation, warState, armyState);
    if (result.changed) {
      onSimulationStateChange(result.simulation);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const profile = nationalMoraleFor(entityId, simulation, armyState);
  const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  function changeCommunication(policy: PublicCommunicationPolicy) {
    setPublicCommunicationPolicy(entityId, policy, simulation, armyState);
    setMessage(policy === 'mobilizing'
      ? 'A comunicação pública foi intensificada. Isso pode sustentar apoio por algum tempo, mas também aumenta o desgaste quando custos e resultados não correspondem às expectativas.'
      : policy === 'restrained'
        ? 'A comunicação foi reduzida. A pressão informacional cai, mas o governo perde parte da capacidade de mobilizar apoio.'
        : 'A comunicação institucional voltou a uma postura equilibrada.');
    setRevision((value) => value + 1);
  }

  return <section className="national-morale-panel">
    <header className="national-morale-heading">
      <div><span>MORAL NACIONAL E APOIO À GUERRA</span><strong>{nationalMoraleEraLabel(simulation.date.year)}</strong></div>
      <em>{politicalConditionLabel(profile.condition, simulation.date.year)}</em>
    </header>

    <div className="national-morale-grid">
      <span><small>Moral popular</small><b>{band(profile.popularMorale)}</b><i><em style={{ width: `${profile.popularMorale}%` }}/></i></span>
      <span><small>Apoio ao esforço de guerra</small><b>{atWar ? band(profile.warSupport) : 'SEM GUERRA ATIVA'}</b><i><em style={{ width: `${profile.warSupport}%` }}/></i></span>
      <span><small>Confiança na autoridade</small><b>{band(profile.authorityConfidence)}</b><i><em style={{ width: `${profile.authorityConfidence}%` }}/></i></span>
      <span><small>Apoio de elites/instituições</small><b>{band(profile.eliteSupport)}</b><i><em style={{ width: `${profile.eliteSupport}%` }}/></i></span>
      <span><small>Pressão por paz</small><b>{band(profile.peacePressure)}</b><i><em style={{ width: `${profile.peacePressure}%` }}/></i></span>
      <span><small>Pressão de protestos/facções</small><b>{band(profile.protestPressure)}</b><i><em style={{ width: `${profile.protestPressure}%` }}/></i></span>
    </div>

    <div className="national-morale-summary">
      <span><small>Peso acumulado das baixas</small><b>{band(profile.casualtyBurden)}</b></span>
      <span><small>Risco político</small><b>{profile.condition === 'crisis' ? 'CRÍTICO' : profile.condition === 'restless' ? 'ELEVADO' : profile.condition === 'strained' ? 'CRESCENTE' : 'CONTROLADO'}</b></span>
      <span><small>Capacidade de sustentar a guerra</small><b>{profile.warSupport > 68 && profile.peacePressure < 35 ? 'FORTE' : profile.warSupport > 48 && profile.peacePressure < 58 ? 'ADEQUADA' : profile.warSupport > 30 ? 'FRÁGIL' : 'MUITO FRÁGIL'}</b></span>
    </div>

    <label className="national-morale-policy">Postura de comunicação do Estado
      <select value={profile.communicationPolicy} onChange={(event) => changeCommunication(event.target.value as PublicCommunicationPolicy)}>
        {(['restrained','balanced','mobilizing'] as PublicCommunicationPolicy[]).map((policy) => <option value={policy} key={policy}>{communicationPolicyLabel(policy, simulation.date.year)}</option>)}
      </select>
    </label>

    {message && <div className="national-morale-message">{message}</div>}
    <small className="national-morale-note">Apoio político não é um recurso fixo. Baixas, derrotas, escassez, fadiga econômica e perda de confiança aumentam a pressão por paz; vitórias e recuperação material podem restaurar moral. A interpretação muda conforme a época e o regime: “elites”, “instituições”, “facções” e “opinião pública” representam estruturas políticas equivalentes do período, não categorias modernas impostas a todos os cenários.</small>
  </section>;
}
