import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import {
  breakSanctionsRegime,
  createSanctionsRegime,
  joinSanctionsRegime,
  multilateralSanctionsState,
  processMultilateralSanctions,
  sanctionsRegimesForEntity,
  seekOrganizationSuspension,
  type SanctionsIntensity,
} from '../engine/multilateralSanctions';
import type { SimulationState } from '../engine/simulation';
import type { WarState } from '../engine/war';
import './multilateral-sanctions.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  onSimulationStateChange: (state: SimulationState) => void;
};

const intensityLabels: Record<SanctionsIntensity, string> = {
  limited: 'Pressão limitada',
  coordinated: 'Sanções coordenadas',
  comprehensive: 'Isolamento econômico amplo',
};

function band(value: number) {
  if (value < 25) return 'BAIXO';
  if (value < 50) return 'MODERADO';
  if (value < 75) return 'ELEVADO';
  return 'SEVERO';
}

export function MultilateralSanctionsPanel({ entityId, entities, simulation, warState, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [targetId, setTargetId] = useState(() => entities.find((item) => item.id !== entityId)?.id ?? '');
  const [intensity, setIntensity] = useState<SanctionsIntensity>('coordinated');
  const [message, setMessage] = useState('');
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-multilateral-sanctions', refresh);
    window.addEventListener('world-state-economic-pressure', refresh);
    return () => {
      window.removeEventListener('world-state-multilateral-sanctions', refresh);
      window.removeEventListener('world-state-economic-pressure', refresh);
    };
  }, []);

  useEffect(() => {
    const result = processMultilateralSanctions(simulation, warState);
    if (result.changed) onSimulationStateChange(result.simulation);
  }, [simulation.elapsedDays, warState]);

  void revision;
  const state = multilateralSanctionsState();
  const involved = sanctionsRegimesForEntity(entityId);
  const available = state.regimes.filter((item) => item.status !== 'ended' && item.targetId !== entityId && !item.memberIds.includes(entityId) && !item.breakerIds.includes(entityId)).slice(0, 6);
  const activeTargetingUs = state.regimes.filter((item) => item.status !== 'ended' && item.targetId === entityId);

  function create() {
    if (!targetId) return;
    const result = createSanctionsRegime(entityId, targetId, intensity, simulation, warState);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }
  function join(regimeId: string) {
    const result = joinSanctionsRegime(regimeId, entityId, simulation, warState);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }
  function leave(regimeId: string) {
    const result = breakSanctionsRegime(regimeId, entityId, simulation);
    if (result.accepted) onSimulationStateChange(result.simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }
  function suspend(regimeId: string) {
    const result = seekOrganizationSuspension(regimeId, entityId, simulation);
    setMessage(result.message);
    setRevision((value) => value + 1);
  }

  return <section className="multilateral-sanctions-panel">
    <header className="multilateral-sanctions-heading">
      <div><span>SANÇÕES MULTILATERAIS E ISOLAMENTO</span><strong>Coalizões econômicas, disciplina do regime e acesso a mercados</strong></div>
      <em>{activeTargetingUs.length ? `${activeTargetingUs.length} REGIME(S) CONTRA NÓS` : `${involved.length} REGIME(S) ENVOLVENDO O ESTADO`}</em>
    </header>

    <div className="multilateral-sanctions-create">
      <label><span>Alvo</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{entities.filter((item) => item.id !== entityId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Intensidade</span><select value={intensity} onChange={(event) => setIntensity(event.target.value as SanctionsIntensity)}>{Object.entries(intensityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button disabled={!targetId} onClick={create}>Formar coalizão de sanções</button>
    </div>

    {!!involved.length && <div className="multilateral-sanctions-list">{involved.map((regime) => {
      const sponsor = regime.sponsorId === entityId;
      const member = regime.memberIds.includes(entityId);
      const breaker = regime.breakerIds.includes(entityId);
      return <article className={`multilateral-sanctions-card ${regime.status}`} key={regime.id}>
        <div className="multilateral-sanctions-card-head"><div><b>{names[regime.sponsorId] ?? regime.sponsorId} → {names[regime.targetId] ?? regime.targetId}</b><span>{intensityLabels[regime.intensity]} • {regime.crisisId ? 'baseado em crise de tratado' : 'iniciativa diplomática'}</span></div><strong>{regime.status === 'fractured' ? 'FRATURADO' : 'ATIVO'}</strong></div>
        <div className="multilateral-sanctions-metrics"><span><small>Membros</small><b>{regime.memberIds.length}</b></span><span><small>Coesão</small><b>{band(regime.cohesion)}</b></span><span><small>Isolamento</small><b>{band(regime.marketIsolation)}</b></span><span><small>Legitimidade</small><b>{band(regime.legitimacy)}</b></span></div>
        <div className="multilateral-sanctions-members"><span><small>Coalizão</small>{regime.memberIds.map((id) => <b key={id}>{names[id] ?? id}</b>)}</span>{!!regime.breakerIds.length && <span className="breakers"><small>Romperam o regime</small>{regime.breakerIds.map((id) => <b key={id}>{names[id] ?? id}</b>)}</span>}</div>
        <div className="multilateral-sanctions-actions">{sponsor && <button onClick={() => suspend(regime.id)}>Levar suspensão a organização compartilhada</button>}{member && !sponsor && <button className="danger" onClick={() => leave(regime.id)}>Romper regime de sanções</button>}{breaker && <span>Este Estado rompeu a disciplina do regime e reabriu canais com o alvo.</span>}</div>
      </article>;
    })}</div>}

    {!!available.length && <div className="multilateral-sanctions-available"><strong>Regimes externos disponíveis para adesão</strong>{available.map((regime) => <div key={regime.id}><span>{names[regime.sponsorId] ?? regime.sponsorId} → {names[regime.targetId] ?? regime.targetId} • isolamento {band(regime.marketIsolation)}</span><button onClick={() => join(regime.id)}>Aderir</button></div>)}</div>}

    {!!activeTargetingUs.length && <div className="multilateral-sanctions-warning"><strong>Isolamento recebido</strong><span>Coalizões estrangeiras estão reduzindo nosso acesso a mercados. Relações alternativas e países que rompem o regime podem amortecer a pressão.</span></div>}
    {message && <div className="multilateral-sanctions-message">{message}</div>}
    <small className="multilateral-sanctions-note">As sanções são uma abstração de grande estratégia. A adesão cria medidas comerciais reais no sistema de pressão econômica; a ruptura remove essas restrições e gera custo diplomático com os demais participantes. Suspensões institucionais seguem as regras de votação das organizações existentes, não acontecem automaticamente.</small>
  </section>;
}
