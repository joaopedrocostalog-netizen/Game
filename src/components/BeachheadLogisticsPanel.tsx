import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { amphibiousOperationsState } from '../engine/amphibiousOperations';
import {
  beachheadLogisticsState,
  processBeachheadLogistics,
  requestBeachheadEvacuation,
  type BeachheadSupplyStatus,
} from '../engine/beachheadLogistics';
import type { ArmyState } from '../engine/army';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './beachhead-logistics.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

function statusLabel(status: BeachheadSupplyStatus) {
  if (status === 'secure') return 'ROTA SEGURA';
  if (status === 'strained') return 'LOGÍSTICA PRESSIONADA';
  if (status === 'isolated') return 'ISOLADA';
  if (status === 'collapsing') return 'EM COLAPSO';
  if (status === 'evacuated') return 'EVACUADA';
  return 'PERDIDA';
}

function band(value: number) {
  if (value < 20) return 'CRÍTICA';
  if (value < 38) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}

function portLabel(value: 'captured-port' | 'improvised-shore' | 'none') {
  if (value === 'captured-port') return 'PORTO OPERACIONAL';
  if (value === 'improvised-shore') return 'DESCARGA IMPROVISADA';
  return 'SEM ACESSO PORTUÁRIO';
}

export function BeachheadLogisticsPanel({ entityId, entities, simulation, armyState, warState, territorialControl, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-beachhead-logistics', refresh);
    return () => window.removeEventListener('world-state-beachhead-logistics', refresh);
  }, []);

  useEffect(() => {
    const result = processBeachheadLogistics(simulation, armyState, warState, territorialControl);
    if (!result.changed) return;
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    onWarStateChange(result.warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, territorialControl, warState.wars.length]);

  void revision;
  const operations = amphibiousOperationsState().operations.filter((operation) => operation.entityId === entityId && operation.status === 'established');
  const state = beachheadLogisticsState();
  const records = operations.map((operation) => ({ operation, record: state.records[operation.id] })).filter((item) => item.record);

  function evacuate(operationId: string) {
    const result = requestBeachheadEvacuation(operationId, armyState, warState);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    onArmyStateChange(result.armyState);
    onWarStateChange(result.warState);
    setMessage('Retirada marítima ordenada. A formação está retornando ao porto de origem.');
    setRevision((value) => value + 1);
  }

  if (!records.length) return null;

  return <section className="beachhead-logistics-panel">
    <header className="beachhead-logistics-heading">
      <div><span>LOGÍSTICA DA CABEÇA DE PRAIA</span><strong>Descarga marítima, reservas locais, isolamento e evacuação</strong></div>
      <em>{records.filter(({ record }) => ['secure', 'strained', 'isolated', 'collapsing'].includes(record.status)).length} posição(ões) ativa(s)</em>
    </header>

    <div className="beachhead-logistics-grid">
      {records.map(({ operation, record }) => {
        const unit = armyState.units.find((item) => item.id === record.unitId);
        const war = warState.wars.find((item) => item.id === record.warId);
        const targetName = war?.fronts.find((front) => front.locationId === record.targetLocationId)?.name.replace('Cabeça de praia de ', '') ?? record.targetLocationId;
        return <article className={`beachhead-card status-${record.status}`} key={operation.id}>
          <div className="beachhead-card-head">
            <div><b>{targetName}</b><small>{unit?.name ?? 'Formação desembarcada'} • {names[operation.entityId] ?? operation.entityId}</small></div>
            <strong>{statusLabel(record.status)}</strong>
          </div>
          <div className="beachhead-stats">
            <span><small>Capacidade de descarga</small><b>{band(record.throughput)}</b></span>
            <span><small>Reservas locais</small><b>{record.reserveDays < 3 ? 'CRÍTICAS' : record.reserveDays < 8 ? 'BAIXAS' : record.reserveDays < 18 ? 'ADEQUADAS' : 'ROBUSTAS'}</b></span>
            <span><small>Acesso costeiro</small><b>{portLabel(record.portAccess)}</b></span>
            <span><small>Isolamento</small><b>{record.isolatedDays < 1 ? 'NENHUM' : record.isolatedDays < 7 ? 'RECENTE' : record.isolatedDays < 20 ? 'PROLONGADO' : 'SEVERO'}</b></span>
          </div>
          <div className="beachhead-reserve-meter"><i style={{ width: `${Math.min(100, record.reserveDays / 45 * 100)}%` }}/></div>
          <p>{record.portAccess === 'captured-port'
            ? 'Um porto operacional amplia o fluxo de reforços e suprimentos para a frente costeira.'
            : 'A sustentação depende de descarga costeira improvisada e é mais sensível à perda de transporte ou cobertura naval.'}</p>
          {['secure', 'strained', 'isolated', 'collapsing'].includes(record.status) && <button onClick={() => evacuate(operation.id)}>Evacuar por mar</button>}
        </article>;
      })}
    </div>

    {message && <div className="beachhead-logistics-message">{message}</div>}
    <small className="beachhead-logistics-note">A posição costeira depende continuamente da ligação marítima. Queda de transporte, perda de cobertura naval ou ausência de porto reduzem abastecimento e organização. Isolamento prolongado pode forçar evacuação ou destruir a capacidade operacional da formação.</small>
  </section>;
}
