import type { ArmyState } from './army';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';
import { territorialPeaceState, type TerritorialPeaceSettlement } from './territorialPeace';
import type { TerritorialControlState } from './territorialControl';

export type TreatyComplianceStatus = 'compliant' | 'warning' | 'breach' | 'crisis';
export type TreatyViolationType = 'demilitarized-zone' | 'reparations-arrears' | 'occupation-overstay';

export type TreatyViolation = {
  id: string;
  treatyId: string;
  type: TreatyViolationType;
  violatorId: string;
  locationId?: string;
  severity: number;
  firstDetectedElapsedDay: number;
  lastDetectedElapsedDay: number;
  resolvedAtElapsedDay?: number;
  description: string;
};

export type ReparationSchedule = {
  clauseId: string;
  payerId: string;
  receiverId: string;
  total: number;
  paid: number;
  installments: number;
  completed: boolean;
  lastPaymentElapsedDay: number;
};

export type TemporaryOccupationSchedule = {
  clauseId: string;
  locationId: string;
  occupierId: string;
  sovereignId: string;
  expiresAtElapsedDay: number;
  released: boolean;
};

export type TreatyEnforcementCrisis = {
  id: string;
  treatyId: string;
  violatorId: string;
  claimantIds: string[];
  severity: number;
  status: 'open' | 'resolved';
  openedAtElapsedDay: number;
  reason: string;
};

export type TreatyComplianceRecord = {
  treatyId: string;
  leaderId: string;
  opponentId: string;
  guarantorIds: string[];
  status: TreatyComplianceStatus;
  reparations: ReparationSchedule[];
  occupations: TemporaryOccupationSchedule[];
  violations: TreatyViolation[];
  crises: TreatyEnforcementCrisis[];
  revanchism: Record<string, number>;
  lastProcessedElapsedDay: number;
};

export type TreatyComplianceState = { records: Record<string, TreatyComplianceRecord> };

type Root = typeof globalThis & { __WORLD_STATE_TREATY_COMPLIANCE__?: TreatyComplianceState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): TreatyComplianceState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_TREATY_COMPLIANCE__) root.__WORLD_STATE_TREATY_COMPLIANCE__ = { records: {} };
  return root.__WORLD_STATE_TREATY_COMPLIANCE__;
}
function publish(state: TreatyComplianceState) {
  (globalThis as Root).__WORLD_STATE_TREATY_COMPLIANCE__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-treaty-compliance', { detail: state }));
}
export function resetTreatyCompliance() { publish({ records: {} }); }
export function treatyComplianceState() {
  return { records: Object.fromEntries(Object.entries(rootState().records).map(([id, record]) => [id, {
    ...record,
    guarantorIds: [...record.guarantorIds],
    reparations: record.reparations.map((item) => ({ ...item })),
    occupations: record.occupations.map((item) => ({ ...item })),
    violations: record.violations.map((item) => ({ ...item })),
    crises: record.crises.map((item) => ({ ...item, claimantIds: [...item.claimantIds] })),
    revanchism: { ...record.revanchism },
  }])) };
}

function initialRecord(settlement: TerritorialPeaceSettlement, elapsedDay: number): TreatyComplianceRecord {
  const signed = settlement.signedAtElapsedDay ?? elapsedDay;
  const reparations = settlement.clauses.filter((item) => item.type === 'reparations').map((clause) => ({
    clauseId: clause.id,
    payerId: settlement.opponentId,
    receiverId: settlement.leaderId,
    total: clause.value ?? 8,
    paid: (clause.value ?? 8) * .25,
    installments: 0,
    completed: false,
    lastPaymentElapsedDay: signed,
  }));
  const occupations = settlement.clauses.filter((item) => item.type === 'temporary-occupation' && item.locationId).map((clause) => ({
    clauseId: clause.id,
    locationId: clause.locationId!,
    occupierId: settlement.leaderId,
    sovereignId: settlement.opponentId,
    expiresAtElapsedDay: signed + (clause.value ?? 365),
    released: false,
  }));
  const punitive = settlement.clauses.filter((item) => item.type === 'annexation' || item.type === 'independence').length;
  return {
    treatyId: settlement.id,
    leaderId: settlement.leaderId,
    opponentId: settlement.opponentId,
    guarantorIds: [],
    status: 'compliant',
    reparations,
    occupations,
    violations: [],
    crises: [],
    revanchism: { [settlement.opponentId]: clamp(16 + punitive * 18), [settlement.leaderId]: 4 },
    lastProcessedElapsedDay: elapsedDay,
  };
}

function mutateRelation(simulation: SimulationState, a: string, b: string, scoreDelta: number, trustDelta: number, threatDelta: number, memory: string) {
  const key = pairKey(a, b);
  const relation = simulation.diplomacy[key];
  if (!relation) return simulation;
  return { ...simulation, diplomacy: { ...simulation.diplomacy, [key]: {
    ...relation,
    score: clamp(relation.score + scoreDelta, -100, 100),
    trust: clamp(relation.trust + trustDelta),
    threat: clamp(relation.threat + threatDelta),
    memory: [memory, ...relation.memory].slice(0, 8),
  } } };
}

function activeViolation(record: TreatyComplianceRecord, id: string) {
  return record.violations.find((item) => item.id === id && item.resolvedAtElapsedDay === undefined);
}
function upsertViolation(record: TreatyComplianceRecord, violation: Omit<TreatyViolation, 'firstDetectedElapsedDay' | 'lastDetectedElapsedDay'>, elapsedDay: number) {
  const existing = activeViolation(record, violation.id);
  if (existing) return { ...record, violations: record.violations.map((item) => item.id === existing.id ? { ...item, lastDetectedElapsedDay: elapsedDay, severity: Math.max(item.severity, violation.severity) } : item) };
  return { ...record, violations: [{ ...violation, firstDetectedElapsedDay: elapsedDay, lastDetectedElapsedDay: elapsedDay }, ...record.violations].slice(0, 40) };
}
function resolveViolation(record: TreatyComplianceRecord, id: string, elapsedDay: number) {
  return { ...record, violations: record.violations.map((item) => item.id === id && item.resolvedAtElapsedDay === undefined ? { ...item, resolvedAtElapsedDay: elapsedDay } : item) };
}

function complianceStatus(record: TreatyComplianceRecord): TreatyComplianceStatus {
  const unresolved = record.violations.filter((item) => item.resolvedAtElapsedDay === undefined);
  if (record.crises.some((item) => item.status === 'open')) return 'crisis';
  if (unresolved.some((item) => item.severity >= 60)) return 'breach';
  if (unresolved.length) return 'warning';
  return 'compliant';
}

export function guaranteeTreaty(entityId: string, treatyId: string) {
  const state = rootState();
  const record = state.records[treatyId];
  if (!record) return { accepted: false, message: 'O tratado ainda não possui um registro ativo de cumprimento.' };
  if (entityId === record.leaderId || entityId === record.opponentId) return { accepted: false, message: 'Uma das partes do tratado não pode registrar-se como garantidor externo.' };
  if (record.guarantorIds.includes(entityId)) return { accepted: false, message: 'Esta entidade já é garantidora do tratado.' };
  const next = { ...record, guarantorIds: [...record.guarantorIds, entityId] };
  publish({ records: { ...state.records, [treatyId]: next } });
  return { accepted: true, message: 'Garantia internacional registrada. Violações futuras poderão envolver este Estado na crise de cumprimento.' };
}

export function withdrawTreatyGuarantee(entityId: string, treatyId: string) {
  const state = rootState();
  const record = state.records[treatyId];
  if (!record || !record.guarantorIds.includes(entityId)) return { accepted: false, message: 'Nenhuma garantia ativa desta entidade foi encontrada.' };
  publish({ records: { ...state.records, [treatyId]: { ...record, guarantorIds: record.guarantorIds.filter((id) => id !== entityId) } } });
  return { accepted: true, message: 'A garantia internacional foi retirada.' };
}

export function processTreatyCompliance(simulation: SimulationState, armyState: ArmyState, territorialControl: TerritorialControlState) {
  const peace = territorialPeaceState();
  const state = rootState();
  let records = { ...state.records };
  let nextSimulation = simulation;
  let nextControl = territorialControl;
  let events = [...simulation.events];
  let changed = false;

  for (const settlement of peace.settlements.filter((item) => item.status === 'signed')) {
    let record = records[settlement.id] ?? initialRecord(settlement, simulation.elapsedDays);
    if (!records[settlement.id]) changed = true;
    const days = Math.max(0, simulation.elapsedDays - record.lastProcessedElapsedDay);
    if (!days) { records[settlement.id] = record; continue; }

    const revanchism = { ...record.revanchism };
    for (const entityId of Object.keys(revanchism)) revanchism[entityId] = clamp(revanchism[entityId] - days * .006);

    for (const zone of peace.demilitarizedZones.filter((item) => item.treatyId === settlement.id)) {
      const violators = armyState.units.filter((unit) => zone.parties.includes(unit.entityId) && unit.locationId === zone.locationId && unit.personnel > 300);
      for (const partyId of zone.parties) {
        const violationId = `dmz-${settlement.id}-${zone.locationId}-${partyId}`;
        const offending = violators.some((unit) => unit.entityId === partyId);
        if (offending) {
          const already = !!activeViolation(record, violationId);
          record = upsertViolation(record, { id: violationId, treatyId: settlement.id, type: 'demilitarized-zone', violatorId: partyId, locationId: zone.locationId, severity: 66, description: 'Forças militares foram detectadas dentro de uma zona desmilitarizada prevista pelo tratado.' }, simulation.elapsedDays);
          const counterpart = partyId === settlement.leaderId ? settlement.opponentId : settlement.leaderId;
          revanchism[counterpart] = clamp((revanchism[counterpart] ?? 0) + days * .025);
          if (!already) {
            events = [{ id: `treaty-dmz-${settlement.id}-${zone.locationId}-${partyId}-${simulation.elapsedDays}`, date: simulation.date, entityId: partyId, category: 'diplomacy', title: 'Violação de zona desmilitarizada', text: 'A presença de forças militares numa região restringida pelo tratado abriu uma disputa formal de cumprimento.' }, ...events].slice(0, 50);
            nextSimulation = mutateRelation(nextSimulation, settlement.leaderId, settlement.opponentId, -9, -12, 10, 'Violação de zona desmilitarizada no tratado de paz.');
          }
        } else if (activeViolation(record, violationId)) record = resolveViolation(record, violationId, simulation.elapsedDays);
      }
    }

    const reparations = record.reparations.map((schedule) => {
      if (schedule.completed || simulation.elapsedDays - schedule.lastPaymentElapsedDay < 30) return schedule;
      const payer = nextSimulation.entities[schedule.payerId];
      const receiver = nextSimulation.entities[schedule.receiverId];
      if (!payer || !receiver) return schedule;
      const remaining = Math.max(0, schedule.total - schedule.paid);
      if (remaining <= .05) return { ...schedule, paid: schedule.total, completed: true };
      const installment = Math.min(remaining, Math.max(.25, schedule.total * .75 / 24));
      const violationId = `reparations-${settlement.id}-${schedule.clauseId}`;
      if (payer.treasuryIndex <= installment + 4) {
        const already = !!activeViolation(record, violationId);
        record = upsertViolation(record, { id: violationId, treatyId: settlement.id, type: 'reparations-arrears', violatorId: schedule.payerId, severity: clamp(48 + Math.min(28, (simulation.elapsedDays - schedule.lastPaymentElapsedDay) / 12)), description: 'O pagamento periódico de reparações está em atraso por insuficiência fiscal ou recusa política.' }, simulation.elapsedDays);
        if (!already) events = [{ id: `reparations-default-${settlement.id}-${schedule.clauseId}-${simulation.elapsedDays}`, date: simulation.date, entityId: schedule.payerId, category: 'diplomacy', title: 'Reparações entram em atraso', text: 'O cronograma de reparações do tratado não foi cumprido e a contraparte passou a considerar a situação uma violação.' }, ...events].slice(0, 50);
        return schedule;
      }
      nextSimulation = { ...nextSimulation, entities: { ...nextSimulation.entities,
        [payer.id]: { ...payer, treasuryIndex: clamp(payer.treasuryIndex - installment) },
        [receiver.id]: { ...receiver, treasuryIndex: clamp(receiver.treasuryIndex + installment * .92) },
      } };
      if (activeViolation(record, violationId)) record = resolveViolation(record, violationId, simulation.elapsedDays);
      const paid = Math.min(schedule.total, schedule.paid + installment);
      return { ...schedule, paid, installments: schedule.installments + 1, completed: paid >= schedule.total - .05, lastPaymentElapsedDay: simulation.elapsedDays };
    });

    const occupations = record.occupations.map((schedule) => ({ ...schedule }));
    for (let i = 0; i < occupations.length; i += 1) {
      const schedule = occupations[i];
      if (schedule.released || simulation.elapsedDays < schedule.expiresAtElapsedDay) continue;
      const occupation = nextControl.occupations[schedule.locationId];
      const troopsRemain = armyState.units.some((unit) => unit.entityId === schedule.occupierId && unit.locationId === schedule.locationId && unit.personnel > 300);
      const violationId = `occupation-${settlement.id}-${schedule.clauseId}`;
      if (occupation?.controllerId === schedule.occupierId) {
        nextControl = { ...nextControl, occupations: { ...nextControl.occupations, [schedule.locationId]: { ...occupation, ownerId: schedule.sovereignId, controllerId: schedule.sovereignId, progress: 0, contested: false, updatedAt: simulation.date } } };
      }
      occupations[i] = { ...schedule, released: true };
      if (troopsRemain) {
        record = upsertViolation(record, { id: violationId, treatyId: settlement.id, type: 'occupation-overstay', violatorId: schedule.occupierId, locationId: schedule.locationId, severity: 72, description: 'O prazo da ocupação temporária terminou, mas forças do antigo ocupante permanecem na região.' }, simulation.elapsedDays);
        events = [{ id: `occupation-overstay-${settlement.id}-${schedule.locationId}-${simulation.elapsedDays}`, date: simulation.date, entityId: schedule.occupierId, category: 'diplomacy', title: 'Prazo de ocupação expirou sob tensão', text: 'A administração territorial foi devolvida conforme o tratado, mas tropas estrangeiras permanecem na região e geram uma nova crise.' }, ...events].slice(0, 50);
      } else {
        events = [{ id: `occupation-ended-${settlement.id}-${schedule.locationId}-${simulation.elapsedDays}`, date: simulation.date, entityId: schedule.sovereignId, category: 'diplomacy', title: 'Ocupação temporária encerrada', text: 'O prazo previsto no tratado terminou e o controle administrativo da região retornou ao soberano formal.' }, ...events].slice(0, 50);
      }
    }

    const unresolved = record.violations.filter((item) => item.resolvedAtElapsedDay === undefined);
    let crises = record.crises.map((item) => ({ ...item, claimantIds: [...item.claimantIds] }));
    for (const violation of unresolved.filter((item) => item.severity >= 60)) {
      if (crises.some((item) => item.status === 'open' && item.violatorId === violation.violatorId)) continue;
      const counterpart = violation.violatorId === settlement.leaderId ? settlement.opponentId : settlement.leaderId;
      const claimantIds = [counterpart, ...record.guarantorIds.filter((id) => id !== violation.violatorId)];
      const age = simulation.elapsedDays - violation.firstDetectedElapsedDay;
      if (!record.guarantorIds.length && age < 60) continue;
      const crisis: TreatyEnforcementCrisis = { id: `treaty-crisis-${settlement.id}-${violation.violatorId}-${simulation.elapsedDays}`, treatyId: settlement.id, violatorId: violation.violatorId, claimantIds, severity: clamp(violation.severity + record.guarantorIds.length * 6 + Math.min(16, age / 15)), status: 'open', openedAtElapsedDay: simulation.elapsedDays, reason: violation.description };
      crises = [crisis, ...crises].slice(0, 20);
      events = [{ id: `treaty-crisis-event-${crisis.id}`, date: simulation.date, entityId: violation.violatorId, category: 'diplomacy', title: 'Crise internacional de cumprimento do tratado', text: `Uma violação grave mobilizou ${claimantIds.length} parte(s) ou garantidor(es). A disputa pode alimentar novas exigências, isolamento diplomático ou um futuro casus belli.` }, ...events].slice(0, 50);
      for (const claimant of claimantIds) nextSimulation = mutateRelation(nextSimulation, claimant, violation.violatorId, -8, -10, 12, 'Crise provocada por violação de tratado de paz garantido.');
    }

    const stillOpenViolators = new Set(unresolved.map((item) => item.violatorId));
    crises = crises.map((crisis) => crisis.status === 'open' && !stillOpenViolators.has(crisis.violatorId) ? { ...crisis, status: 'resolved' as const } : crisis);
    record = { ...record, reparations, occupations, crises, revanchism, lastProcessedElapsedDay: simulation.elapsedDays };
    record.status = complianceStatus(record);
    records[settlement.id] = record;
    changed = true;
  }

  if (changed) {
    nextSimulation = { ...nextSimulation, events };
    publish({ records });
  }
  return { simulation: nextSimulation, territorialControl: nextControl, changed };
}

export function complianceRecordsForEntity(entityId: string) {
  return Object.values(rootState().records)
    .filter((record) => record.leaderId === entityId || record.opponentId === entityId || record.guarantorIds.includes(entityId))
    .map((record) => ({
      ...record,
      guarantorIds: [...record.guarantorIds],
      reparations: record.reparations.map((item) => ({ ...item })),
      occupations: record.occupations.map((item) => ({ ...item })),
      violations: record.violations.map((item) => ({ ...item })),
      crises: record.crises.map((item) => ({ ...item, claimantIds: [...item.claimantIds] })),
      revanchism: { ...record.revanchism },
    }));
}

export function openTreatyCrisesFor(entityId: string) {
  return Object.values(rootState().records).flatMap((record) => record.crises.filter((crisis) => crisis.status === 'open' && (crisis.violatorId === entityId || crisis.claimantIds.includes(entityId))));
}
