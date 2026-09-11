import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { SimulationState } from '../engine/simulation';
import {
  casusBelliOptions,
  consumePreparation,
  preparationBetween,
  preparationReady,
  resetWarPreparations,
  startWarPreparation,
  type CasusBelliOption,
  type CasusBelliType,
} from '../engine/casusBelli';
import { activeTruceBetween } from '../engine/peace';
import type { WarGoal } from '../engine/war';

const goalLabels: Record<WarGoal, string> = {
  territory: 'Território / fronteira',
  reparations: 'Reparações / concessões',
  regime: 'Mudança de regime',
  independence: 'Independência / libertação',
  defense: 'Defesa / restauração do status quo',
};

type Props = {
  entity: ScenarioEntity;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  onDeclareWar: (targetId: string, goal: WarGoal, casusBelli: CasusBelliOption) => boolean;
};

export function CasusBelliPlanner({ entity, entities, simulation, onDeclareWar }: Props) {
  const targets = entities.filter((item) => item.id !== entity.id);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [casusType, setCasusType] = useState<CasusBelliType>('unjustified');
  const [goal, setGoal] = useState<WarGoal>('territory');
  const [revision, setRevision] = useState(0);
  const target = targets.find((item) => item.id === targetId) ?? targets[0];
  const options = useMemo(() => target ? casusBelliOptions(entity, target, simulation) : [], [entity, target, simulation, revision]);
  const selected = options.find((item) => item.type === casusType) ?? options.find((item) => item.available) ?? options[options.length - 1];
  const preparation = target ? preparationBetween(entity.id, target.id) : undefined;
  const ready = !!selected && preparationReady(preparation, selected, simulation.elapsedDays);
  const truce = target ? activeTruceBetween(entity.id, target.id, simulation.elapsedDays) : undefined;
  const remaining = preparation && selected && preparation.casusBelliType === selected.type ? Math.max(0, preparation.readyAtElapsedDay - simulation.elapsedDays) : selected?.preparationDays ?? 0;

  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-war-preparation', listener);
    return () => window.removeEventListener('world-state-war-preparation', listener);
  }, []);

  useEffect(() => {
    if (simulation.elapsedDays === 0) resetWarPreparations();
  }, [simulation.date.year]);

  useEffect(() => {
    if (!selected) return;
    if (!selected.allowedGoals.includes(goal)) setGoal(selected.allowedGoals[0]);
  }, [selected?.type]);

  function changeTarget(nextTargetId: string) {
    setTargetId(nextTargetId);
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
    setCasusType(type);
    const option = options.find((item) => item.type === type);
    if (option) setGoal(option.allowedGoals[0]);
  }

  function prepare() {
    if (!target || !selected?.available) return;
    startWarPreparation(entity.id, target.id, selected, simulation.elapsedDays);
    setRevision((value) => value + 1);
  }

  function declare() {
    if (!target || !selected || !ready || truce) return;
    const success = onDeclareWar(target.id, goal, selected);
    if (success) {
      consumePreparation(entity.id, target.id);
      setRevision((value) => value + 1);
    }
  }

  return <div className="war-planner casus-planner">
    <div className="context-kicker">Preparação diplomática do conflito</div>
    <label className="casus-field"><span>Alvo</span><select value={targetId} onChange={(event) => changeTarget(event.target.value)}>{targets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="casus-field"><span>Casus belli</span><select value={selected?.type ?? casusType} onChange={(event) => selectCasus(event.target.value as CasusBelliType)}>{options.map((option) => <option value={option.type} key={option.type}>{option.label}{option.available ? '' : ' • indisponível'}</option>)}</select></label>
    {selected && <div className={`casus-card ${selected.available ? '' : 'unavailable'}`}>
      <div className="casus-card-head"><strong>{selected.label}</strong><b>{selected.legitimacy.toFixed(0)}/100 legitimidade</b></div>
      <p>{selected.description}</p>
      <div className="casus-metrics"><span>Preparação <b>{selected.preparationDays}d</b></span><span>Estabilidade <b>−{selected.stabilityCost.toFixed(1)}</b></span><span>Custo diplomático <b>{selected.diplomaticCost.toFixed(0)}</b></span></div>
      <small>{selected.reason}</small>
    </div>}
    {selected && <label className="casus-field casus-goal"><span>Objetivo de guerra compatível</span><select value={goal} onChange={(event) => setGoal(event.target.value as WarGoal)}>{selected.allowedGoals.map((value) => <option key={value} value={value}>{goalLabels[value]}</option>)}</select></label>}
    {truce ? <div className="truce-warning"><b>Trégua em vigor</b><span>{Math.max(0, truce.expiresAtElapsedDay - simulation.elapsedDays)} dias restantes. Nenhum casus belli pode romper automaticamente o tratado.</span></div> : preparation && selected && preparation.casusBelliType === selected.type ? <div className={`preparation-status ${ready ? 'ready' : ''}`}><b>{ready ? 'Justificativa pronta' : 'Preparação em andamento'}</b><span>{ready ? 'A declaração pode ser emitida.' : `${remaining} dias restantes; avance o relógio da campanha.`}</span></div> : null}
    <div className="casus-actions"><button disabled={!selected?.available || !!truce || ready} onClick={prepare}>{preparation && selected && preparation.casusBelliType === selected.type && !ready ? 'Reiniciar preparação' : 'Preparar justificativa'}</button><button className="declare-war" disabled={!target || !selected?.available || !ready || !!truce} onClick={declare}>Declarar guerra</button></div>
    <p className="casus-footnote">A justificativa altera custos políticos e diplomáticos. Religião e outros motivos históricos específicos só serão usados quando os dados estruturados do cenário suportarem isso sem anacronismo.</p>
  </div>;
}
