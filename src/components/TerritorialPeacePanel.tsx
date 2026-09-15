import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { locationsForYear } from '../data/territories';
import {
  addTerritorialPeaceClause,
  eligibleEmergentBeneficiaries,
  eligiblePeaceLocations,
  openTerritorialSettlement,
  settlementsForEntity,
  signTerritorialSettlement,
  territorialPeaceState,
  type TerritorialPeaceTerm,
} from '../engine/territorialPeace';
import type { SimulationState } from '../engine/simulation';
import type { TerritorialControlState } from '../engine/territorialControl';
import type { WarState } from '../engine/war';
import './territorial-peace.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
  warState: WarState;
  territorialControl: TerritorialControlState;
  onSimulationStateChange: (state: SimulationState) => void;
};

type ControlGlobal = typeof globalThis & { __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

const termLabels: Record<TerritorialPeaceTerm, string> = {
  annexation: 'Anexação direta',
  restitution: 'Devolução / restauração de soberania',
  autonomy: 'Autonomia sob nova autoridade local',
  independence: 'Reconhecimento de independência',
  demilitarized: 'Zona desmilitarizada',
  reparations: 'Reparações econômicas',
  plebiscite: 'Consulta política / plebiscito abstrato',
};

function clauseSummary(type: TerritorialPeaceTerm) {
  if (type === 'annexation') return 'Transfere soberania e controle ao líder vencedor.';
  if (type === 'restitution') return 'Restaura a região ao Estado derrotado, encerrando a ocupação.';
  if (type === 'autonomy') return 'Mantém soberania formal do Estado de origem, mas entrega o controle à entidade emergente.';
  if (type === 'independence') return 'Transfere soberania e controle para uma entidade emergente compatível.';
  if (type === 'demilitarized') return 'Registra a região como zona desmilitarizada no tratado.';
  if (type === 'reparations') return 'Transfere capacidade fiscal do derrotado ao vencedor.';
  return 'Resolve de forma abstrata e incerta qual autoridade recebe a soberania da região.';
}

export function TerritorialPeacePanel({ entityId, entities, simulation, warState, territorialControl, onSimulationStateChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [termDraft, setTermDraft] = useState<Record<string, TerritorialPeaceTerm>>({});
  const [locationDraft, setLocationDraft] = useState<Record<string, string>>({});
  const [beneficiaryDraft, setBeneficiaryDraft] = useState<Record<string, string>>({});
  const [reparationsDraft, setReparationsDraft] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-territorial-peace', refresh);
    window.addEventListener('world-state-territorial-control', refresh);
    window.addEventListener('world-state-emergent-statehood', refresh);
    return () => {
      window.removeEventListener('world-state-territorial-peace', refresh);
      window.removeEventListener('world-state-territorial-control', refresh);
      window.removeEventListener('world-state-emergent-statehood', refresh);
    };
  }, []);

  void revision;
  const names = useMemo(() => Object.fromEntries(entities.map((item) => [item.id, item.name])), [entities]);
  const locationMap = useMemo(() => new Map(locationsForYear(simulation.date.year).map((item) => [item.id, item.name])), [simulation.date.year]);
  const endedVictories = warState.wars.filter((war) => war.status === 'ended' && war.victor !== 'stalemate' && (
    (war.victor === 'attackers' && war.attackerId === entityId) ||
    (war.victor === 'defenders' && war.defenderId === entityId)
  )).slice(0, 5);
  if (!endedVictories.length) return null;

  function publishControl(next: TerritorialControlState) {
    Object.keys(territorialControl.occupations).forEach((key) => delete territorialControl.occupations[key]);
    Object.assign(territorialControl.occupations, next.occupations);
    const published = { ...territorialControl, occupations: { ...territorialControl.occupations }, battles: [...territorialControl.battles] };
    (globalThis as ControlGlobal).__WORLD_STATE_TERRITORIAL_CONTROL__ = published;
    window.dispatchEvent(new CustomEvent('world-state-territorial-control', { detail: published }));
  }

  function open(warId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const settlement = openTerritorialSettlement(war, entityId, simulation);
    setMessage((current) => ({ ...current, [warId]: settlement ? 'Negociação territorial aberta. Monte o tratado cláusula por cláusula.' : 'Não foi possível abrir a negociação territorial.' }));
    setRevision((value) => value + 1);
  }

  function addClause(warId: string, settlementId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const type = termDraft[warId] ?? 'annexation';
    const result = addTerritorialPeaceClause(settlementId, war, type, simulation, territorialControl, {
      locationId: type === 'reparations' ? undefined : locationDraft[warId],
      beneficiaryId: beneficiaryDraft[warId],
      value: reparationsDraft[warId] ?? 8,
    });
    setMessage((current) => ({ ...current, [warId]: result.message }));
    setRevision((value) => value + 1);
  }

  function sign(warId: string, settlementId: string) {
    const war = warState.wars.find((item) => item.id === warId);
    if (!war) return;
    const result = signTerritorialSettlement(settlementId, war, simulation, territorialControl);
    if (result.accepted) {
      onSimulationStateChange(result.simulation);
      publishControl(result.territorialControl);
    }
    setMessage((current) => ({ ...current, [warId]: result.message }));
    setRevision((value) => value + 1);
  }

  const settlements = settlementsForEntity(entityId, warState);
  const peaceState = territorialPeaceState();

  return <section className="territorial-peace-panel">
    <header className="territorial-peace-heading">
      <div><span>TRATADO TERRITORIAL PÓS-GUERRA</span><strong>Fronteiras, soberania, autonomia e reparações</strong></div>
      <em>{peaceState.demilitarizedZones.length} ZONA(S) DESMILITARIZADA(S)</em>
    </header>

    {endedVictories.map((war) => {
      const settlement = settlements.find((item) => item.warId === war.id);
      const locations = eligiblePeaceLocations(war, simulation.date.year, territorialControl);
      const type = termDraft[war.id] ?? 'annexation';
      const locationId = locationDraft[war.id] ?? locations[0]?.id ?? '';
      const beneficiaries = eligibleEmergentBeneficiaries(settlement?.opponentId ?? (war.victor === 'attackers' ? war.defenderId : war.attackerId), locationId);
      const needsBeneficiary = type === 'autonomy' || type === 'independence' || type === 'plebiscite';
      return <article className="territorial-peace-war" key={war.id}>
        <div className="territorial-peace-war-head">
          <div><b>{names[war.attackerId] ?? war.attackerId} × {names[war.defenderId] ?? war.defenderId}</b><span>Redesenho político após a vitória</span></div>
          <strong>{settlement ? settlement.status === 'draft' ? 'EM NEGOCIAÇÃO' : 'TRATADO ASSINADO' : 'AGUARDANDO'}</strong>
        </div>

        {!settlement && <button className="territorial-peace-open" onClick={() => open(war.id)}>Abrir negociação territorial</button>}

        {settlement && <>
          <div className="territorial-peace-meta">
            <span>Regiões elegíveis <b>{locations.length}</b></span>
            <span>Cláusulas <b>{settlement.clauses.length}</b></span>
            <span>Contraparte <b>{names[settlement.opponentId] ?? settlement.opponentId}</b></span>
          </div>

          {settlement.status === 'draft' && <div className="territorial-peace-builder">
            <label><span>Cláusula</span><select value={type} onChange={(event) => setTermDraft((current) => ({ ...current, [war.id]: event.target.value as TerritorialPeaceTerm }))}>{Object.entries(termLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {type !== 'reparations' && <label><span>Região</span><select value={locationId} onChange={(event) => setLocationDraft((current) => ({ ...current, [war.id]: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
            {needsBeneficiary && <label><span>Beneficiário</span><select value={beneficiaryDraft[war.id] ?? ''} onChange={(event) => setBeneficiaryDraft((current) => ({ ...current, [war.id]: event.target.value }))}><option value="">Selecionar…</option>{beneficiaries.map((id) => <option key={id} value={id}>{names[id] ?? id}</option>)}{type === 'plebiscite' && !beneficiaries.includes(settlement.leaderId) && <option value={settlement.leaderId}>{names[settlement.leaderId] ?? settlement.leaderId}</option>}</select></label>}
            {type === 'reparations' && <label><span>Pressão fiscal</span><input type="number" min={2} max={25} value={reparationsDraft[war.id] ?? 8} onChange={(event) => setReparationsDraft((current) => ({ ...current, [war.id]: Number(event.target.value) }))}/></label>}
            <p>{clauseSummary(type)}</p>
            <button onClick={() => addClause(war.id, settlement.id)} disabled={(type !== 'reparations' && !locationId) || (needsBeneficiary && !beneficiaryDraft[war.id])}>Adicionar cláusula</button>
          </div>}

          <div className="territorial-peace-clauses">
            {settlement.clauses.length === 0 ? <div className="territorial-peace-empty">Nenhuma cláusula adicionada.</div> : settlement.clauses.map((clause) => <div key={clause.id}>
              <strong>{termLabels[clause.type]}</strong>
              <span>{clause.locationId ? locationMap.get(clause.locationId) ?? clause.locationId : 'Cláusula econômica'}{clause.beneficiaryId ? ` → ${names[clause.beneficiaryId] ?? clause.beneficiaryId}` : ''}</span>
              <small>{clause.type === 'reparations' ? `Pressão fiscal ${clause.value?.toFixed(0) ?? '—'}` : clause.note}</small>
            </div>)}
          </div>

          {settlement.status === 'draft' && <button className="territorial-peace-sign" disabled={!settlement.clauses.length} onClick={() => sign(war.id, settlement.id)}>Assinar tratado e aplicar fronteiras</button>}
          {message[war.id] && <div className="territorial-peace-message">{message[war.id]}</div>}
        </>}
      </article>;
    })}

    <small className="territorial-peace-note">A conferência territorial altera o estado político da campanha apenas quando o tratado é assinado. Anexações exigem controle militar relevante ou vitória decisiva; autonomia preserva soberania formal do Estado de origem; independência exige uma entidade emergente compatível; plebiscitos são abstrações políticas incertas, não pesquisas históricas exatas.</small>
  </section>;
}
