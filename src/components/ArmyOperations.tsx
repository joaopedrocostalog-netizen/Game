import React, { useEffect, useMemo, useState } from 'react';
import { locationsForEntity, locationsForYear } from '../data/territories';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import {
  createInitialArmyState,
  ensureEntityForces,
  forcesForEntity,
  issueMove,
  logisticsScore,
  setUnitOrder,
  simulateArmyToElapsed,
  type ArmyState,
} from '../engine/army';
import './army-operations.css';

type Props = {
  entityId: string;
  year: number;
  simulation: SimulationState;
  warState: WarState;
};

function orderLabel(order: string) {
  if (order === 'move') return 'Em movimento';
  if (order === 'prepare') return 'Preparando operação';
  return 'Mantendo posição';
}

export function ArmyOperations({ entityId, year, simulation, warState }: Props) {
  const [armyState, setArmyState] = useState<ArmyState>(() => createInitialArmyState());
  const activeWarEntities = useMemo(() => {
    const ids = new Set<string>();
    warState.wars.filter((war) => war.status === 'active').forEach((war) => [...war.attackers, ...war.defenders].forEach((id) => ids.add(id)));
    return ids;
  }, [warState]);

  useEffect(() => {
    setArmyState((state) => ensureEntityForces(state, simulation, entityId, year));
  }, [entityId, year, simulation.entities]);

  useEffect(() => {
    setArmyState((state) => simulateArmyToElapsed(state, simulation, activeWarEntities));
  }, [simulation.elapsedDays, activeWarEntities]);

  const units = forcesForEntity(armyState, entityId);
  const destinations = locationsForYear(year);
  const owned = locationsForEntity(entityId, year);
  const locationNames = useMemo(() => Object.fromEntries(destinations.map((item) => [item.id, item.name])), [destinations]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [destinationId, setDestinationId] = useState('');

  useEffect(() => {
    if (!units.length) return;
    if (!units.some((item) => item.id === selectedUnitId)) setSelectedUnitId(units[0].id);
  }, [units, selectedUnitId]);

  useEffect(() => {
    if (!destinationId && owned[0]) setDestinationId(owned[0].id);
  }, [destinationId, owned]);

  const logistics = logisticsScore(armyState, entityId);
  const selected = units.find((item) => item.id === selectedUnitId);

  return <div className="army-operations">
    <div className="context-kicker">Exércitos, comandantes e logística</div>
    <div className="army-summary-grid">
      <div><span>Formações</span><strong>{units.length}</strong></div>
      <div><span>Logística</span><strong>{logistics.toFixed(1)}</strong></div>
      <div><span>Efetivo</span><strong>{Math.round(units.reduce((sum, unit) => sum + unit.personnel, 0)).toLocaleString('pt-BR')}</strong></div>
    </div>

    {!units.length ? <div className="army-empty">Esta entidade ainda não possui locations suficientes para gerar formações operacionais.</div> : <>
      <div className="army-unit-list">
        {units.map((unit) => <button key={unit.id} className={selectedUnitId === unit.id ? 'army-unit active' : 'army-unit'} onClick={() => setSelectedUnitId(unit.id)}>
          <div><strong>{unit.name}</strong><span>{locationNames[unit.locationId] ?? unit.locationId}</span></div>
          <div><b>{unit.strength.toFixed(0)}%</b><span>{orderLabel(unit.order)}</span></div>
        </button>)}
      </div>

      {selected && <div className="army-detail-card">
        <div className="army-commander"><div><span>Comandante</span><strong>{selected.commander.name}</strong></div><div><b>{selected.commander.skill}</b><span>competência</span></div></div>
        <div className="army-bars">
          <Metric label="Força" value={selected.strength}/>
          <Metric label="Moral" value={selected.morale}/>
          <Metric label="Organização" value={selected.organization}/>
          <Metric label="Suprimento" value={selected.supply}/>
          <Metric label="Equipamento" value={selected.equipment}/>
        </div>
        <div className="commander-traits"><span>Logística <b>{selected.commander.logistics}</b></span><span>Iniciativa <b>{selected.commander.initiative}</b></span></div>
        <div className="army-order-actions">
          <button className={selected.order === 'hold' ? 'active' : ''} onClick={() => setArmyState((state) => setUnitOrder(state, selected.id, 'hold'))}>Manter posição</button>
          <button className={selected.order === 'prepare' ? 'active' : ''} onClick={() => setArmyState((state) => setUnitOrder(state, selected.id, 'prepare'))}>Preparar</button>
        </div>
        <div className="army-move-row">
          <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
            {destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <button disabled={!destinationId} onClick={() => setArmyState((state) => issueMove(state, selected.id, destinationId))}>Mover formação</button>
        </div>
        {selected.order === 'move' && <div className="movement-progress"><div><span>Deslocamento para {selected.destinationId ? (locationNames[selected.destinationId] ?? selected.destinationId) : 'destino'}</span><b>{selected.movementProgress.toFixed(0)}%</b></div><i><em style={{ width: `${selected.movementProgress}%` }}/></i></div>}
        <p className="army-note">Movimentos, preparação e desgaste logístico avançam com o relógio principal da campanha. Guerra ativa aumenta consumo de suprimentos e reduz organização.</p>
      </div>}
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="army-metric"><div><span>{label}</span><b>{value.toFixed(0)}</b></div><i><em style={{ width: `${Math.max(2, Math.min(100, value))}%` }}/></i></div>;
}
