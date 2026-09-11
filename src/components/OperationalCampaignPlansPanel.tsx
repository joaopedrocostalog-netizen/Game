import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import type { ArmyState } from '../engine/army';
import { jointForceState } from '../engine/jointOrganizationForces';
import { theaterCommandState } from '../engine/multinationalTheaterCommand';
import {
  abortOperationalPlan,
  createOperationalCampaignPlan,
  operationalPlanState,
  pauseOperationalPlan,
  plansForHeadquarters,
  processOperationalCampaignPlans,
  resumeOperationalPlan,
  type EnemyOperationalReaction,
  type OperationIntelligenceAssessment,
  type OperationPhase,
  type OperationSurpriseState,
  type OperationTempo,
} from '../engine/operationalCampaignPlans';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './operational-campaign-plans.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  armyState: ArmyState;
  warState: WarState;
  onArmyStateChange: (state: ArmyState) => void;
  onWarStateChange: (state: WarState) => void;
};

const phaseLabels: Record<OperationPhase, string> = {
  preparation: 'Preparação',
  concentration: 'Concentração',
  assault: 'Assalto',
  exploitation: 'Exploração',
  consolidation: 'Consolidação',
};

const tempoLabels: Record<OperationTempo, string> = {
  deliberate: 'Deliberado',
  standard: 'Padrão',
  rapid: 'Rápido',
};

const intelLabels: Record<OperationIntelligenceAssessment, string> = {
  unknown: 'Quadro desconhecido',
  poor: 'Inteligência fraca',
  adequate: 'Inteligência razoável',
  good: 'Inteligência boa',
  excellent: 'Inteligência excelente',
};

const surpriseLabels: Record<OperationSurpriseState, string> = {
  none: 'Sem vantagem clara',
  advantage: 'Potencial de surpresa favorável',
  risk: 'Risco de surpresa inimiga',
  suffered: 'Surpresa sofrida',
};

const reactionLabels: Record<EnemyOperationalReaction, string> = {
  none: 'Nenhuma reação confirmada',
  reinforcing: 'Reforços inimigos prováveis',
  entrenching: 'Defesa inimiga se consolidando',
  counterattack: 'Contraofensiva inimiga provável',
};

export function OperationalCampaignPlansPanel({ entityId, entities, simulation, armyState, warState, onArmyStateChange, onWarStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [reserveByHq, setReserveByHq] = useState<Record<string, number>>({});
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-operational-plans', refresh);
    return () => window.removeEventListener('world-state-operational-plans', refresh);
  }, []);

  useEffect(() => {
    const result = processOperationalCampaignPlans(simulation, armyState, warState);
    if (!result.changed) return;
    Object.assign(simulation.entities, result.simulation.entities);
    simulation.events.splice(0, simulation.events.length, ...result.simulation.events);
    onArmyStateChange(result.armyState);
    onWarStateChange(result.warState);
    setRevision((value) => value + 1);
  }, [simulation.elapsedDays]);

  void revision;
  const forceState = jointForceState();
  const allPlans = operationalPlanState().plans;
  const headquarters = theaterCommandState().headquarters.filter((hq) => {
    const force = forceState.forces.find((item) => item.id === hq.forceId);
    return force?.contributions.some((item) => item.memberId === entityId) || hq.commanderEntityId === entityId;
  });
  if (!headquarters.length && !allPlans.some((plan) => {
    const force = forceState.forces.find((item) => item.id === plan.forceId);
    return force?.contributions.some((entry) => entry.memberId === entityId);
  })) return null;

  function createPlan(hqId: string, frontId: string, objective: string, tempo: OperationTempo) {
    const reserve = reserveByHq[hqId] ?? 25;
    const plan = createOperationalCampaignPlan(hqId, frontId, objective, simulation, tempo, reserve);
    setMessage(plan ? `${plan.name} entrou em preparação usando o quadro de inteligência disponível.` : 'Já existe uma operação ativa nessa frente ou o HQ não está disponível.');
    setRevision((value) => value + 1);
  }

  function pause(planId: string) {
    const plan = pauseOperationalPlan(planId, 'Suspensa por decisão do comando do teatro.');
    setMessage(plan ? 'Operação pausada. As formações mantêm sua situação atual.' : 'Não foi possível pausar a operação.');
    setRevision((value) => value + 1);
  }

  function resume(planId: string) {
    const plan = resumeOperationalPlan(planId, simulation.elapsedDays);
    setMessage(plan ? 'Operação retomada a partir da fase atual.' : 'A operação não está pausada.');
    setRevision((value) => value + 1);
  }

  function abort(planId: string) {
    const plan = abortOperationalPlan(planId, 'Cancelada pelo comando do teatro.');
    setMessage(plan ? 'Operação cancelada. O plano permanece no histórico.' : 'Não foi possível cancelar a operação.');
    setRevision((value) => value + 1);
  }

  return <div className="operational-plans-panel">
    <div className="operational-plans-heading">
      <span>PLANEJAMENTO OPERACIONAL</span>
      <strong>Campanhas por fases, inteligência, reservas e preparação logística</strong>
    </div>

    {headquarters.map((hq) => {
      const war = warState.wars.find((item) => item.id === hq.warId);
      const force = forceState.forces.find((item) => item.id === hq.forceId);
      if (!war || !force) return null;
      const plans = plansForHeadquarters(hq.id);
      const activeFrontIds = new Set(plans.filter((plan) => !['completed', 'aborted'].includes(plan.status)).map((plan) => plan.frontId));
      const reserve = reserveByHq[hq.id] ?? 25;
      return <div className="operational-hq-card" key={hq.id}>
        <div className="operational-hq-head">
          <div><b>{force.name}</b><span>{war.name} • comandante {names[hq.commanderEntityId] ?? hq.commanderEntityId}</span></div>
          <strong>COORDENAÇÃO {hq.coordination.toFixed(0)}%</strong>
        </div>

        <div className="operational-reserve-control">
          <span>Reserva planejada</span>
          <input type="range" min="10" max="60" step="5" value={reserve} onChange={(event) => setReserveByHq((current) => ({ ...current, [hq.id]: Number(event.target.value) }))}/>
          <b>{reserve}%</b>
        </div>

        <div className="operational-front-list">
          {war.fronts.map((front) => <div className="operational-front-row" key={front.id}>
            <div><b>{front.name}</b><span>progresso {front.progress.toFixed(0)}% • intensidade {front.intensity.toFixed(0)}%</span></div>
            {activeFrontIds.has(front.id) ? <em>OPERAÇÃO ATIVA</em> : <div className="operational-create-actions">
              <button onClick={() => createPlan(hq.id, front.id, `Controlar ${front.name}`, 'deliberate')}>Deliberado</button>
              <button onClick={() => createPlan(hq.id, front.id, `Controlar ${front.name}`, 'standard')}>Padrão</button>
              <button onClick={() => createPlan(hq.id, front.id, `Romper em ${front.name}`, 'rapid')}>Rápido</button>
            </div>}
          </div>)}
        </div>

        {plans.map((plan) => <div className={`operational-plan-card ${plan.status} ${plan.compromised ? 'compromised' : ''}`} key={plan.id}>
          <div className="operational-plan-head">
            <div><b>{plan.name}</b><span>{tempoLabels[plan.tempo]} • reserva {plan.reserveRatio}%</span></div>
            <strong>{plan.status.toUpperCase()}</strong>
          </div>
          <div className="operational-phase-track">
            {(['preparation', 'concentration', 'assault', 'exploitation', 'consolidation'] as OperationPhase[]).map((phase) => <span className={phase === plan.phase ? 'active' : ''} key={phase}>{phaseLabels[phase]}</span>)}
          </div>
          <div className="operational-plan-metrics">
            <span>Preparação <b>{plan.preparationProgress.toFixed(0)}%</b></span>
            <span>Execução <b>{plan.executionProgress.toFixed(0)}%</b></span>
            <span>Risco <b>{plan.risk.toFixed(0)}%</b></span>
            <span>Logística mínima <b>{plan.logisticsRequirement.toFixed(0)}%</b></span>
          </div>
          <div className="operational-intelligence-strip">
            <span className={`intel-${plan.intelligenceAssessment}`}><b>{intelLabels[plan.intelligenceAssessment]}</b><small>Confiança qualitativa do quadro usado no plano</small></span>
            <span className={`surprise-${plan.surpriseState}`}><b>{surpriseLabels[plan.surpriseState]}</b><small>Impacto esperado da incerteza operacional</small></span>
            <span className={plan.compromised ? 'enemy-reacting' : ''}><b>{reactionLabels[plan.enemyReaction]}</b><small>{plan.compromised ? 'Há sinais de que o adversário percebeu a preparação' : 'Nenhuma indicação segura de comprometimento do plano'}</small></span>
          </div>
          <div className="operational-plan-meta">
            <span>Objetivo: {plan.objective}</span>
            <span>Início previsto: dia de campanha {plan.plannedStartElapsedDay}</span>
          </div>
          {plan.compromised && <div className="operational-warning intelligence-warning">PLANO POSSIVELMENTE COMPROMETIDO — o adversário pode ter reforçado ou alterado sua postura antes do ataque.</div>}
          {plan.surpriseState === 'suffered' && <div className="operational-warning intelligence-warning">SURPRESA OPERACIONAL — o quadro encontrado durante o assalto divergiu da inteligência disponível e afetou a organização inicial.</div>}
          {plan.pauseReason && <div className="operational-warning">{plan.pauseReason}</div>}
          {plan.abortReason && <div className="operational-warning">{plan.abortReason}</div>}
          {!['completed', 'aborted'].includes(plan.status) && <div className="operational-plan-actions">
            {plan.status === 'paused' ? <button onClick={() => resume(plan.id)}>Retomar operação</button> : <button onClick={() => pause(plan.id)}>Pausar operação</button>}
            <button className="danger" onClick={() => abort(plan.id)}>Abortar operação</button>
          </div>}
        </div>)}
      </div>;
    })}

    {message && <div className="operational-plan-message">{message}</div>}
    <small className="operational-plan-note">O planejamento usa somente o quadro de inteligência disponível ao comando. Relatórios antigos, fracos ou enganados podem atrasar a preparação, aumentar o risco, reduzir o progresso do ataque ou permitir surpresa inimiga. O combate real continua sendo resolvido pelo motor de frentes, logística, formações e baixas.</small>
  </div>;
}
