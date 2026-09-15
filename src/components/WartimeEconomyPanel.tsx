import React, { useEffect, useState } from 'react';
import type { ArmyState } from '../engine/army';
import {
  mobilizationLabel,
  processWartimeEconomy,
  rationingLabel,
  setEconomicMobilization,
  setRationing,
  setReconstructionPriority,
  wartimeEconomyEraLabel,
  wartimeEconomyFor,
  wartimeEconomyModifiers,
  type EconomicMobilization,
  type RationingLevel,
  type ReconstructionPriority,
} from '../engine/wartimeEconomy';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './wartime-economy.css';

type Props = {
  entityId: string;
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  onSimulationStateChange: (state: SimulationState) => void;
  onArmyStateChange: (state: ArmyState) => void;
};

function band(value: number) {
  if (value < 22) return 'BAIXO';
  if (value < 48) return 'MODERADO';
  if (value < 72) return 'ALTO';
  return 'CRÍTICO';
}
function priorityLabel(priority: ReconstructionPriority, year: number) {
  if (priority === 'industry') return year < 1850 ? 'Oficinas e manufaturas' : 'Indústria';
  if (priority === 'logistics') return year < 1850 ? 'Estradas, depósitos e portos' : 'Logística e transportes';
  if (priority === 'energy') return year < 1850 ? 'Abastecimento e capacidade motriz' : 'Energia';
  if (priority === 'command') return year < 1914 ? 'Administração e comunicações' : 'Comando e comunicações';
  return 'Reconstrução equilibrada';
}

export function WartimeEconomyPanel({ entityId, simulation, warState, armyState, onSimulationStateChange, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-wartime-economy', refresh);
    window.addEventListener('world-state-strategic-infrastructure', refresh);
    window.addEventListener('world-state-military-industry', refresh);
    return () => {
      window.removeEventListener('world-state-wartime-economy', refresh);
      window.removeEventListener('world-state-strategic-infrastructure', refresh);
      window.removeEventListener('world-state-military-industry', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processWartimeEconomy(simulation, warState, armyState);
    if (result.changed) {
      onSimulationStateChange(result.simulation);
      onArmyStateChange(result.armyState);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const profile = wartimeEconomyFor(entityId, simulation);
  const modifiers = wartimeEconomyModifiers(entityId, simulation);
  const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  function changeMobilization(level: EconomicMobilization) {
    setEconomicMobilization(entityId, level, simulation);
    setMessage(level === 'maximum' ? 'Esforço econômico máximo ordenado. A produção militar sobe, mas o desgaste civil e fiscal também aumentará.' : 'Postura econômica atualizada. A conversão ocorrerá gradualmente ao longo do tempo.');
    setRevision((value) => value + 1);
  }
  function changeRationing(level: RationingLevel) {
    setRationing(entityId, level, simulation);
    setMessage('Política de provisões atualizada. Racionamento preserva mais recursos para a guerra, mas aumenta pressão sobre a população.');
    setRevision((value) => value + 1);
  }
  function changePriority(priority: ReconstructionPriority) {
    setReconstructionPriority(entityId, priority, simulation);
    setMessage(`Prioridade de reconstrução alterada para ${priorityLabel(priority, simulation.date.year).toLowerCase()}.`);
    setRevision((value) => value + 1);
  }

  return <section className="wartime-economy-panel">
    <header className="wartime-economy-heading">
      <div><span>MOBILIZAÇÃO E RECONSTRUÇÃO</span><strong>{wartimeEconomyEraLabel(simulation.date.year)}</strong></div>
      <em>{atWar ? 'ECONOMIA SOB PRESSÃO DE GUERRA' : 'TEMPO DE PAZ / RECUPERAÇÃO'}</em>
    </header>

    <div className="wartime-economy-metrics">
      <span><small>Conversão para esforço estatal/militar</small><b>{band(profile.conversion)}</b><i><em style={{ width: `${profile.conversion}%` }}/></i></span>
      <span><small>Desgaste civil</small><b>{band(profile.civilianStrain)}</b><i><em style={{ width: `${profile.civilianStrain}%` }}/></i></span>
      <span><small>Fadiga de guerra</small><b>{band(profile.warFatigue)}</b><i><em style={{ width: `${profile.warFatigue}%` }}/></i></span>
      <span><small>Esforço de reconstrução</small><b>{band(profile.reconstructionEffort)}</b><i><em style={{ width: `${profile.reconstructionEffort}%` }}/></i></span>
    </div>

    <div className="wartime-economy-controls">
      <label>Postura econômica
        <select value={profile.mobilization} onChange={(event) => changeMobilization(event.target.value as EconomicMobilization)}>
          {(['civilian','balanced','war','maximum'] as EconomicMobilization[]).map((level) => <option key={level} value={level}>{mobilizationLabel(level, simulation.date.year)}</option>)}
        </select>
      </label>
      <label>Provisões e consumo
        <select value={profile.rationing} onChange={(event) => changeRationing(event.target.value as RationingLevel)}>
          {(['none','moderate','strict'] as RationingLevel[]).map((level) => <option key={level} value={level}>{rationingLabel(level, simulation.date.year)}</option>)}
        </select>
      </label>
      <label>Prioridade de reconstrução
        <select value={profile.reconstructionPriority} onChange={(event) => changePriority(event.target.value as ReconstructionPriority)}>
          {(['balanced','industry','logistics','energy','command'] as ReconstructionPriority[]).map((priority) => <option key={priority} value={priority}>{priorityLabel(priority, simulation.date.year)}</option>)}
        </select>
      </label>
    </div>

    <div className="wartime-economy-impact">
      <span><small>Impulso à sustentação militar</small><b>{modifiers.military > 1.2 ? 'MUITO FORTE' : modifiers.military > 1.08 ? 'FORTE' : modifiers.military >= 1 ? 'MODERADO' : 'LIMITADO'}</b></span>
      <span><small>Atividade civil disponível</small><b>{modifiers.civilian > .9 ? 'ALTA' : modifiers.civilian > .75 ? 'PRESSIONADA' : 'MUITO PRESSIONADA'}</b></span>
      <span><small>Capacidade de reconstrução</small><b>{modifiers.reconstruction > 1.15 ? 'ACELERADA' : modifiers.reconstruction > .95 ? 'ADEQUADA' : 'LIMITADA'}</b></span>
    </div>

    {message && <div className="wartime-economy-message">{message}</div>}
    <small className="wartime-economy-note">A conversão não é instantânea. Esforço de guerra elevado melhora estoques, reposição e sustentação, mas reduz espaço econômico civil, pressiona o tesouro e pode corroer estabilidade quando desgaste e fadiga permanecem altos. Em paz, reduzir a mobilização permite recuperação econômica e social gradual.</small>
  </section>;
}
