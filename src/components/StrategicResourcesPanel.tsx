import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  processStrategicResources,
  resourceLabel,
  strategicResourceIndustryModifiers,
  strategicResourceSecurity,
  strategicResourceState,
  strategicResourcesForEntity,
  supplyRoutesForEntity,
} from '../engine/strategicResources';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './strategic-resources.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

function securityLabel(value: number) {
  if (value < 22) return 'CRÍTICA';
  if (value < 40) return 'VULNERÁVEL';
  if (value < 62) return 'DEPENDENTE';
  if (value < 78) return 'SEGURA';
  return 'ROBUSTA';
}

function routeLabel(status: 'open' | 'pressured' | 'interdicted') {
  if (status === 'interdicted') return 'INTERDITADA';
  if (status === 'pressured') return 'SOB PRESSÃO';
  return 'ABERTA';
}

export function StrategicResourcesPanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-strategic-resources', refresh);
    return () => window.removeEventListener('world-state-strategic-resources', refresh);
  }, []);

  useEffect(() => {
    const result = processStrategicResources(simulation, warState);
    if (result.changed) setRevision((value) => value + 1);
  }, [simulation.elapsedDays, simulation.treaties.length, warState]);

  void revision;
  void strategicResourceState();
  const balances = strategicResourcesForEntity(entityId, simulation);
  const routes = supplyRoutesForEntity(entityId);
  const imports = routes.filter((route) => route.importerId === entityId).sort((a, b) => b.volume - a.volume).slice(0, 8);
  const exports = routes.filter((route) => route.exporterId === entityId).sort((a, b) => b.volume - a.volume).slice(0, 5);
  const security = strategicResourceSecurity(entityId, simulation);
  const industry = strategicResourceIndustryModifiers(entityId, simulation);

  return <section className="strategic-resources-panel">
    <header className="strategic-resources-heading">
      <div><span>RECURSOS E ROTAS ESTRATÉGICAS</span><strong>Insumos, dependência externa e segurança de abastecimento</strong></div>
      <div className={`strategic-resource-security s-${securityLabel(security).toLowerCase()}`}><small>Segurança geral</small><b>{securityLabel(security)}</b></div>
    </header>

    <div className="strategic-resource-grid">
      {balances.map((balance) => <article key={balance.resource}>
        <div className="strategic-resource-card-head"><b>{resourceLabel(balance.resource, simulation.date.year)}</b><strong>{securityLabel(balance.security)}</strong></div>
        <div className="strategic-resource-meter"><i style={{ width: `${balance.security}%` }}/></div>
        <div className="strategic-resource-stats">
          <span><small>Produção interna</small><b>{balance.domesticOutput.toFixed(0)}</b></span>
          <span><small>Estoque</small><b>{balance.stockpile.toFixed(0)}</b></span>
          <span><small>Importação</small><b>{balance.imported.toFixed(0)}</b></span>
          <span><small>Demanda</small><b>{balance.demand.toFixed(0)}</b></span>
        </div>
      </article>)}
    </div>

    <div className="strategic-resource-impact">
      <span><small>Insumos para armamentos</small><b>{securityLabel(industry.armaments * 100)}</b></span>
      <span><small>Insumos logísticos</small><b>{securityLabel(industry.supply * 100)}</b></span>
      <span><small>Insumos navais</small><b>{securityLabel(industry.naval * 100)}</b></span>
    </div>

    <div className="strategic-route-columns">
      <div>
        <strong>Rotas de importação</strong>
        {!imports.length && <p>Nenhuma rota estratégica relevante está ativa. A sustentação depende principalmente da produção doméstica.</p>}
        {imports.map((route) => <div className={`strategic-route ${route.status}`} key={route.id}>
          <span><b>{resourceLabel(route.resource, simulation.date.year)}</b><small>de {names[route.exporterId] ?? route.exporterId}</small></span>
          <em>{routeLabel(route.status)}</em>
        </div>)}
      </div>
      <div>
        <strong>Rotas de exportação</strong>
        {!exports.length && <p>Nenhum excedente estratégico relevante está sendo exportado.</p>}
        {exports.map((route) => <div className={`strategic-route ${route.status}`} key={route.id}>
          <span><b>{resourceLabel(route.resource, simulation.date.year)}</b><small>para {names[route.importerId] ?? route.importerId}</small></span>
          <em>{routeLabel(route.status)}</em>
        </div>)}
      </div>
    </div>

    <small className="strategic-resource-note">Os valores são índices sistêmicos de jogo. A disponibilidade muda com a época, produção doméstica, tratados comerciais, guerras e interdição das rotas. Uma grande base industrial sem acesso seguro aos insumos necessários perde eficiência de produção e reposição.</small>
  </section>;
}
