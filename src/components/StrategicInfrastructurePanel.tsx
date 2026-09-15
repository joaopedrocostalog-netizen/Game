import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import type { ArmyState } from '../engine/army';
import {
  processStrategicInfrastructure,
  recentStrategicInfrastructureStrikes,
  strategicInfrastructureEffects,
  strategicInfrastructureEraLabel,
  strategicInfrastructureForEntity,
  strategicInfrastructureTypeLabel,
} from '../engine/strategicInfrastructure';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './strategic-infrastructure.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  onArmyStateChange: (state: ArmyState) => void;
};

function conditionLabel(value: string) {
  if (value === 'critical') return 'CRÍTICA';
  if (value === 'damaged') return 'DANIFICADA';
  if (value === 'strained') return 'PRESSIONADA';
  return 'OPERACIONAL';
}
function severityLabel(value: string) {
  if (value === 'heavy') return 'DANO PESADO';
  if (value === 'significant') return 'DANO SIGNIFICATIVO';
  return 'DANO LIMITADO';
}
function band(value: number) {
  if (value < 30) return 'CRÍTICA';
  if (value < 55) return 'FRÁGIL';
  if (value < 78) return 'FUNCIONAL';
  return 'ROBUSTA';
}

export function StrategicInfrastructurePanel({ entityId, entities, simulation, warState, armyState, onArmyStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const locations = useMemo(() => locationsForYear(simulation.date.year), [simulation.date.year]);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-strategic-infrastructure', refresh);
    return () => window.removeEventListener('world-state-strategic-infrastructure', refresh);
  }, []);

  useEffect(() => {
    const result = processStrategicInfrastructure(simulation, warState, armyState);
    if (result.changed) {
      onArmyStateChange(result.armyState);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const nodes = strategicInfrastructureForEntity(entityId, simulation);
  const effects = strategicInfrastructureEffects(entityId);
  const strikes = recentStrategicInfrastructureStrikes(entityId).slice(0, 8);
  const grouped = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const current = grouped.get(node.type) ?? [];
    grouped.set(node.type, [...current, node]);
  }

  return <section className="strategic-infra-panel">
    <header className="strategic-infra-heading">
      <div><span>INFRAESTRUTURA ESTRATÉGICA</span><strong>{strategicInfrastructureEraLabel(simulation.date.year)}</strong></div>
      <em>INDÚSTRIA • TRANSPORTE • ENERGIA • DEPÓSITOS • PORTOS • COMANDO</em>
    </header>

    <div className="strategic-infra-summary">
      <span><small>Base industrial</small><b>{band(effects.industryIntegrity)}</b></span>
      <span><small>Rede logística</small><b>{band(effects.logisticsIntegrity)}</b></span>
      <span><small>Comando e comunicações</small><b>{band(effects.commandIntegrity)}</b></span>
      <span><small>Pressão sobre reposição</small><b>{Math.round((1 - effects.industrialModifier) * 100)}%</b></span>
    </div>

    <div className="strategic-infra-grid">
      {[...grouped.entries()].map(([type, items]) => {
        const avgIntegrity = items.reduce((sum, item) => sum + item.integrity, 0) / Math.max(1, items.length);
        const avgCapacity = items.reduce((sum, item) => sum + item.capacity, 0) / Math.max(1, items.length);
        const worst = [...items].sort((a, b) => a.integrity - b.integrity)[0];
        const location = locations.find((item) => item.id === worst?.locationId);
        return <article key={type} className={`strategic-infra-card ${worst?.condition ?? 'operational'}`}>
          <div><b>{strategicInfrastructureTypeLabel(type as any, simulation.date.year)}</b><small>{items.length} nós ativos</small></div>
          <span><small>Integridade média</small><b>{Math.round(avgIntegrity)}%</b></span>
          <span><small>Capacidade média</small><b>{Math.round(avgCapacity)}</b></span>
          <em>{conditionLabel(worst?.condition ?? 'operational')}<small>{location ? `ponto mais vulnerável: ${location.name}` : 'rede estável'}</small></em>
        </article>;
      })}
    </div>

    <div className="strategic-infra-strikes">
      <strong>Pressão e danos recentes</strong>
      {!strikes.length && <small>Nenhum dano estratégico registrado nesta campanha.</small>}
      {strikes.map((strike) => {
        const location = locations.find((item) => item.id === strike.locationId);
        const incoming = strike.defenderId === entityId;
        return <article key={strike.id} className={incoming ? 'incoming' : 'outgoing'}>
          <div><b>{strategicInfrastructureTypeLabel(strike.type, simulation.date.year)}</b><small>{location?.name ?? strike.locationId}</small></div>
          <span>{incoming ? 'RECEBIDO' : 'CAUSADO'}</span>
          <em>{severityLabel(strike.severity)}<small>{names[strike.attackerId] ?? strike.attackerId} → {names[strike.defenderId] ?? strike.defenderId}</small></em>
        </article>;
      })}
    </div>

    <small className="strategic-infra-note">Sistema abstrato de grande estratégia. Danos em transporte, depósitos, energia, indústria e comando reduzem a capacidade de sustentar forças e repor perdas; a recuperação depende da capacidade econômica e tecnológica. Ataques são resolvidos em nível estratégico, sem modelar procedimentos operacionais reais.</small>
  </section>;
}
