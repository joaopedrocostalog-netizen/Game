import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import type { ArmyState } from '../engine/army';
import {
  airborneLogisticsForEntity,
  evacuateAirbornePosition,
  processAirborneLogistics,
} from '../engine/airborneLogistics';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './airborne-logistics.css';

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

function stateLabel(state: string) {
  if (state === 'linked') return 'LIGAÇÃO TERRESTRE';
  if (state === 'air-supplied') return 'SUSTENTADA PELO AR';
  if (state === 'strained') return 'LOGÍSTICA PRESSIONADA';
  if (state === 'isolated') return 'ISOLADA';
  if (state === 'collapse-risk') return 'RISCO DE COLAPSO';
  if (state === 'collapsed') return 'POSIÇÃO COLAPSADA';
  return 'EVACUADA';
}
function band(value: number) {
  if (value < 15) return 'CRÍTICA';
  if (value < 35) return 'BAIXA';
  if (value < 60) return 'LIMITADA';
  if (value < 82) return 'ADEQUADA';
  return 'FORTE';
}

export function AirborneLogisticsPanel({ entityId, entities, simulation, warState, armyState, territorialControl, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const locations = useMemo(() => Object.fromEntries(locationsForYear(simulation.date.year).map((location) => [location.id, location])), [simulation.date.year]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-airborne-logistics', refresh);
    window.addEventListener('world-state-airborne-operations', refresh);
    window.addEventListener('world-state-air-campaign', refresh);
    return () => {
      window.removeEventListener('world-state-airborne-logistics', refresh);
      window.removeEventListener('world-state-airborne-operations', refresh);
      window.removeEventListener('world-state-air-campaign', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processAirborneLogistics(simulation, warState, armyState, territorialControl);
    if (result.changed) {
      onArmyStateChange(result.armyState);
      onWarStateChange(result.warState);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const positions = airborneLogisticsForEntity(entityId);

  function evacuate(operationId: string) {
    const result = evacuateAirbornePosition(operationId, simulation, armyState);
    if ('error' in result) {
      setMessage(result.error ?? 'Evacuação indisponível.');
      return;
    }
    onArmyStateChange(result.armyState);
    setMessage('Evacuação aérea concluída. A formação retornou à área de origem com desgaste operacional.');
    setRevision((value) => value + 1);
  }

  return <section className="airborne-logistics-panel">
    <header className="airborne-logistics-heading">
      <div><span>SUSTENTAÇÃO AEROTRANSPORTADA</span><strong>REABASTECIMENTO • ISOLAMENTO • LIGAÇÃO TERRESTRE • EVACUAÇÃO</strong></div>
      <em>{positions.length} POSIÇÃO{positions.length === 1 ? '' : 'ÕES'}</em>
    </header>

    {!positions.length && <div className="airborne-logistics-empty">Nenhuma posição aerotransportada estabelecida exige sustentação neste momento.</div>}

    {!!positions.length && <div className="airborne-logistics-grid">
      {positions.map((position) => {
        const unit = armyState.units.find((candidate) => candidate.id === position.unitId);
        const war = warState.wars.find((candidate) => candidate.id === position.warId);
        const location = locations[position.locationId];
        const terminal = position.state === 'collapsed' || position.state === 'evacuated';
        return <article key={position.operationId} className={`airborne-logistics-card ${position.state}`}>
          <div className="airborne-logistics-card-head">
            <div><b>{location?.name ?? position.locationId}</b><small>{unit?.name ?? position.unitId} • {war ? `${names[war.attackerId] ?? war.attackerId} × ${names[war.defenderId] ?? war.defenderId}` : 'guerra encerrada'}</small></div>
            <em>{stateLabel(position.state)}</em>
          </div>
          <div className="airborne-logistics-stats">
            <span><small>Reservas locais</small><b>{band(position.localReserves)}</b></span>
            <span><small>Reabastecimento aéreo</small><b>{band(position.airSupplyCapacity)}</b></span>
            <span><small>Isolamento</small><b>{position.groundLink ? 'ENCERRADO' : `${Math.round(position.isolationDays)} dias`}</b></span>
            <span><small>Suprimento da tropa</small><b>{unit ? band(unit.supply) : terminal ? '—' : 'SEM DADOS'}</b></span>
            <span><small>Organização</small><b>{unit ? band(unit.organization) : terminal ? '—' : 'SEM DADOS'}</b></span>
            <span><small>Moral</small><b>{unit ? band(unit.morale) : terminal ? '—' : 'SEM DADOS'}</b></span>
          </div>
          {!terminal && <button onClick={() => evacuate(position.operationId)}>EVACUAR PELO AR</button>}
        </article>;
      })}
    </div>}

    {message && <div className="airborne-logistics-message">{message}</div>}
    <small className="airborne-logistics-note">Posições aerotransportadas consomem reservas diariamente. Transporte aéreo dentro do alcance pode retardar o desgaste; a chegada de forças terrestres amigas encerra o isolamento. Sem ligação e sem capacidade aérea suficiente, suprimento, organização, moral, equipamento e efetivos se deterioram até o risco de colapso. A evacuação também exige transporte operacional e gera desgaste.</small>
  </section>;
}
