import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  fleetsForEntity,
  moveFleetToZone,
  navalMissionLabel,
  navalState,
  processNavalForces,
  seaZoneLabel,
  setNavalMission,
  type NavalMission,
  type SeaZoneId,
} from '../engine/navalForces';
import { applyNavalControlToResources } from '../engine/navalResourceAccess';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './naval-forces.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
};

const zones: SeaZoneId[] = ['north-atlantic', 'south-atlantic', 'mediterranean', 'baltic', 'indian-ocean', 'west-pacific', 'east-pacific'];
const missions: NavalMission[] = ['harbor', 'sea-control', 'escort', 'transport', 'reserve'];

function band(value: number) {
  if (value < 25) return 'BAIXA';
  if (value < 45) return 'LIMITADA';
  if (value < 68) return 'ADEQUADA';
  if (value < 84) return 'FORTE';
  return 'MUITO FORTE';
}

export function NavalForcesPanel({ entityId, entities, simulation, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-naval-forces', refresh);
    return () => window.removeEventListener('world-state-naval-forces', refresh);
  }, []);

  useEffect(() => {
    processNavalForces(simulation, warState);
    applyNavalControlToResources(simulation, warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays, warState]);

  void revision;
  const fleets = fleetsForEntity(entityId);
  const state = navalState();
  const controlled = state.zones.filter((zone) => zone.controllerId === entityId);
  const contested = state.zones.filter((zone) => zone.contested && zone.powers[entityId]);
  const transport = fleets.reduce((sum, fleet) => sum + (fleet.mission === 'transport' ? fleet.transportCapacity * fleet.readiness / 100 : 0), 0);
  const escort = fleets.reduce((sum, fleet) => sum + (fleet.mission === 'escort' ? fleet.power * fleet.readiness / 100 : 0), 0);

  function changeMission(fleetId: string, mission: NavalMission) {
    if (!setNavalMission(fleetId, mission)) return;
    setMessage(`Missão naval alterada para ${navalMissionLabel(mission, simulation.date.year)}.`);
    applyNavalControlToResources(simulation, warState);
    setRevision((value) => value + 1);
  }

  function changeZone(fleetId: string, zoneId: SeaZoneId) {
    if (!moveFleetToZone(fleetId, zoneId)) {
      setMessage('A frota não possui alcance suficiente para esse deslocamento no estado atual.');
      return;
    }
    setMessage(`Frota transferida para ${seaZoneLabel(zoneId)}.`);
    applyNavalControlToResources(simulation, warState);
    setRevision((value) => value + 1);
  }

  return <section className="naval-forces-panel">
    <header className="naval-forces-heading">
      <div><span>COMANDO NAVAL</span><strong>Frotas, zonas marítimas, escolta e transporte</strong></div>
      <div className="naval-summary"><small>Presença naval</small><b>{fleets.length ? `${fleets.length} formação${fleets.length > 1 ? 'ões' : ''}` : 'SEM FROTA'}</b></div>
    </header>

    {!fleets.length && <div className="naval-empty">{names[entityId] ?? entityId} não possui atualmente um porto costeiro elegível ou capacidade naval suficiente para manter uma frota oceânica.</div>}

    {!!fleets.length && <div className="naval-overview">
      <span><small>Zonas sob controle</small><b>{controlled.length}</b></span>
      <span><small>Zonas contestadas</small><b>{contested.length}</b></span>
      <span><small>Proteção de comboios</small><b>{band(escort)}</b></span>
      <span><small>Transporte estratégico</small><b>{band(transport)}</b></span>
    </div>}

    <div className="naval-fleet-grid">
      {fleets.map((fleet) => <article key={fleet.id}>
        <div className="naval-fleet-head"><div><b>{fleet.name}</b><small>{seaZoneLabel(fleet.zoneId)}</small></div><em>{fleet.vessels} navios</em></div>
        <div className="naval-readiness-row">
          <span><small>Prontidão</small><b>{band(fleet.readiness)}</b></span>
          <span><small>Suprimento</small><b>{band(fleet.supply)}</b></span>
          <span><small>Poder naval</small><b>{band(fleet.power)}</b></span>
          <span><small>Alcance</small><b>{band(fleet.range)}</b></span>
        </div>
        <div className="naval-controls">
          <label>Missão<select value={fleet.mission} onChange={(event) => changeMission(fleet.id, event.target.value as NavalMission)}>{missions.map((mission) => <option value={mission} key={mission}>{navalMissionLabel(mission, simulation.date.year)}</option>)}</select></label>
          <label>Zona<select value={fleet.zoneId} onChange={(event) => changeZone(fleet.id, event.target.value as SeaZoneId)}>{zones.map((zone) => <option value={zone} key={zone}>{seaZoneLabel(zone)}</option>)}</select></label>
        </div>
      </article>)}
    </div>

    {!!state.zones.length && <div className="naval-zone-grid">
      {state.zones.map((zone) => <div className={`naval-zone ${zone.contested ? 'contested' : zone.controllerId === entityId ? 'controlled' : ''}`} key={zone.zoneId}>
        <b>{seaZoneLabel(zone.zoneId)}</b>
        <span>{zone.contested ? 'Zona contestada' : zone.controllerId ? `Predomínio: ${names[zone.controllerId] ?? zone.controllerId}` : 'Sem predomínio definido'}</span>
      </div>)}
    </div>}

    {message && <div className="naval-message">{message}</div>}
    <small className="naval-note">As frotas são formações estratégicas agregadas, não uma contagem histórica exata de cada embarcação. Controle marítimo protege acesso comercial; escolta melhora a segurança das rotas; transporte representa capacidade de deslocamento marítimo para futuras operações anfíbias e logísticas.</small>
  </section>;
}
