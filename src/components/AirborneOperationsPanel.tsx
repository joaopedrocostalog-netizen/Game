import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import type { ArmyState } from '../engine/army';
import { airFormationsForEntity } from '../engine/airCampaign';
import { airOperationalReach } from '../engine/airBaseNetwork';
import {
  airborneEraAvailable,
  airborneEraLabel,
  airborneOperationsForEntity,
  processAirborneOperations,
  startAirborneOperation,
} from '../engine/airborneOperations';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './airborne-operations.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

function statusLabel(status: string) {
  if (status === 'preparing') return 'EM PREPARAÇÃO';
  if (status === 'ready') return 'AGUARDANDO CONDIÇÕES';
  if (status === 'established') return 'POSIÇÃO ESTABELECIDA';
  if (status === 'failed') return 'OPERAÇÃO REPELIDA';
  return 'CANCELADA';
}
function resultLabel(result?: string) {
  if (result === 'secure-lodgement') return 'posição consolidada';
  if (result === 'dispersed-lodgement') return 'posição dispersa e vulnerável';
  if (result === 'repelled') return 'lançamento repelido';
  return 'resultado pendente';
}
function band(value: number) {
  if (value < 25) return 'BAIXA';
  if (value < 50) return 'LIMITADA';
  if (value < 75) return 'ADEQUADA';
  return 'FORTE';
}

export function AirborneOperationsPanel({ entityId, entities, simulation, warState, armyState, territorialControl, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [warId, setWarId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [transportId, setTransportId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const locations = useMemo(() => locationsForYear(simulation.date.year), [simulation.date.year]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-airborne-operations', refresh);
    window.addEventListener('world-state-air-campaign', refresh);
    return () => {
      window.removeEventListener('world-state-airborne-operations', refresh);
      window.removeEventListener('world-state-air-campaign', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processAirborneOperations(simulation, warState, armyState, territorialControl);
    if (result.changed) {
      onArmyStateChange(result.armyState);
      onWarStateChange(result.warState);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const available = airborneEraAvailable(simulation.date.year);
  const wars = warState.wars.filter((war) => war.status === 'active' && war.attackers.includes(entityId));
  const selectedWar = wars.find((war) => war.id === warId) ?? wars[0];
  const enemyIds = new Set(selectedWar?.defenders ?? []);
  const units = armyState.units.filter((unit) => unit.entityId === entityId && unit.personnel <= 18000 && unit.organization >= 38 && unit.supply >= 40 && unit.order !== 'retreat');
  const transports = airFormationsForEntity(entityId).filter((formation) => formation.mission === 'air-transport');
  const targets = selectedWar ? locations.filter((location) => {
    const occupation = territorialControl.occupations[location.id];
    const controller = occupation?.controllerId ?? location.controllerId ?? location.ownerId;
    return !!controller && enemyIds.has(controller);
  }) : [];
  const operations = airborneOperationsForEntity(entityId);
  const selectedTransport = transports.find((formation) => formation.id === transportId) ?? transports[0];
  const selectedTarget = targets.find((location) => location.id === targetId) ?? targets[0];
  const reach = selectedTransport && selectedTarget ? airOperationalReach(selectedTransport, selectedTarget.id, simulation) : undefined;

  function launchPlanning() {
    const war = selectedWar;
    const unit = units.find((item) => item.id === (unitId || units[0]?.id));
    const transport = transports.find((item) => item.id === (transportId || transports[0]?.id));
    const target = targets.find((item) => item.id === (targetId || targets[0]?.id));
    if (!war || !unit || !transport || !target) {
      setMessage('Selecione guerra, formação terrestre, transporte e alvo válidos.');
      return;
    }
    const result = startAirborneOperation(entityId, war.id, unit.id, transport.id, target.id, simulation, warState, armyState, territorialControl);
    if ('error' in result) setMessage(result.error ?? 'Não foi possível preparar a operação.');
    else setMessage(`Operação preparada para ${target.name}. Ela será executada quando a preparação e as condições aéreas permitirem.`);
    setRevision((value) => value + 1);
  }

  return <section className="airborne-panel">
    <header className="airborne-heading">
      <div><span>OPERAÇÕES AEROTRANSPORTADAS</span><strong>{airborneEraLabel(simulation.date.year)}</strong></div>
      <em>{available ? 'ALCANCE • TRANSPORTE • CONTROLE DO AR • ISOLAMENTO' : 'INDISPONÍVEL'}</em>
    </header>

    {!available && <div className="airborne-empty">Nesta época ainda não existe uma capacidade institucional de lançamento aerotransportado que justifique uma mecânica independente.</div>}

    {available && <>
      <div className="airborne-planner">
        <label>Guerra ofensiva
          <select value={selectedWar?.id ?? ''} onChange={(event) => { setWarId(event.target.value); setTargetId(''); }}>
            {!wars.length && <option value="">Nenhuma guerra ofensiva ativa</option>}
            {wars.map((war) => <option key={war.id} value={war.id}>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</option>)}
          </select>
        </label>
        <label>Formação terrestre
          <select value={unitId || units[0]?.id || ''} onChange={(event) => setUnitId(event.target.value)}>
            {!units.length && <option value="">Nenhuma formação elegível</option>}
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} — {Math.round(unit.personnel).toLocaleString('pt-BR')} efetivos</option>)}
          </select>
        </label>
        <label>Transporte aéreo
          <select value={transportId || transports[0]?.id || ''} onChange={(event) => setTransportId(event.target.value)}>
            {!transports.length && <option value="">Nenhuma formação em transporte aéreo</option>}
            {transports.map((formation) => <option key={formation.id} value={formation.id}>{formation.name}</option>)}
          </select>
        </label>
        <label>Área de lançamento
          <select value={targetId || targets[0]?.id || ''} onChange={(event) => setTargetId(event.target.value)}>
            {!targets.length && <option value="">Nenhum alvo inimigo disponível</option>}
            {targets.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <div className="airborne-readiness">
          <span><small>Alcance</small><b>{reach ? (reach.reachable ? 'DISPONÍVEL' : 'FORA DO ALCANCE') : '—'}</b></span>
          <span><small>Eficiência da rota aérea</small><b>{reach ? band(reach.factor * 100) : '—'}</b></span>
        </div>
        <button disabled={!selectedWar || !units.length || !transports.length || !targets.length || (reach ? !reach.reachable : true)} onClick={launchPlanning}>PREPARAR OPERAÇÃO</button>
      </div>

      <div className="airborne-list">
        <strong>Operações e posições aerotransportadas</strong>
        {!operations.length && <small>Nenhuma operação aerotransportada registrada nesta campanha.</small>}
        {operations.map((operation) => {
          const unit = armyState.units.find((item) => item.id === operation.unitId);
          const target = locations.find((location) => location.id === operation.targetLocationId);
          return <article key={operation.id} className={`airborne-operation ${operation.status}`}>
            <div><b>{target?.name ?? operation.targetLocationId}</b><small>{unit?.name ?? operation.unitId}</small></div>
            <span><small>Preparação</small><b>{Math.round(operation.preparation)}%</b></span>
            <span><small>Isolamento</small><b>{operation.status === 'established' ? band(operation.isolation) : '—'}</b></span>
            <em>{statusLabel(operation.status)}<small>{resultLabel(operation.result)}</small></em>
          </article>;
        })}
      </div>
    </>}

    {message && <div className="airborne-message">{message}</div>}
    <small className="airborne-note">Mecânica abstrata de grande estratégia. O jogo considera alcance, capacidade de transporte, prontidão, controle do ar, terreno e condição da força. Um lançamento bem-sucedido cria ou reforça uma frente atrás das linhas, mas a formação chega com suprimentos limitados e pode ficar isolada se não houver ligação posterior com a campanha terrestre.</small>
  </section>;
}
