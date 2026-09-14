import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  amphibiousOperationsState,
  amphibiousTargets,
  amphibiousUnits,
  cancelAmphibiousOperation,
  processAmphibiousOperations,
  startAmphibiousOperation,
} from '../engine/amphibiousOperations';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './amphibious-operations.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

function statusLabel(status: string) {
  if (status === 'preparing') return 'EM PREPARAÇÃO';
  if (status === 'delayed') return 'ADIADA';
  if (status === 'established') return 'CABEÇA DE PRAIA';
  if (status === 'failed') return 'REPELIDA';
  return 'CANCELADA';
}

export function AmphibiousOperationsPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const wars = warState.wars.filter((war) => war.status === 'active' && war.attackers.includes(entityId));
  const [warId, setWarId] = useState(wars[0]?.id ?? '');
  const [unitId, setUnitId] = useState('');
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-amphibious-operations', refresh);
    return () => window.removeEventListener('world-state-amphibious-operations', refresh);
  }, []);

  useEffect(() => {
    const result = processAmphibiousOperations(simulation, armyState, warState);
    if (!result.changed) return;
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    onWarStateChange(result.warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  useEffect(() => {
    if (!warId && wars[0]) setWarId(wars[0].id);
    if (warId && !wars.some((war) => war.id === warId)) setWarId(wars[0]?.id ?? '');
  }, [wars.length, warId]);

  void revision;
  const selectedWar = wars.find((war) => war.id === warId);
  const units = amphibiousUnits(entityId, armyState);
  const targets = warId ? amphibiousTargets(entityId, warId, simulation, warState) : [];
  const operations = amphibiousOperationsState().operations.filter((operation) => operation.entityId === entityId).slice(0, 8);

  useEffect(() => {
    if (!unitId && units[0]) setUnitId(units[0].id);
    if (unitId && !units.some((unit) => unit.id === unitId)) setUnitId(units[0]?.id ?? '');
  }, [units.length, unitId]);

  useEffect(() => {
    if (!targetId && targets[0]) setTargetId(targets[0].id);
    if (targetId && !targets.some((target) => target.id === targetId)) setTargetId(targets[0]?.id ?? '');
  }, [targets.length, targetId]);

  function begin() {
    const result = startAmphibiousOperation(entityId, warId, unitId, targetId, simulation, armyState, warState);
    if (!result.operation) {
      setMessage(result.error ?? 'Não foi possível preparar a operação anfíbia.');
      return;
    }
    setMessage(`Operação anfíbia iniciada. Desembarque previsto para o dia ${result.operation.plannedLandingElapsedDay}.`);
    setRevision((value) => value + 1);
  }

  function cancel(id: string) {
    if (!cancelAmphibiousOperation(id)) return;
    setMessage('A operação anfíbia foi cancelada antes do desembarque.');
    setRevision((value) => value + 1);
  }

  return <section className="amphibious-operations-panel">
    <header className="amphibious-operations-heading">
      <div><span>OPERAÇÕES ANFÍBIAS</span><strong>Preparação, travessia, desembarque e cabeça de praia</strong></div>
      <div className="amphibious-count"><small>Operações</small><b>{operations.filter((operation) => operation.status === 'preparing' || operation.status === 'delayed').length} ativa(s)</b></div>
    </header>

    {!wars.length && <div className="amphibious-empty">Nenhuma guerra ofensiva ativa permite preparar um desembarque neste momento.</div>}

    {!!wars.length && <div className="amphibious-planner">
      <label>Guerra
        <select value={warId} onChange={(event) => setWarId(event.target.value)}>
          {wars.map((war) => <option key={war.id} value={war.id}>{names[war.defenderId] ?? war.defenderId}</option>)}
        </select>
      </label>
      <label>Formação terrestre
        <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} • {Math.round(unit.personnel).toLocaleString('pt-BR')} efetivos</option>)}
        </select>
      </label>
      <label>Costa-alvo
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <button disabled={!selectedWar || !unitId || !targetId} onClick={begin}>Preparar desembarque</button>
    </div>}

    <div className="amphibious-operation-list">
      {operations.map((operation) => {
        const unit = armyState.units.find((item) => item.id === operation.unitId);
        const target = targets.find((item) => item.id === operation.targetLocationId);
        const canCancel = operation.status === 'preparing' || operation.status === 'delayed';
        return <article className={`amphibious-operation ${operation.status}`} key={operation.id}>
          <div className="amphibious-operation-head">
            <div><b>{target?.name ?? operation.targetLocationId}</b><small>{unit?.name ?? operation.unitId}</small></div>
            <em>{statusLabel(operation.status)}</em>
          </div>
          <div className="amphibious-progress"><i style={{ width: `${operation.preparation}%` }}/></div>
          <div className="amphibious-meta">
            <span><small>Preparação</small><b>{operation.preparation.toFixed(0)}%</b></span>
            <span><small>Dia planejado</small><b>{operation.plannedLandingElapsedDay}</b></span>
            <span><small>Transporte exigido</small><b>{operation.transportRequired.toFixed(0)}</b></span>
          </div>
          {operation.delayReason && <p>{operation.delayReason}</p>}
          {operation.result === 'secure-beachhead' && <p>Cabeça de praia consolidada. A nova frente terrestre já foi aberta.</p>}
          {operation.result === 'contested-landing' && <p>A força permaneceu na costa, mas a posição continua contestada.</p>}
          {operation.result === 'repulsed' && <p>O desembarque foi repelido e a formação retornou ao porto com perdas.</p>}
          {canCancel && <button onClick={() => cancel(operation.id)}>Cancelar operação</button>}
        </article>;
      })}
    </div>

    {message && <div className="amphibious-message">{message}</div>}
    <small className="amphibious-note">A operação exige transporte e cobertura naval na zona do alvo. Preparação consome tempo e pode ser adiada se o controle marítimo piorar. No sucesso, a formação desembarca na costa e abre uma nova frente; a partir daí, logística, combate e ocupação seguem o motor terrestre normal.</small>
  </section>;
}
