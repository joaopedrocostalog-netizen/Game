import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import { openTreatyCrisesFor } from '../engine/treatyCompliance';
import {
  enforcementActionsForEntity,
  launchTreatyEnforcementAction,
  processTreatyEnforcement,
  respondToTreatyUltimatum,
  treatyViolationCrisisBetween,
  type EnforcementActionType,
} from '../engine/treatyEnforcement';
import './treaty-enforcement.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  onSimulationStateChange: (state: SimulationState) => void;
};

const actionLabels: Record<EnforcementActionType, string> = {
  ultimatum: 'Emitir ultimato',
  sanctions: 'Pressão econômica',
  'emergency-conference': 'Conferência emergencial',
  'negotiated-withdrawal': 'Retirada negociada',
  'guarantee-suspension': 'Suspender garantia',
};

function pressureBand(value: number) {
  if (value < 35) return 'LIMITADA';
  if (value < 60) return 'MODERADA';
  if (value < 80) return 'ALTA';
  return 'CRÍTICA';
}

export function TreatyEnforcementPanel({ entityId, entities, simulation, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [selectedAction, setSelectedAction] = useState<Record<string, EnforcementActionType>>({});

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-treaty-enforcement', refresh);
    window.addEventListener('world-state-treaty-compliance', refresh);
    return () => {
      window.removeEventListener('world-state-treaty-enforcement', refresh);
      window.removeEventListener('world-state-treaty-compliance', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processTreatyEnforcement(simulation);
    if (result.changed) onSimulationStateChange(result.simulation);
  }, [simulation.elapsedDays]);

  void revision;
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const crises = openTreatyCrisesFor(entityId).filter((item) => item.claimantIds.includes(entityId));
  const actions = enforcementActionsForEntity(entityId);
  const receivedUltimata = actions.filter((item) => item.targetId === entityId && item.type === 'ultimatum' && item.status === 'active');
  const ownActions = actions.filter((item) => item.actorId === entityId).slice(0, 8);
  if (!crises.length && !receivedUltimata.length && !ownActions.length) return null;

  function launch(crisisId: string) {
    const type = selectedAction[crisisId] ?? 'ultimatum';
    const result = launchTreatyEnforcementAction(entityId, crisisId, type, simulation);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  function respond(actionId: string, accept: boolean) {
    const result = respondToTreatyUltimatum(entityId, actionId, accept, simulation);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  return <section className="treaty-enforcement-panel">
    <header className="treaty-enforcement-heading">
      <div><span>ESCALADA DO TRATADO</span><strong>Ultimatos, sanções e conferência emergencial</strong></div>
      <em>{crises.some((item) => item.severity >= 80) ? 'RISCO DE NOVA GUERRA' : 'PRESSÃO DIPLOMÁTICA ATIVA'}</em>
    </header>

    {!!receivedUltimata.length && <div className="treaty-enforcement-received">
      <strong>Ultimatos recebidos</strong>
      {receivedUltimata.map((action) => <article key={action.id}>
        <div><b>{names[action.actorId] ?? action.actorId}</b><span>Prazo: {Math.max(0, (action.deadlineElapsedDay ?? simulation.elapsedDays) - simulation.elapsedDays)} dias</span></div>
        <p>Exigência formal de correção de uma violação de tratado.</p>
        <div><button onClick={() => respond(action.id, true)}>Aceitar compromisso</button><button className="danger" onClick={() => respond(action.id, false)}>Rejeitar ultimato</button></div>
      </article>)}
    </div>}

    {crises.map((crisis) => {
      const chosen = selectedAction[crisis.id] ?? 'ultimatum';
      const cbUnlocked = !!treatyViolationCrisisBetween(entityId, crisis.violatorId);
      return <article className="treaty-enforcement-crisis" key={crisis.id}>
        <div className="treaty-enforcement-crisis-head">
          <div><b>{names[crisis.violatorId] ?? crisis.violatorId}</b><span>{crisis.reason}</span></div>
          <strong>{pressureBand(crisis.severity)} • {crisis.severity.toFixed(0)}</strong>
        </div>
        <div className="treaty-enforcement-controls">
          <select value={chosen} onChange={(event) => setSelectedAction((current) => ({ ...current, [crisis.id]: event.target.value as EnforcementActionType }))}>
            <option value="ultimatum">Ultimato formal</option>
            <option value="sanctions">Pressão econômica</option>
            <option value="emergency-conference">Conferência emergencial</option>
            <option value="negotiated-withdrawal">Retirada negociada</option>
          </select>
          <button onClick={() => launch(crisis.id)}>{actionLabels[chosen]}</button>
        </div>
        <div className={`treaty-enforcement-cb ${cbUnlocked ? 'unlocked' : ''}`}>
          <span>Casus belli por violação de tratado</span><b>{cbUnlocked ? 'DISPONÍVEL NO PLANEJADOR' : 'AINDA NÃO DISPONÍVEL'}</b>
        </div>
      </article>;
    })}

    {!!ownActions.length && <div className="treaty-enforcement-history">
      <strong>Medidas recentes</strong>
      {ownActions.map((action) => <div key={action.id}><span>{actionLabels[action.type]}</span><b>{action.status.toUpperCase()} • pressão {action.pressure.toFixed(0)}</b></div>)}
    </div>}

    {message && <div className="treaty-enforcement-message">{message}</div>}
    <small className="treaty-enforcement-note">A escalada permanece abstrata e política: sanções representam pressão econômica agregada, conferências representam negociação diplomática e ultimatos apenas criam um prazo formal. A guerra continua exigindo preparação no sistema de casus belli; crises graves elevam legitimidade, mas não iniciam hostilidades automaticamente.</small>
  </section>;
}
