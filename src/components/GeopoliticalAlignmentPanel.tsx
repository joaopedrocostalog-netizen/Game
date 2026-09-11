import React, { useEffect, useMemo, useState } from 'react';
import type { ScenarioEntity } from '../data/scenarios';
import { geopoliticalOutlookForEntity, runAnnualGeopoliticalRealignment } from '../engine/geopoliticalAlignment';
import type { SimulationState } from '../engine/simulation';
import './geopolitical-alignment.css';

type Props = {
  entityId: string;
  entities: ScenarioEntity[];
  simulation: SimulationState;
};

export function GeopoliticalAlignmentPanel({ entityId, entities, simulation }: Props) {
  const [revision, setRevision] = useState(0);
  const names = useMemo(() => Object.fromEntries(entities.map((entity) => [entity.id, entity.name])), [entities]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('world-state-geopolitics', refresh);
    return () => window.removeEventListener('world-state-geopolitics', refresh);
  }, []);

  useEffect(() => {
    const next = runAnnualGeopoliticalRealignment(simulation);
    if (next !== simulation) {
      Object.keys(simulation.diplomacy).forEach((key) => delete simulation.diplomacy[key]);
      Object.assign(simulation.diplomacy, next.diplomacy);
      simulation.treaties.splice(0, simulation.treaties.length, ...next.treaties);
      simulation.events.splice(0, simulation.events.length, ...next.events);
      setRevision((value) => value + 1);
    }
  }, [simulation.date.year]);

  void revision;
  const outlook = geopoliticalOutlookForEntity(simulation, entityId);
  const topPartners = outlook.partners.slice(0, 4);
  const topRivals = outlook.rivals.slice(0, 4);
  const influenced = outlook.influenced.slice(0, 5);

  return <div className="geopolitical-alignment-panel">
    <div className="geopolitical-alignment-heading">
      <span>REALINHAMENTO GEOPOLÍTICO</span>
      <strong>Blocos, rivalidades e influência de longo prazo</strong>
    </div>

    <div className="geopolitical-summary-grid">
      <div><span>Parceiros estratégicos</span><b>{outlook.partners.length}</b></div>
      <div><span>Rivais persistentes</span><b>{outlook.rivals.length}</b></div>
      <div><span>Sob influência</span><b>{outlook.patronage ? names[outlook.patronage.patronId] ?? outlook.patronage.patronId : 'Não'}</b></div>
      <div><span>Influenciados</span><b>{outlook.influenced.length}</b></div>
    </div>

    <div className="geopolitical-columns">
      <section>
        <div className="context-kicker">Aproximações</div>
        {topPartners.length ? topPartners.map((item) => <div className="geopolitical-link partner" key={item.otherId}>
          <div><b>{names[item.otherId] ?? item.otherId}</b><span>Afinidade {item.affinity.toFixed(0)}%</span></div>
          <em>PARCEIRO</em>
        </div>) : <div className="geopolitical-empty">Nenhuma parceria estratégica consolidada.</div>}
      </section>

      <section>
        <div className="context-kicker">Rivalidades</div>
        {topRivals.length ? topRivals.map((item) => <div className="geopolitical-link rival" key={item.otherId}>
          <div><b>{names[item.otherId] ?? item.otherId}</b><span>Hostilidade {item.hostility.toFixed(0)}%</span></div>
          <em>RIVAL</em>
        </div>) : <div className="geopolitical-empty">Nenhuma rivalidade estrutural forte.</div>}
      </section>
    </div>

    {(outlook.patronage || influenced.length > 0) && <div className="geopolitical-sphere-box">
      <div className="context-kicker">Esfera de influência</div>
      {outlook.patronage && <div className="sphere-line"><span>Potência predominante</span><b>{names[outlook.patronage.patronId] ?? outlook.patronage.patronId}</b><em>{outlook.patronage.strength.toFixed(0)}% • {outlook.patronage.trend}</em></div>}
      {influenced.map((item) => <div className="sphere-line" key={item.id}><span>{names[item.memberId] ?? item.memberId}</span><b>{item.strength.toFixed(0)}%</b><em>{item.trend}</em></div>)}
    </div>}

    <small className="geopolitical-note">O realinhamento é recalculado uma vez por ano quando o console estratégico processa o novo ciclo. Alianças, confiança, ameaça e assimetria de poder influenciam rivalidades e esferas. Último ciclo: {outlook.lastProcessedYear ?? 'ainda não processado'}.</small>
  </div>;
}
