import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { economicPressureState, endEconomicPressure, processEconomicPressure, routeMarketAccess, startEconomicPressure, type EconomicPressureAction } from '../engine/economicPressure';
import { applyEconomicPressureToResources } from '../engine/economicPressureResources';
import { processStrategicResources } from '../engine/strategicResources';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './trade-pressure.css';

type Props = { entityId: string; entities: ScenarioEntity[]; simulation: SimulationState; warState: WarState };
const actions: EconomicPressureAction[] = ['embargo', 'sanctions', 'route_pressure', 'market_restriction'];

function band(value: number) {
  if (value < 25) return 'BAIXA';
  if (value < 50) return 'MODERADA';
  if (value < 72) return 'FORTE';
  return 'SEVERA';
}

function actionName(action: EconomicPressureAction, year: number) {
  if (action === 'embargo') return year < 1800 ? 'Restrição mercantil bilateral' : 'Restrição comercial bilateral';
  if (action === 'sanctions') return year < 1800 ? 'Pressão mercantil coordenada' : 'Pressão comercial coordenada';
  if (action === 'route_pressure') return year < 1800 ? 'Pressão sobre rotas mercantis' : 'Pressão sobre rotas comerciais';
  return year < 1800 ? 'Restrição de acesso a mercados' : 'Restrição de acesso comercial';
}

export function TradePressurePanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [targetId, setTargetId] = useState(() => entities.find((entity) => entity.id !== entityId)?.id ?? '');
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-economic-pressure', refresh);
    return () => window.removeEventListener('world-state-economic-pressure', refresh);
  }, []);

  useEffect(() => {
    const result = processEconomicPressure(simulation, warState);
    if (result.changed) {
      Object.assign(simulation.entities, result.simulation.entities);
      simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    }
    processStrategicResources(simulation, warState);
    const resources = applyEconomicPressureToResources(simulation, warState);
    if (result.changed || resources.changed) setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState]);

  void revision;
  const state = economicPressureState();
  const activeByUs = state.measures.filter((measure) => measure.active && measure.initiatorId === entityId);
  const incoming = state.measures.filter((measure) => measure.active && measure.targetId === entityId);
  const access = targetId ? routeMarketAccess(targetId, entityId, simulation, warState) : undefined;

  function start(action: EconomicPressureAction) {
    if (!targetId) return;
    const result = startEconomicPressure(entityId, targetId, action, simulation, warState);
    if (!result.measure) return setMessage(result.error ?? 'Não foi possível aplicar a política comercial.');
    processStrategicResources(simulation, warState);
    applyEconomicPressureToResources(simulation, warState);
    setMessage(`${actionName(action, simulation.date.year)} aplicada a ${names[targetId] ?? targetId}.`);
    setRevision((value) => value + 1);
  }

  function end(id: string) {
    if (!endEconomicPressure(id)) return;
    processStrategicResources(simulation, warState);
    applyEconomicPressureToResources(simulation, warState);
    setMessage('Política comercial encerrada.');
    setRevision((value) => value + 1);
  }

  return <section className="trade-pressure-panel">
    <header className="trade-pressure-heading">
      <div><span>PRESSÃO E RESILIÊNCIA COMERCIAL</span><strong>Acesso a mercados, rotas alternativas e dependência externa</strong></div>
      <div><small>Políticas ativas</small><b>{activeByUs.length}</b></div>
    </header>

    <div className="trade-pressure-target">
      <label>Entidade-alvo<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{entities.filter((entity) => entity.id !== entityId).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
      <span><small>Pressão estimada</small><b>{access ? band(access.pressure) : '—'}</b></span>
      <span><small>Mercados alternativos</small><b>{access ? band(access.alternative * 3) : '—'}</b></span>
    </div>

    <div className="trade-pressure-actions">{actions.map((action) => {
      const already = activeByUs.some((measure) => measure.targetId === targetId && measure.action === action);
      return <button key={action} disabled={!targetId || already} onClick={() => start(action)}><b>{actionName(action, simulation.date.year)}</b><span>{already ? 'Já aplicada' : 'Alterar acesso comercial e segurança das rotas do alvo.'}</span></button>;
    })}</div>

    {!!activeByUs.length && <div className="trade-pressure-list"><strong>Políticas aplicadas</strong>{activeByUs.map((measure) => <div key={measure.id}><span><b>{actionName(measure.action, simulation.date.year)}</b><small>{names[measure.targetId] ?? measure.targetId} • {band(measure.pressure)}</small></span><button onClick={() => end(measure.id)}>Encerrar</button></div>)}</div>}
    {!!incoming.length && <div className="trade-pressure-incoming"><strong>Pressão comercial recebida</strong>{incoming.slice(0, 6).map((measure) => <span key={measure.id}>{actionName(measure.action, simulation.date.year)} • {names[measure.initiatorId] ?? measure.initiatorId} • {band(measure.pressure)}</span>)}</div>}
    {message && <div className="trade-pressure-message">{message}</div>}
    <small className="trade-pressure-note">Mecânica abstrata de grande estratégia. Relações comerciais alternativas podem amortecer a pressão, enquanto alta dependência externa aumenta a vulnerabilidade dos recursos estratégicos.</small>
  </section>;
}
