import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  adaptiveDoctrineState,
  doctrineLabel,
  processAdaptiveEnemyCommand,
  type AdaptiveDoctrine,
} from '../engine/adaptiveMilitaryDoctrine';
import { latestFrontIntelligence } from '../engine/militaryIntelligence';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './adaptive-enemy-command.css';

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

function signalFor(doctrine: AdaptiveDoctrine) {
  if (doctrine === 'defense_in_depth') return 'Frentes secundárias mantidas, dispersão maior e menor dependência de uma única linha defensiva.';
  if (doctrine === 'mobile_reserve') return 'Parte das formações deixa de permanecer fixada nas frentes e passa a atuar como reserva de resposta.';
  if (doctrine === 'elastic_defense') return 'O inimigo reduz exposição, alterna defesa e cautela e parece disposto a trocar espaço por preservação de forças.';
  if (doctrine === 'counter_breakthrough') return 'A frente mais ameaçada recebe prioridade elevada e sinais de reserva para bloquear ou responder a rupturas.';
  if (doctrine === 'deliberate_counteroffensive') return 'Uma frente específica começa a acumular prioridade e postura ofensiva após queda do seu impulso recente.';
  return 'O inimigo mantém distribuição relativamente equilibrada entre as frentes.';
}

function confidenceLabel(value: number) {
  if (value >= 75) return 'alta';
  if (value >= 52) return 'moderada';
  if (value >= 28) return 'baixa';
  return 'muito baixa';
}

function sideEnemies(warState: WarState, warId: string, entityId: string) {
  const war = warState.wars.find((item) => item.id === warId);
  if (!war) return [];
  if (war.attackers.includes(entityId)) return war.defenders;
  if (war.defenders.includes(entityId)) return war.attackers;
  return [];
}

export function AdaptiveEnemyCommandPanel({ entityId, entities, simulation, armyState, warState, territorialControl, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-adaptive-doctrine', refresh);
    return () => window.removeEventListener('world-state-adaptive-doctrine', refresh);
  }, []);

  useEffect(() => {
    const result = processAdaptiveEnemyCommand(entityId, simulation, armyState, warState, territorialControl);
    if (!result.changed) return;
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    onWarStateChange(result.warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const state = adaptiveDoctrineState();
  const activeWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));
  const cards = activeWars.flatMap((war) => sideEnemies(warState, war.id, entityId).map((enemyId) => {
    const doctrine = state.doctrines.find((item) => item.warId === war.id && item.entityId === enemyId && item.opponentId === entityId);
    if (!doctrine) return undefined;
    const reports = war.fronts.map((front) => latestFrontIntelligence(entityId, war.id, front.id, simulation)).filter(Boolean);
    const visibility = reports.length ? reports.reduce((sum, report) => sum + (report?.confidenceScore ?? 0), 0) / reports.length : 0;
    return { war, enemyId, doctrine, visibility };
  })).filter(Boolean) as Array<{ war: (typeof activeWars)[number]; enemyId: string; doctrine: (typeof state.doctrines)[number]; visibility: number }>;

  if (!cards.length) return null;

  return <div className="adaptive-command-panel">
    <div className="adaptive-command-heading">
      <span>COMANDO INIMIGO ADAPTATIVO</span>
      <strong>Doutrina que aprende com o andamento da campanha</strong>
    </div>

    {cards.map(({ war, enemyId, doctrine, visibility }) => {
      const label = doctrineLabel(doctrine.doctrine, simulation.date.year);
      const revealDoctrine = visibility >= 38;
      const recentChange = state.changes.find((item) => item.warId === war.id && item.entityId === enemyId);
      return <div className="adaptive-command-card" key={`${war.id}-${enemyId}`}>
        <div className="adaptive-command-card-head">
          <div><b>{names[enemyId] ?? enemyId}</b><span>{war.name}</span></div>
          <strong>{revealDoctrine ? label.toUpperCase() : 'POSTURA NÃO CONFIRMADA'}</strong>
        </div>
        <div className="adaptive-command-metrics">
          <span>Confiança da avaliação <b>{confidenceLabel(visibility)}</b></span>
          <span>Reserva percebida <b>{visibility >= 55 ? (doctrine.reserveRatio >= 32 ? 'elevada' : doctrine.reserveRatio >= 24 ? 'moderada' : 'reduzida') : 'incerta'}</b></span>
          <span>Mudança recente <b>{recentChange && simulation.elapsedDays - recentChange.elapsedDay <= 60 ? 'provável' : 'não confirmada'}</b></span>
        </div>
        <p>{visibility >= 28 ? signalFor(doctrine.doctrine) : 'As informações disponíveis ainda não permitem distinguir uma mudança doutrinária de simples reação local das forças inimigas.'}</p>
        {visibility >= 62 && recentChange && <div className="adaptive-command-change">Inteligência indica que o adversário revisou sua postura após observar o desenvolvimento recente da campanha.</div>}
      </div>;
    })}

    <small className="adaptive-command-note">A IA não lê seus planos diretamente. Ela aprende por resultados de batalha, padrões visíveis nas frentes e inteligência disponível. A identificação exibida aqui é uma estimativa do seu próprio serviço de inteligência, não acesso ao estado interno do adversário.</small>
  </div>;
}
