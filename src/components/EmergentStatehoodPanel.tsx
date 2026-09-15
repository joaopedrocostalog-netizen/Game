import React, { useEffect, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  emergentStatesForObserver,
  processEmergentStatehood,
  recognizeEmergentState,
  type EmergentSettlement,
  type RecognitionStatus,
} from '../engine/emergentStatehood';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import './emergent-statehood.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  territorialControl: TerritorialControlState;
  onSimulationStateChange: (state: SimulationState) => void;
};

function recognitionLabel(status: RecognitionStatus) {
  if (status === 'recognized') return 'RECONHECIMENTO RELEVANTE';
  if (status === 'limited') return 'RECONHECIMENTO LIMITADO';
  return 'NÃO RECONHECIDA';
}
function settlementLabel(value: EmergentSettlement, year: number) {
  if (value === 'recognized-independence') return 'SOBERANIA RECONHECIDA PELO ESTADO DE ORIGEM';
  if (value === 'successor-authority') return year < 1850 ? 'AUTORIDADE SUCESSORA EM DISPUTA' : 'AUTORIDADE POLÍTICA SUCESSORA';
  if (value === 'ceasefire') return 'ARRANJO PROVISÓRIO / CESSAR-FOGO';
  return 'SOBERANIA AINDA CONTESTADA';
}

export function EmergentStatehoodPanel({ entityId, entities, simulation, territorialControl, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-emergent-statehood', refresh);
    window.addEventListener('world-state-civil-conflict', refresh);
    return () => {
      window.removeEventListener('world-state-emergent-statehood', refresh);
      window.removeEventListener('world-state-civil-conflict', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processEmergentStatehood(simulation, territorialControl);
    if (result.changed) {
      onSimulationStateChange(result.simulation);
      Object.assign(territorialControl, result.territorialControl);
      setRevision((value) => value + 1);
    }
  }, [simulation.elapsedDays]);

  void revision;
  const states = emergentStatesForObserver(entityId);
  const names = Object.fromEntries(entities.map((item) => [item.id, item.name]));

  function recognize(targetId: string) {
    const result = recognizeEmergentState(entityId, targetId, simulation, territorialControl);
    onSimulationStateChange(result.simulation);
    Object.assign(territorialControl, result.territorialControl);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  return <section className="emergent-statehood-panel">
    <header className="emergent-statehood-heading">
      <div><span>RECONHECIMENTO E SOBERANIA</span><strong>Estados emergentes, legitimidade externa e fronteiras pós-guerra civil</strong></div>
      <em>{states.length ? `${states.length} ENTIDADE${states.length > 1 ? 'S' : ''} EMERGENTE${states.length > 1 ? 'S' : ''}` : 'SEM NOVOS ESTADOS CONSOLIDADOS'}</em>
    </header>

    {!states.length && <div className="emergent-statehood-empty">Nenhuma facção vitoriosa consolidou uma entidade diplomática própria nesta campanha até o momento.</div>}

    <div className="emergent-statehood-list">
      {states.map((item) => {
        const alreadyRecognized = item.recognizers.includes(entityId);
        const parent = names[item.parentEntityId] ?? item.parentEntityId;
        return <article key={item.entityId}>
          <div className="emergent-statehood-title"><strong>{item.name}</strong><em>{recognitionLabel(item.recognitionStatus)}</em></div>
          <p>Estado de origem: <b>{parent}</b>. {settlementLabel(item.settlement, simulation.date.year)}.</p>
          <div className="emergent-statehood-stats">
            <span><small>Reconhecimentos</small><b>{item.recognizers.length}</b></span>
            <span><small>Legitimidade externa</small><b>{Math.round(item.recognitionScore)}%</b></span>
            <span><small>Territórios reivindicados</small><b>{item.claimedLocationIds.length}</b></span>
            <span><small>Tratados ativos</small><b>{simulation.treaties.filter((treaty) => treaty.active && treaty.parties.includes(item.entityId)).length}</b></span>
          </div>
          {!alreadyRecognized && item.entityId !== entityId && <button onClick={() => recognize(item.entityId)}>Reconhecer entidade</button>}
          {alreadyRecognized && <small className="emergent-recognized">Seu Estado já reconhece esta autoridade.</small>}
        </article>;
      })}
    </div>

    {message && <div className="emergent-statehood-message">{message}</div>}
    <small className="emergent-statehood-note">Reconhecimento internacional e soberania territorial são processos diferentes. Outros Estados podem reconhecer uma nova autoridade sem encerrar a disputa de fronteira. Quando o próprio Estado de origem reconhece uma entidade independente, as regiões efetivamente controladas deixam de ser tratadas apenas como ocupação e passam a ter nova soberania na campanha.</small>
  </section>;
}
