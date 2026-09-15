import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { multilateralSanctionsState } from '../engine/multilateralSanctions';
import {
  processSanctionsEvasion,
  sanctionsEvasionNetworksFor,
  sanctionsEvasionRelief,
  startSanctionsEvasion,
  type EvasionStrategy,
  type EvasionStatus,
} from '../engine/sanctionsEvasion';
import type { SimulationState } from '../engine/simulation';
import './sanctions-evasion.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  onSimulationStateChange: (state: SimulationState) => void;
};

const strategies: EvasionStrategy[] = ['domestic-substitution', 'alternate-partners', 'neutral-intermediaries'];
function strategyLabel(strategy: EvasionStrategy, year: number) {
  if (strategy === 'domestic-substitution') return year < 1800 ? 'Substituição por produção local' : 'Substituição doméstica';
  if (strategy === 'alternate-partners') return year < 1800 ? 'Redirecionar casas mercantis' : 'Parceiros comerciais alternativos';
  return year < 1800 ? 'Intermediários mercantis neutros' : 'Intermediários neutros';
}
function statusLabel(status: EvasionStatus) {
  if (status === 'building') return 'EM FORMAÇÃO';
  if (status === 'active') return 'ATIVA';
  if (status === 'exposed') return 'DESCOBERTA';
  return 'COLAPSADA';
}
function band(value: number) {
  if (value < 20) return 'BAIXO';
  if (value < 45) return 'MODERADO';
  if (value < 70) return 'ELEVADO';
  return 'ALTO';
}

export function SanctionsEvasionPanel({ entityId, entities, simulation, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [strategy, setStrategy] = useState<EvasionStrategy>('domestic-substitution');
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-sanctions-evasion', refresh);
    window.addEventListener('world-state-multilateral-sanctions', refresh);
    return () => {
      window.removeEventListener('world-state-sanctions-evasion', refresh);
      window.removeEventListener('world-state-multilateral-sanctions', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processSanctionsEvasion(simulation);
    if (result.changed) onSimulationStateChange(result.simulation);
  }, [simulation.elapsedDays]);

  void revision;
  const regimes = multilateralSanctionsState().regimes.filter((item) => item.status !== 'ended');
  const targeted = regimes.filter((item) => item.targetId === entityId);
  const networks = sanctionsEvasionNetworksFor(entityId);
  const relief = sanctionsEvasionRelief(entityId);
  const intermediaryNetworks = networks.filter((item) => item.intermediaryId === entityId && item.targetId !== entityId);
  if (!targeted.length && !networks.length) return null;

  function launch(regimeId: string) {
    const result = startSanctionsEvasion(regimeId, entityId, strategy, simulation);
    setMessage(result.message);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setRevision((value) => value + 1);
  }

  return <section className="sanctions-evasion-panel">
    <header className="sanctions-evasion-heading">
      <div><span>RESILIÊNCIA AO ISOLAMENTO</span><strong>Substituição, parceiros alternativos e exposição diplomática</strong></div>
      <em>{relief.relief > 35 ? 'ALÍVIO RELEVANTE' : relief.relief > 10 ? 'ADAPTAÇÃO PARCIAL' : 'PRESSÃO ELEVADA'}</em>
    </header>

    {targeted.map((regime) => {
      const existing = networks.find((item) => item.targetId === entityId && item.regimeId === regime.id && item.status !== 'collapsed');
      return <article className="sanctions-evasion-card" key={regime.id}>
        <div className="sanctions-evasion-card-head"><div><b>Regime liderado por {names[regime.sponsorId] ?? regime.sponsorId}</b><span>{regime.memberIds.length} participante(s) • isolamento {band(regime.marketIsolation)}</span></div><strong>{regime.status.toUpperCase()}</strong></div>
        {!existing ? <div className="sanctions-evasion-launch">
          <label>Estratégia de adaptação<select value={strategy} onChange={(event) => setStrategy(event.target.value as EvasionStrategy)}>{strategies.map((item) => <option value={item} key={item}>{strategyLabel(item, simulation.date.year)}</option>)}</select></label>
          <button onClick={() => launch(regime.id)}>Iniciar adaptação</button>
        </div> : <div className="sanctions-evasion-network">
          <div><span>Estratégia</span><b>{strategyLabel(existing.strategy, simulation.date.year)}</b></div>
          <div><span>Status</span><b>{statusLabel(existing.status)}</b></div>
          <div><span>Alívio</span><b>{band(existing.relief)}</b></div>
          <div><span>Custo interno</span><b>{band(existing.cost)}</b></div>
          <div><span>Risco de descoberta</span><b>{band(existing.exposureRisk)}</b></div>
          <div><span>Fiscalização externa</span><b>{band(existing.enforcementPressure)}</b></div>
          {existing.intermediaryId && <div className="wide"><span>Intermediário estimado</span><b>{names[existing.intermediaryId] ?? existing.intermediaryId}</b></div>}
        </div>}
      </article>;
    })}

    {!!intermediaryNetworks.length && <div className="sanctions-evasion-intermediary"><strong>Exposição como intermediário</strong>{intermediaryNetworks.map((network) => <div key={network.id}><span>Apoio econômico indireto a {names[network.targetId] ?? network.targetId}</span><b>{statusLabel(network.status)} • risco {band(network.exposureRisk)}</b></div>)}</div>}

    <div className="sanctions-evasion-summary"><span><small>Alívio agregado</small><b>{band(relief.relief)}</b></span><span><small>Custo agregado</small><b>{band(relief.cost)}</b></span><span><small>Exposição</small><b>{band(relief.exposureRisk)}</b></span></div>
    {message && <div className="sanctions-evasion-message">{message}</div>}
    <small className="sanctions-evasion-note">Mecânica abstrata de grande estratégia. Ela representa adaptação econômica, diversificação e redes paralelas sem modelar procedimentos reais de evasão. Quanto maior a fiscalização e a coesão do regime, menor o alívio; redes expostas perdem eficiência e geram custo diplomático para intermediários.</small>
  </section>;
}
