import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  airIndustryFor,
  airIndustryState,
  processAirIndustry,
  stageLabel,
  startAirProgram,
  type AirProgramType,
} from '../engine/airIndustry';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './air-industry.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

const programs: { type: AirProgramType; label: string; description: string }[] = [
  { type: 'production', label: 'Expandir produção', description: 'Amplia a capacidade de construir e repor material aéreo em escala.' },
  { type: 'modernization', label: 'Modernizar modelos', description: 'Reduz obsolescência e aumenta a maturidade dos projetos em serviço.' },
  { type: 'pilot-training', label: 'Treinar pilotos', description: 'Eleva a qualidade média das tripulações e acelera a absorção de experiência.' },
  { type: 'maintenance', label: 'Reforçar manutenção', description: 'Melhora disponibilidade, reparos e recuperação das formações aéreas.' },
];

function band(value: number) {
  if (value < 22) return 'MUITO BAIXA';
  if (value < 40) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}

function obsolescenceLabel(value: number) {
  if (value < 12) return 'ATUALIZADA';
  if (value < 28) return 'ACEITÁVEL';
  if (value < 48) return 'DEFASADA';
  return 'OBSOLETA';
}

export function AirIndustryPanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-air-industry', refresh);
    return () => window.removeEventListener('world-state-air-industry', refresh);
  }, []);

  useEffect(() => {
    const result = processAirIndustry(simulation, warState);
    if (result.changed) {
      Object.assign(simulation.entities, result.simulation.entities);
      simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays, warState]);

  void revision;
  if (simulation.date.year < 1794) return <section className="air-industry-panel"><header><div><span>INDÚSTRIA AERONÁUTICA</span><strong>Indisponível nesta época</strong></div></header><p className="air-industry-empty">A estrutura tecnológica e industrial desta data ainda não permite uma indústria aérea militar institucionalizada.</p></section>;

  const profile = airIndustryFor(entityId, simulation);
  const state = airIndustryState();
  const active = state.programs.find((program) => program.entityId === entityId && program.status === 'active');
  const history = state.programs.filter((program) => program.entityId === entityId && program.status === 'completed').slice(0, 4);
  const progress = active ? Math.max(0, Math.min(100, (simulation.elapsedDays - active.startedAtElapsedDay) / Math.max(1, active.completesAtElapsedDay - active.startedAtElapsedDay) * 100)) : 0;

  function start(type: AirProgramType) {
    const result = startAirProgram(entityId, type, simulation);
    if (!result.program) {
      setMessage(result.error ?? 'Não foi possível iniciar o programa aeronáutico.');
      return;
    }
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setMessage('Programa aeronáutico iniciado. O efeito estrutural será incorporado ao término do projeto.');
    setRevision((value) => value + 1);
  }

  return <section className="air-industry-panel">
    <header className="air-industry-heading">
      <div><span>INDÚSTRIA AERONÁUTICA E MODERNIZAÇÃO</span><strong>{stageLabel(profile.stage, simulation.date.year)}</strong></div>
      <em>{names[entityId] ?? entityId}</em>
    </header>

    <div className="air-industry-stats">
      <span><small>Produção</small><b>{band(profile.productionCapacity)}</b></span>
      <span><small>Manutenção</small><b>{band(profile.maintenanceCapacity)}</b></span>
      <span><small>Treinamento</small><b>{band(profile.pilotTraining)}</b></span>
      <span><small>Maturidade do projeto</small><b>{band(profile.modelMaturity)}</b></span>
      <span><small>Eficiência em escala</small><b>{band(profile.scaleEfficiency)}</b></span>
      <span><small>Obsolescência</small><b>{obsolescenceLabel(profile.obsolescence)}</b></span>
    </div>

    {active && <div className="air-program-active">
      <div><b>Programa em andamento</b><span>{programs.find((item) => item.type === active.type)?.label ?? active.type}</span></div>
      <div className="air-program-progress"><i style={{ width: `${progress}%` }}/></div>
      <small>Conclusão prevista no dia {active.completesAtElapsedDay} • custo já comprometido: {active.cost}</small>
    </div>}

    <div className="air-program-grid">
      {programs.map((program) => <button key={program.type} disabled={!!active} onClick={() => start(program.type)}>
        <b>{program.label}</b><small>{program.description}</small>
      </button>)}
    </div>

    {!!history.length && <div className="air-program-history"><strong>Programas concluídos</strong>{history.map((program) => <span key={program.id}>{programs.find((item) => item.type === program.type)?.label ?? program.type}</span>)}</div>}
    {message && <div className="air-industry-message">{message}</div>}
    <small className="air-industry-note">Tecnologia conhecida não equivale a capacidade operacional. A eficácia aérea depende também de escala produtiva, manutenção, treinamento, maturidade do projeto e obsolescência. Esses valores são índices de jogo, não números históricos exatos.</small>
  </section>;
}
