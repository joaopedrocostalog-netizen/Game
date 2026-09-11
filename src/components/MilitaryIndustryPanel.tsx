import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  eraIndustryLabels,
  militaryIndustryFor,
  militaryIndustryPressure,
  militaryIndustryState,
  processMilitaryIndustry,
  startMilitaryIndustryExpansion,
  type MilitaryIndustrySector,
} from '../engine/militaryIndustry';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './military-industry.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
};

function pressureLabel(value: ReturnType<typeof militaryIndustryPressure>) {
  if (value === 'critical') return 'CRÍTICA';
  if (value === 'strained') return 'PRESSIONADA';
  if (value === 'adequate') return 'ADEQUADA';
  return 'FORTE';
}

export function MilitaryIndustryPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const labels = eraIndustryLabels(simulation.date.year);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-military-industry', refresh);
    return () => window.removeEventListener('world-state-military-industry', refresh);
  }, []);

  useEffect(() => {
    const result = processMilitaryIndustry(simulation, armyState, warState);
    if (!result.changed) return;
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const state = militaryIndustryState();
  const profile = militaryIndustryFor(entityId, simulation);
  const active = state.projects.find((project) => project.entityId === entityId && project.status === 'building');
  const atWar = warState.wars.some((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
  const pressure = militaryIndustryPressure(entityId, simulation);

  function expand(sector: MilitaryIndustrySector) {
    const result = startMilitaryIndustryExpansion(entityId, sector, simulation, warState);
    if (!result.project) {
      setMessage(result.error ?? 'Não foi possível iniciar a expansão.');
      return;
    }
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setMessage('Projeto industrial militar iniciado.');
    setRevision((value) => value + 1);
  }

  const sectors: Array<{ type: MilitaryIndustrySector; label: string; value: number; note: string }> = [
    { type: 'armaments', label: labels.armaments, value: profile.armamentsCapacity, note: 'Repõe equipamento perdido e sustenta armamento de campanha.' },
    { type: 'supply', label: labels.supply, value: profile.supplyCapacity, note: 'Sustenta estoques, abastecimento e recuperação logística.' },
    { type: 'naval', label: labels.naval, value: profile.navalCapacity, note: 'Capacidade estrutural preparada para construção e manutenção de frotas.' },
  ];

  return <section className="military-industry-panel">
    <header className="military-industry-heading">
      <div><span>BASE INDUSTRIAL MILITAR</span><strong>Produção, estoques e capacidade de reposição</strong></div>
      <div className={`military-industry-pressure ${pressure}`}><small>Sustentação</small><b>{pressureLabel(pressure)}</b></div>
    </header>

    <div className="military-industry-stock-grid">
      <div><small>Estoque de armamentos</small><b>{profile.armamentsStockpile.toFixed(0)}</b><i style={{ width: `${profile.armamentsStockpile}%` }}/></div>
      <div><small>Estoque de suprimentos</small><b>{profile.supplyStockpile.toFixed(0)}</b><i style={{ width: `${profile.supplyStockpile}%` }}/></div>
      <div><small>Eficiência de reposição</small><b>{profile.replacementEfficiency.toFixed(0)}</b><i style={{ width: `${profile.replacementEfficiency}%` }}/></div>
      <div><small>Dependência externa</small><b>{profile.importDependence.toFixed(0)}</b><i style={{ width: `${profile.importDependence}%` }}/></div>
    </div>

    {atWar && <div className="military-industry-warning">Guerra ativa: consumo de equipamento e suprimentos acelerado. Estoques baixos reduzem equipamento, organização, abastecimento e moral das formações.</div>}

    {active && <div className="military-industry-active">
      <b>Expansão em andamento</b>
      <span>{active.sector === 'armaments' ? labels.armaments : active.sector === 'supply' ? labels.supply : labels.naval}</span>
      <small>Conclusão prevista no dia {active.completesAtElapsedDay} • ganho estimado de capacidade {active.capacityGain.toFixed(0)}</small>
    </div>}

    <div className="military-industry-sectors">
      {sectors.map((sector) => <article key={sector.type}>
        <div className="military-industry-sector-head"><b>{sector.label}</b><strong>{sector.value.toFixed(0)}</strong></div>
        <p>{sector.note}</p>
        <div className="military-industry-capacity"><i style={{ width: `${sector.value}%` }}/></div>
        <button disabled={atWar || !!active} onClick={() => expand(sector.type)}>{atWar ? 'Disponível em tempo de paz' : active ? 'Projeto já em andamento' : labels.expansion}</button>
      </article>)}
    </div>

    <div className="military-industry-footer">
      <span><small>Entidade</small><b>{names[entityId] ?? entityId}</b></span>
      <span><small>Tesouro atual</small><b>{simulation.entities[entityId]?.treasuryIndex.toFixed(0) ?? '—'}</b></span>
      <span><small>Tratados comerciais ativos</small><b>{simulation.treaties.filter((treaty) => treaty.active && treaty.type === 'trade' && treaty.parties.includes(entityId)).length}</b></span>
    </div>

    {message && <div className="military-industry-message">{message}</div>}
    <small className="military-industry-note">A capacidade industrial é um índice de jogo, não uma estatística histórica exata. Importações ajudam a aliviar gargalos quando existem relações comerciais, mas uma economia dependente continua vulnerável a interrupções futuras.</small>
  </section>;
}
