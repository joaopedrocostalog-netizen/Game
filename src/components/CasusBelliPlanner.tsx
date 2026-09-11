import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import {
  applyCasusBelliCosts,
  casusBelliOptions,
  consumePreparation,
  preparationBetween,
  preparationReady,
  resetWarPreparations,
  startWarPreparation,
  type CasusBelliType,
} from '../engine/casusBelli';
import {
  activeCrisisBetween,
  evaluateCrisis,
  markCrisisEscalated,
  potentialMediators,
  resetCrises,
  resolveCrisis,
  setCrisisMediator,
  startDiplomaticCrisis,
  type CrisisAction,
} from '../engine/crisis';
import { activeTruceBetween } from '../engine/peace';
import type { WarGoal } from '../engine/war';

const goalLabels: Record<WarGoal, string> = {
  territory: 'Território / fronteira',
  reparations: 'Reparações / concessões',
  regime: 'Mudança de regime',
  independence: 'Independência / libertação',
  defense: 'Defesa / restauração do status quo',
};

const actionLabels: Record<CrisisAction, string> = {
  ultimatum: 'Enviar ultimato',
  compromise: 'Propor compromisso',
  mediation: 'Submeter à mediação',
};

type Props = {
  entity: ScenarioEntity;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  onDeclareWar: (targetId: string, goal: WarGoal) => void;
};

export function CasusBelliPlanner({ entity, entities, simulation, onDeclareWar }: Props) {
  const targets = entities.filter((item) => item.id !== entity.id);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [casusType, setCasusType] = useState<CasusBelliType>('unjustified');
  const [goal, setGoal] = useState<WarGoal>('territory');
  const [revision, setRevision] = useState(0);
  const [crisisMessage, setCrisisMessage] = useState('');
  const target = targets.find((item) => item.id === targetId) ?? targets[0];
  const options = useMemo(() => target ? casusBelliOptions(entity, target, simulation) : [], [entity, target, simulation, revision]);
  const selected = options.find((item) => item.type === casusType) ?? options.find((item) => item.available) ?? options[options.length - 1];
  const preparation = target ? preparationBetween(entity.id, target.id) : undefined;
  const ready = !!selected && preparationReady(preparation, selected, simulation.elapsedDays);
  const truce = target ? activeTruceBetween(entity.id, target.id, simulation.elapsedDays) : undefined;
  const crisis = target ? activeCrisisBetween(entity.id, target.id) : undefined;
  const readinessBlocked = (simulation.entities[entity.id]?.militaryReadiness ?? 0) < 28;
  const remaining = preparation && selected && preparation.casusBelliType === selected.type ? Math.max(0, preparation.readyAtElapsedDay - simulation.elapsedDays) : selected?.preparationDays ?? 0;
  const mediators = target ? potentialMediators(entities, simulation, entity.id, target.id) : [];
  const crisisExpired = !!crisis && simulation.elapsedDays >= crisis.deadlineElapsedDay;
  const canEscalate = !!crisis && (crisis.status === 'escalated' || crisisExpired || crisis.tension >= 82);

  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-war-preparation', listener);
    window.addEventListener('world-state-crises', listener);
    return () => {
      window.removeEventListener('world-state-war-preparation', listener);
      window.removeEventListener('world-state-crises', listener);
    };
  }, []);

  useEffect(() => {
    if (simulation.elapsedDays === 0) {
      resetWarPreparations();
      resetCrises();
    }
  }, [simulation.date.year]);

  useEffect(() => {
    if (!selected) return;
    if (!selected.allowedGoals.includes(goal)) setGoal(selected.allowedGoals[0]);
  }, [selected?.type]);

  function applySimulationSnapshot(nextSimulation: SimulationState) {
    Object.assign(simulation.entities, nextSimulation.entities);
    Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
    Object.assign(simulation.diplomacy, nextSimulation.diplomacy);
    simulation.events.splice(0, simulation.events.length, ...nextSimulation.events);
  }

  function changeTarget(nextTargetId: string) {
    setTargetId(nextTargetId);
    setCrisisMessage('');
    const nextTarget = entities.find((item) => item.id === nextTargetId);
    if (!nextTarget) return;
    const nextOptions = casusBelliOptions(entity, nextTarget, simulation);
    const next = nextOptions.find((item) => item.available) ?? nextOptions[nextOptions.length - 1];
    if (next) {
      setCasusType(next.type);
      setGoal(next.allowedGoals[0]);
    }
  }

  function selectCasus(type: CasusBelliType) {
    if (crisis) return;
    setCasusType(type);
    const option = options.find((item) => item.type === type);
    if (option) setGoal(option.allowedGoals[0]);
  }

  function prepare() {
    if (!target || !selected?.available || crisis) return;
    startWarPreparation(entity.id, target.id, selected, simulation.elapsedDays);
    setCrisisMessage('');
    setRevision((value) => value + 1);
  }

  function openCrisis() {
    if (!target || !selected || !ready || truce || crisis) return;
    startDiplomaticCrisis(entity, target, selected, goal, simulation);
    setCrisisMessage(`Crise aberta com ${target.name}. A guerra ainda pode ser evitada por concessão, compromisso ou mediação.`);
    setRevision((value) => value + 1);
  }

  function chooseMediator(mediatorId: string) {
    if (!crisis) return;
    setCrisisMediator(crisis.id, mediatorId || undefined);
    setCrisisMessage(mediatorId ? `${entities.find((item) => item.id === mediatorId)?.name ?? mediatorId} foi convidado para mediar a crise.` : 'A mediação de terceiros foi removida.');
    setRevision((value) => value + 1);
  }

  function negotiate(action: CrisisAction) {
    if (!crisis || crisis.status !== 'active') return;
    if (action === 'mediation' && !crisis.mediatorId) {
      setCrisisMessage('Selecione uma terceira entidade como mediadora antes de solicitar mediação.');
      return;
    }
    const result = resolveCrisis(crisis.id, simulation, action);
    if (!result) return;
    applySimulationSnapshot(result.simulation);
    setCrisisMessage(result.message);
    if (result.accepted) consumePreparation(entity.id, targetId);
    setRevision((value) => value + 1);
  }

  function escalateToWar() {
    if (!target || !selected || !crisis || !ready || truce || readinessBlocked || !canEscalate) return;
    markCrisisEscalated(crisis.id);
    const nextSimulation = applyCasusBelliCosts(simulation, entity.id, target.id, selected);
    applySimulationSnapshot(nextSimulation);
    onDeclareWar(target.id, goal);
    consumePreparation(entity.id, target.id);
    setCrisisMessage('A crise diplomática fracassou e foi convertida em guerra aberta.');
    setRevision((value) => value + 1);
  }

  const crisisEvaluation = crisis?.status === 'active' ? evaluateCrisis(crisis, simulation, crisis.mediatorId ? 'mediation' : 'compromise') : undefined;

  return <div className="war-planner casus-planner">
    <div className="context-kicker">Preparação diplomática do conflito</div>
    <label className="casus-field"><span>Alvo</span><select value={targetId} disabled={!!crisis} onChange={(event) => changeTarget(event.target.value)}>{targets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="casus-field"><span>Casus belli</span><select value={selected?.type ?? casusType} disabled={!!crisis} onChange={(event) => selectCasus(event.target.value as CasusBelliType)}>{options.map((option) => <option value={option.type} key={option.type}>{option.label}{option.available ? '' : ' • indisponível'}</option>)}</select></label>
    {selected && <div className={`casus-card ${selected.available ? '' : 'unavailable'}`}>
      <div className="casus-card-head"><strong>{selected.label}</strong><b>{selected.legitimacy.toFixed(0)}/100 legitimidade</b></div>
      <p>{selected.description}</p>
      <div className="casus-metrics"><span>Preparação <b>{selected.preparationDays}d</b></span><span>Estabilidade <b>−{selected.stabilityCost.toFixed(1)}</b></span><span>Custo diplomático <b>{selected.diplomaticCost.toFixed(0)}</b></span></div>
      <small>{selected.reason}</small>
    </div>}
    {selected && <label className="casus-field casus-goal"><span>Objetivo compatível</span><select value={goal} disabled={!!crisis} onChange={(event) => setGoal(event.target.value as WarGoal)}>{selected.allowedGoals.map((value) => <option key={value} value={value}>{goalLabels[value]}</option>)}</select></label>}
    {truce ? <div className="truce-warning"><b>Trégua em vigor</b><span>{Math.max(0, truce.expiresAtElapsedDay - simulation.elapsedDays)} dias restantes. Nenhum casus belli pode romper automaticamente o tratado.</span></div> : readinessBlocked ? <div className="truce-warning"><b>Prontidão militar insuficiente</b><span>É possível preparar e negociar uma crise, mas a escalada para guerra exige prontidão militar de pelo menos 28.</span></div> : preparation && selected && preparation.casusBelliType === selected.type && !crisis ? <div className={`preparation-status ${ready ? 'ready' : ''}`}><b>{ready ? 'Justificativa pronta' : 'Preparação em andamento'}</b><span>{ready ? 'A justificativa pode ser levada a uma crise diplomática.' : `${remaining} dias restantes; avance o relógio da campanha.`}</span></div> : null}

    {!crisis && <div className="casus-actions"><button disabled={!selected?.available || !!truce || ready} onClick={prepare}>{preparation && selected && preparation.casusBelliType === selected.type && !ready ? 'Reiniciar preparação' : 'Preparar justificativa'}</button><button className="declare-war" disabled={!target || !selected?.available || !ready || !!truce} onClick={openCrisis}>Abrir crise diplomática</button></div>}

    {crisis && <div className={`crisis-box status-${crisis.status}`}>
      <div className="crisis-head"><div><span>CRISE DIPLOMÁTICA</span><strong>{entity.name} × {target?.name ?? crisis.targetId}</strong></div><b>{crisis.tension.toFixed(0)} tensão</b></div>
      <div className="crisis-track"><i style={{ width: `${crisis.tension}%` }}/></div>
      <div className="crisis-metrics"><span>Prazo <b>{Math.max(0, crisis.deadlineElapsedDay - simulation.elapsedDays)}d</b></span><span>Legitimidade <b>{crisis.legitimacy.toFixed(0)}</b></span><span>Objetivo <b>{goalLabels[crisis.goal]}</b></span></div>
      {crisisEvaluation && <p>{crisisEvaluation.reason} Probabilidade diplomática aproximada: <b>{crisisEvaluation.acceptance.toFixed(0)}%</b>.</p>}
      {crisis.status === 'active' && <>
        <label className="casus-field"><span>Mediador opcional</span><select value={crisis.mediatorId ?? ''} onChange={(event) => chooseMediator(event.target.value)}><option value="">Sem mediação</option>{mediators.map((item) => <option key={item.entity.id} value={item.entity.id}>{item.entity.name} • aptidão {item.suitability.toFixed(0)}</option>)}</select></label>
        <div className="crisis-actions"><button onClick={() => negotiate('compromise')}>{actionLabels.compromise}</button><button disabled={!crisis.mediatorId} onClick={() => negotiate('mediation')}>{actionLabels.mediation}</button><button className="ultimatum" onClick={() => negotiate('ultimatum')}>{actionLabels.ultimatum}</button></div>
      </>}
      {(canEscalate || crisis.status === 'escalated') && crisis.status !== 'resolved' && <button className="crisis-escalate" disabled={readinessBlocked} onClick={escalateToWar}>Escalar para guerra</button>}
      {crisis.status === 'resolved' && <div className="crisis-resolved">Crise encerrada sem guerra. A preparação militar foi consumida e a memória diplomática foi atualizada.</div>}
      {crisisMessage && <div className="crisis-message">{crisisMessage}</div>}
    </div>}

    <p className="casus-footnote">Uma justificativa pronta não inicia hostilidades automaticamente. A crise pode ser resolvida por negociação, mediação ou ultimato; somente uma crise fracassada ou vencida pelo prazo pode escalar para guerra.</p>
  </div>;
}
