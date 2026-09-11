import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import {
  availableIntelligenceSources,
  conductFrontReconnaissance,
  latestFrontIntelligence,
  militaryIntelligenceState,
  setDeceptionPosture,
  type DeceptionPosture,
  type EstimateBand,
  type IntelligenceConfidence,
  type IntelligenceFreshness,
  type IntelligenceSource,
} from '../engine/militaryIntelligence';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './military-intelligence.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
};

const sourceLabels: Record<IntelligenceSource, string> = {
  scouts: 'Batedores', patrols: 'Patrulhas', agents: 'Agentes', signals: 'Interceptação de sinais', aerial: 'Reconhecimento aéreo', satellite: 'Reconhecimento orbital',
};
const confidenceLabels: Record<IntelligenceConfidence, string> = {
  very_low: 'Muito baixa', low: 'Baixa', medium: 'Moderada', high: 'Alta', very_high: 'Muito alta',
};
const freshnessLabels: Record<IntelligenceFreshness, string> = {
  current: 'Atual', recent: 'Recente', stale: 'Desatualizada', obsolete: 'Obsoleta',
};
const bandLabels: Record<EstimateBand, string> = {
  unknown: 'Desconhecida', minimal: 'Mínima', limited: 'Limitada', moderate: 'Moderada', strong: 'Forte', overwhelming: 'Muito forte',
};
const deceptionLabels: Record<DeceptionPosture, string> = {
  none: 'Sem operação especial', concealment: 'Ocultação', false_concentration: 'Falsa concentração', feigned_weakness: 'Fraqueza aparente',
};

export function MilitaryIntelligencePanel({ entityId, entities, simulation, armyState, warState }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [sourceByFront, setSourceByFront] = useState<Record<string, IntelligenceSource>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);
  const sources = availableIntelligenceSources(simulation.date.year);
  const activeWars = warState.wars.filter((war) => war.status === 'active' && (war.attackers.includes(entityId) || war.defenders.includes(entityId)));

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-military-intelligence', refresh);
    return () => window.removeEventListener('world-state-military-intelligence', refresh);
  }, []);

  void revision;
  if (!activeWars.length) return null;

  function applySimulation(next: SimulationState) {
    simulation.events.splice(0, simulation.events.length, ...next.events);
  }

  function recon(warId: string, frontId: string) {
    const key = `${warId}:${frontId}`;
    const source = sourceByFront[key] ?? sources[0];
    const result = conductFrontReconnaissance(entityId, warId, frontId, source, simulation, armyState, warState);
    if (result.accepted) applySimulation(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function deception(warId: string, side: 'attackers' | 'defenders', posture: DeceptionPosture) {
    setDeceptionPosture(warId, side, posture);
    setMessage(`Postura de contrainteligência alterada para ${deceptionLabels[posture]}.`);
    setRevision((value) => value + 1);
  }

  const intelState = militaryIntelligenceState();
  return <div className="military-intel-panel">
    <div className="military-intel-heading">
      <span>INTELIGÊNCIA MILITAR</span>
      <strong>Reconhecimento, incerteza e risco de surpresa</strong>
    </div>

    {activeWars.map((war) => {
      const ownSide = war.attackers.includes(entityId) ? 'attackers' as const : 'defenders' as const;
      const enemyIds = ownSide === 'attackers' ? war.defenders : war.attackers;
      const posture = intelState.deception[`${war.id}::${ownSide}`] ?? 'none';
      return <div className="military-intel-war" key={war.id}>
        <div className="military-intel-war-head">
          <div><b>{war.name}</b><span>Adversários: {enemyIds.map((id) => names[id] ?? id).join(', ')}</span></div>
          <em>{simulation.date.year < 1700 ? 'Informação lenta e fragmentária' : simulation.date.year < 1945 ? 'Reconhecimento limitado pela comunicação' : 'Quadro operacional atualizado'}</em>
        </div>

        <div className="military-deception-row">
          <span>Postura de contrainteligência</span>
          <select value={posture} onChange={(event) => deception(war.id, ownSide, event.target.value as DeceptionPosture)}>
            {Object.entries(deceptionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>

        {war.fronts.map((front) => {
          const key = `${war.id}:${front.id}`;
          const report = latestFrontIntelligence(entityId, war.id, front.id, simulation);
          return <div className={`military-intel-front ${report ? report.freshness : 'unknown'}`} key={front.id}>
            <div className="military-intel-front-head">
              <div><b>{front.name}</b><span>{front.terrain ?? 'terreno não classificado'}</span></div>
              <strong>{report ? freshnessLabels[report.freshness] : 'SEM RELATÓRIO'}</strong>
            </div>

            {report ? <>
              <div className="military-intel-grid">
                <span>Confiança <b>{confidenceLabels[report.confidence]}</b></span>
                <span>Formações estimadas <b>{bandLabels[report.estimatedEnemyFormations]}</b></span>
                <span>Poder estimado <b>{bandLabels[report.estimatedEnemyPower]}</b></span>
                <span>Logística inimiga <b>{bandLabels[report.estimatedEnemyLogistics]}</b></span>
                <span>Risco de surpresa <b>{report.surpriseRisk === 'low' ? 'Baixo' : report.surpriseRisk === 'guarded' ? 'Moderado' : report.surpriseRisk === 'elevated' ? 'Elevado' : 'Severo'}</b></span>
                <span>Fonte <b>{sourceLabels[report.source]}</b></span>
              </div>
              {report.possiblyDeceived && <div className="military-intel-warning">Há sinais de que parte do quadro inimigo pode estar mascarado ou deliberadamente distorcido.</div>}
            </> : <p>Nenhuma estimativa confiável está disponível. O planejamento nesta frente parte de forte incerteza.</p>}

            <div className="military-intel-actions">
              <select value={sourceByFront[key] ?? sources[0]} onChange={(event) => setSourceByFront((current) => ({ ...current, [key]: event.target.value as IntelligenceSource }))}>
                {sources.map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}
              </select>
              <button onClick={() => recon(war.id, front.id)}>Atualizar reconhecimento</button>
            </div>
          </div>;
        })}
      </div>;
    })}

    {message && <div className="military-intel-message">{message}</div>}
    <small className="military-intel-note">O painel exibe estimativas, não o estado real da simulação. Relatórios envelhecem, podem conter erro e podem ser afetados por ocultação ou desinformação do adversário.</small>
  </div>;
}
