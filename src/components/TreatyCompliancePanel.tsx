import React, { useEffect, useMemo, useState } from 'react';
import { locationsForYear } from '../data/territories';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import type { SimulationState } from '../engine/simulation';
import {
  complianceRecordsForEntity,
  guaranteeTreaty,
  processTreatyCompliance,
  treatyComplianceState,
  withdrawTreatyGuarantee,
  type TreatyComplianceStatus,
} from '../engine/treatyCompliance';
import { territorialPeaceState } from '../engine/territorialPeace';
import type { TerritorialControlState } from '../engine/territorialControl';
import './treaty-compliance.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onSimulationStateChange: (state: SimulationState) => void;
};

type ControlGlobal = typeof globalThis & { __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

function statusLabel(status: TreatyComplianceStatus) {
  if (status === 'compliant') return 'EM CUMPRIMENTO';
  if (status === 'warning') return 'SOB ALERTA';
  if (status === 'breach') return 'VIOLAÇÃO';
  return 'CRISE INTERNACIONAL';
}
function band(value: number) {
  if (value < 20) return 'BAIXO';
  if (value < 45) return 'MODERADO';
  if (value < 70) return 'ELEVADO';
  return 'CRÍTICO';
}

export function TreatyCompliancePanel({ entityId, entities, simulation, armyState, territorialControl, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-treaty-compliance', refresh);
    window.addEventListener('world-state-territorial-peace', refresh);
    return () => {
      window.removeEventListener('world-state-treaty-compliance', refresh);
      window.removeEventListener('world-state-territorial-peace', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processTreatyCompliance(simulation, armyState, territorialControl);
    if (!result.changed) return;
    onSimulationStateChange(result.simulation);
    Object.keys(territorialControl.occupations).forEach((key) => delete territorialControl.occupations[key]);
    Object.assign(territorialControl.occupations, result.territorialControl.occupations);
    const published = { ...territorialControl, occupations: { ...territorialControl.occupations }, battles: [...territorialControl.battles] };
    (globalThis as ControlGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ = published;
    window.dispatchEvent(new CustomEvent('world-state-territorial-control', { detail: published }));
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const locations = useMemo(() => new Map(locationsForYear(simulation.date.year).map((item) => [item.id, item.name])), [simulation.date.year]);
  const peace = territorialPeaceState();
  const records = complianceRecordsForEntity(entityId);
  const allRecords = treatyComplianceState().records;
  const external = peace.settlements.filter((settlement) => settlement.status === 'signed' && settlement.leaderId !== entityId && settlement.opponentId !== entityId && !allRecords[settlement.id]?.guarantorIds.includes(entityId)).slice(0, 4);
  const guaranteed = records.filter((record) => record.guarantorIds.includes(entityId));
  const involved = records.filter((record) => record.leaderId === entityId || record.opponentId === entityId);
  if (!peace.settlements.some((item) => item.status === 'signed')) return null;

  function guarantee(treatyId: string) {
    const result = guaranteeTreaty(entityId, treatyId);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }
  function withdraw(treatyId: string) {
    const result = withdrawTreatyGuarantee(entityId, treatyId);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  return <section className="treaty-compliance-panel">
    <header className="treaty-compliance-heading">
      <div><span>CUMPRIMENTO DO TRATADO</span><strong>Garantias, reparações, retirada militar e revanchismo</strong></div>
      <em>{records.some((item) => item.status === 'crisis') ? 'CRISE DE TRATADO ATIVA' : records.some((item) => item.status === 'breach') ? 'VIOLAÇÃO DETECTADA' : 'FISCALIZAÇÃO ATIVA'}</em>
    </header>

    {[...involved, ...guaranteed].map((record) => {
      const unresolved = record.violations.filter((item) => item.resolvedAtElapsedDay === undefined);
      const openCrises = record.crises.filter((item) => item.status === 'open');
      const ownRevanchism = record.revanchism[entityId] ?? 0;
      return <article className={`treaty-compliance-card ${record.status}`} key={record.treatyId}>
        <div className="treaty-compliance-card-head"><div><b>{names[record.leaderId] ?? record.leaderId} × {names[record.opponentId] ?? record.opponentId}</b><span>{record.guarantorIds.length} garantidor(es) externo(s)</span></div><strong>{statusLabel(record.status)}</strong></div>

        <div className="treaty-compliance-metrics">
          <span><small>Violações abertas</small><b>{unresolved.length}</b></span>
          <span><small>Crises abertas</small><b>{openCrises.length}</b></span>
          <span><small>Revanchismo próprio</small><b>{band(ownRevanchism)}</b></span>
        </div>

        {!!record.reparations.length && <div className="treaty-compliance-section"><strong>Reparações</strong>{record.reparations.map((schedule) => {
          const progress = Math.min(100, schedule.total ? schedule.paid / schedule.total * 100 : 100);
          return <div className="treaty-compliance-progress" key={schedule.clauseId}><div><span>{names[schedule.payerId] ?? schedule.payerId} → {names[schedule.receiverId] ?? schedule.receiverId}</span><b>{schedule.completed ? 'QUITADO' : `${progress.toFixed(0)}% pago`}</b></div><i><em style={{ width: `${progress}%` }}/></i></div>;
        })}</div>}

        {!!record.occupations.length && <div className="treaty-compliance-section"><strong>Ocupações temporárias</strong>{record.occupations.map((schedule) => <div className="treaty-compliance-line" key={schedule.clauseId}><span>{locations.get(schedule.locationId) ?? schedule.locationId}</span><b>{schedule.released ? 'ENCERRADA' : `${Math.max(0, schedule.expiresAtElapsedDay - simulation.elapsedDays)} dias restantes`}</b></div>)}</div>}

        {!!unresolved.length && <div className="treaty-compliance-section danger"><strong>Violações em aberto</strong>{unresolved.slice(0, 5).map((violation) => <div className="treaty-compliance-violation" key={violation.id}><span>{violation.description}</span><b>{names[violation.violatorId] ?? violation.violatorId} • gravidade {violation.severity.toFixed(0)}</b></div>)}</div>}

        {!!openCrises.length && <div className="treaty-compliance-section crisis"><strong>Crises de cumprimento</strong>{openCrises.map((crisis) => <div className="treaty-compliance-violation" key={crisis.id}><span>{crisis.reason}</span><b>{crisis.claimantIds.map((id) => names[id] ?? id).join(', ')} • pressão {crisis.severity.toFixed(0)}</b></div>)}</div>}

        {record.guarantorIds.includes(entityId) && <button className="treaty-compliance-withdraw" onClick={() => withdraw(record.treatyId)}>Retirar garantia</button>}
      </article>;
    })}

    {!!external.length && <div className="treaty-compliance-external"><strong>Tratados externos disponíveis para garantia</strong>{external.map((settlement) => <div key={settlement.id}><span>{names[settlement.leaderId] ?? settlement.leaderId} × {names[settlement.opponentId] ?? settlement.opponentId}</span><button onClick={() => guarantee(settlement.id)}>Assumir garantia</button></div>)}</div>}
    {message && <div className="treaty-compliance-message">{message}</div>}

    <small className="treaty-compliance-note">Garantias não iniciam uma guerra automaticamente. Violações graves criam uma crise diplomática, deterioram relações e acumulam revanchismo; esse registro pode alimentar exigências, isolamento, novas coalizões e futuros casus belli. Zonas desmilitarizadas são verificadas pela presença real das formações no mapa, e ocupações temporárias devolvem o controle administrativo ao fim do prazo.</small>
  </section>;
}
