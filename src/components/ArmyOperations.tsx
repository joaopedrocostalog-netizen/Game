import React, { useEffect, useMemo, useState } from 'react';
import { locationsForEntity, locationsForYear } from '../data/territories';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import type { TerritorialControlState } from '../engine/territorialControl';
import {
  ensureEntityForces,
  forcesForEntity,
  issueMove,
  logisticsScore,
  setUnitOrder,
  supplyLineForUnit,
  type ArmyState,
} from '../engine/army';
import './army-operations.css';

type Props = {
  entityId: string;
  year: number;
  simulation: SimulationState;
  warState: WarState;
  armyState: ArmyState;
  territorialControl: TerritorialControlState;
  onArmyStateChange: (state: ArmyState) => void;
};

function orderLabel(order: string) {
  if (order === 'move') return 'Em movimento';
  if (order === 'retreat') return 'Em retirada';
  if (order === 'prepare') return 'Preparando operação';
  return 'Mantendo posição';
}

export function ArmyOperations({ entityId, year, simulation, warState, armyState, territorialControl, onArmyStateChange }: Props) {
  const activeWarEntities = useMemo(() => {
    const ids = new Set<string>();
    warState.wars.filter((war) => war.status === 'active').forEach((war) => [...war.attackers, ...war.defenders].forEach((id) => ids.add(id)));
    return ids;
  }, [warState]);

  useEffect(() => {
    let next = ensureEntityForces(armyState, simulation, entityId, year);
    for (const participantId of activeWarEntities) next = ensureEntityForces(next, simulation, participantId, year);
    if (next !== armyState) onArmyStateChange(next);
  }, [entityId, year, simulation.entities, activeWarEntities, armyState, onArmyStateChange]);

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
  const selectedSupply = selected ? supplyLineForUnit(selected, year, territorialControl) : undefined;

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
        <div className="commander-traits"><span>Efetivo <b>{Math.round(selected.personnel).toLocaleString('pt-BR')}</b></span><span>Logística <b>{selected.commander.logistics}</b></span><span>Iniciativa <b>{selected.commander.initiative}</b></span></div>
        {selectedSupply && <div className={`supply-line-status ${selectedSupply.state}`}>
          <span>Linha de suprimento</span>
          <strong>{selectedSupply.state === 'connected' ? 'Conectada' : selectedSupply.state === 'strained' ? 'Sob pressão' : 'Interrompida'}</strong>
          <small>{(selectedSupply.efficiency * 100).toFixed(0)}% de eficiência • {Math.round(selectedSupply.distanceKm).toLocaleString('pt-BR')} km até {selectedSupply.sourceLocationId ? (locationNames[selectedSupply.sourceLocationId] ?? selectedSupply.sourceLocationId) : 'nenhuma base segura'}</small>
        </div>}
        <div className="army-order-actions">
          <button className={selected.order === 'hold' ? 'active' : ''} disabled={selected.order === 'retreat'} onClick={() => onArmyStateChange(setUnitOrder(armyState, selected.id, 'hold'))}>Manter posição</button>
          <button className={selected.order === 'prepare' ? 'active' : ''} disabled={selected.order === 'retreat'} onClick={() => onArmyStateChange(setUnitOrder(armyState, selected.id, 'prepare'))}>Preparar</button>
        </div>
        <div className="army-move-row">
          <select value={destinationId} disabled={selected.order === 'retreat'} onChange={(event) => setDestinationId(event.target.value)}>
            {destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <button disabled={!destinationId || selected.order === 'retreat'} onClick={() => onArmyStateChange(issueMove(armyState, selected.id, destinationId))}>Mover formação</button>
        </div>
        {(selected.order === 'move' || selected.order === 'retreat') && <div className="movement-progress"><div><span>{selected.order === 'retreat' ? 'Retirada para' : 'Deslocamento para'} {selected.destinationId ? (locationNames[selected.destinationId] ?? selected.destinationId) : 'destino'}</span><b>{selected.movementProgress.toFixed(0)}%</b></div><i><em style={{ width: `${selected.movementProgress}%` }}/></i></div>}
        <p className="army-note">Baixas agora reduzem efetivo, força, moral, organização e equipamento das próprias formações. Se uma posição for ocupada, unidades derrotadas recuam fisicamente para a location segura mais próxima. Linhas de suprimento dependem de bases ainda controladas pela entidade.</p>
      </div>}
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="army-metric"><div><span>{label}</span><b>{value.toFixed(0)}</b></div><i><em style={{ width: `${Math.max(2, Math.min(100, value))}%` }}/></i></div>;
}
