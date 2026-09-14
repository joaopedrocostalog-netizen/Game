import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { fleetsForEntity, seaZoneLabel, type SeaZoneId } from '../engine/navalForces';
import {
  amphibiousReadiness,
  navalWarfareState,
  processNavalWarfare,
  sendFleetForRepairs,
  startNavalConstruction,
} from '../engine/navalWarfare';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './naval-warfare.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

const zones: SeaZoneId[] = ['north-atlantic', 'south-atlantic', 'mediterranean', 'baltic', 'indian-ocean', 'west-pacific', 'east-pacific'];

function band(value: number) {
  if (value < 20) return 'CRÍTICA';
  if (value < 38) return 'LIMITADA';
  if (value < 62) return 'ADEQUADA';
  if (value < 82) return 'FORTE';
  return 'MUITO FORTE';
}

function outcomeLabel(value: 'decisive' | 'advantage' | 'inconclusive') {
  if (value === 'decisive') return 'RESULTADO DECISIVO';
  if (value === 'advantage') return 'VANTAGEM LOCAL';
  return 'INCONCLUSIVO';
}

export function NavalWarfarePanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-naval-warfare', refresh);
    window.addEventListener('world-state-naval-forces', refresh);
    return () => {
      window.removeEventListener('world-state-naval-warfare', refresh);
      window.removeEventListener('world-state-naval-forces', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processNavalWarfare(simulation, warState);
    if (!result.changed) return;
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState]);

  void revision;
  const state = navalWarfareState();
  const fleets = fleetsForEntity(entityId);
  const activeBuild = state.construction.find((order) => order.entityId === entityId && order.status === 'building');
  const recentBattles = state.battles.filter((battle) => battle.sideA.includes(entityId) || battle.sideB.includes(entityId)).slice(0, 5);
  const coastal = fleets.length > 0;

  function build() {
    const result = startNavalConstruction(entityId, simulation);
    if (!result.order) {
      setMessage(result.error ?? 'Não foi possível iniciar a construção naval.');
      return;
    }
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    setMessage(`${result.order.label} entrou em construção.`);
    setRevision((value) => value + 1);
  }

  function repair(fleetId: string) {
    if (!sendFleetForRepairs(fleetId)) {
      setMessage('Não foi possível enviar essa formação para reparos.');
      return;
    }
    setMessage('A formação recebeu ordem de retornar ao porto para reparos e recomposição.');
    setRevision((value) => value + 1);
  }

  return <section className="naval-warfare-panel">
    <header className="naval-warfare-heading">
      <div><span>ARSENAIS E GUERRA NAVAL</span><strong>Construção, perdas, reparos e capacidade anfíbia</strong></div>
      <button disabled={!coastal || !!activeBuild} onClick={build}>{!coastal ? 'Sem base naval disponível' : activeBuild ? 'Construção em andamento' : 'Encomendar nova formação'}</button>
    </header>

    {activeBuild && <div className="naval-build-card">
      <div><b>{activeBuild.label}</b><span>Estaleiro-base: {activeBuild.portId}</span></div>
      <strong>Conclusão no dia {activeBuild.completesAtElapsedDay}</strong>
      <small>{activeBuild.vessels} embarcações agregadas • custo {activeBuild.cost} • a formação será comissionada em porto e precisará receber missão.</small>
    </div>}

    {!!fleets.length && <div className="naval-repair-grid">
      {fleets.map((fleet) => <article key={fleet.id}>
        <div><b>{fleet.name}</b><small>{seaZoneLabel(fleet.zoneId)} • {fleet.vessels} navios</small></div>
        <span><small>Prontidão</small><strong>{band(fleet.readiness)}</strong></span>
        <span><small>Suprimento</small><strong>{band(fleet.supply)}</strong></span>
        <button disabled={fleet.mission === 'harbor' && fleet.readiness >= 88 && fleet.supply >= 90} onClick={() => repair(fleet.id)}>Retornar para reparos</button>
      </article>)}
    </div>}

    <div className="naval-amphibious-grid">
      {zones.map((zoneId) => {
        const readiness = amphibiousReadiness(entityId, zoneId);
        return <div className={`naval-amphibious ${readiness.available ? 'available' : ''}`} key={zoneId}>
          <b>{seaZoneLabel(zoneId)}</b>
          <span>{readiness.available ? 'DESEMBARQUE DISPONÍVEL' : 'CAPACIDADE INSUFICIENTE'}</span>
          <small>Transporte {band(readiness.transport)} • cobertura {band(readiness.cover)} • prontidão anfíbia {band(readiness.score)}</small>
        </div>;
      })}
    </div>

    <div className="naval-battle-history">
      <strong>Confrontos navais recentes</strong>
      {!recentBattles.length && <p>Nenhum confronto naval envolvendo esta entidade foi registrado.</p>}
      {recentBattles.map((battle) => {
        const ourSideA = battle.sideA.includes(entityId);
        const ourLosses = ourSideA ? battle.lossesA : battle.lossesB;
        const enemyLosses = ourSideA ? battle.lossesB : battle.lossesA;
        const enemies = (ourSideA ? battle.sideB : battle.sideA).map((id) => names[id] ?? id).join(', ');
        return <div key={battle.id}>
          <span><b>{seaZoneLabel(battle.zoneId)}</b><small>contra {enemies || 'força adversária'} • dia {battle.occurredAtElapsedDay}</small></span>
          <em>{outcomeLabel(battle.outcome)}</em>
          <small>Perdas próprias: {ourLosses} • perdas adversárias estimadas: {enemyLosses}</small>
        </div>;
      })}
    </div>

    {message && <div className="naval-warfare-message">{message}</div>}
    <small className="naval-warfare-note">As embarcações são agregadas em formações estratégicas. Batalhas surgem quando forças de países em guerra operam na mesma zona marítima. Perdas são permanentes; formações muito danificadas retornam ao porto. A prontidão anfíbia exige transporte e cobertura marítima suficientes.</small>
  </section>;
}
