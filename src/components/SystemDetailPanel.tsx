import React from 'react';
import { profileFor } from '../data/entityProfiles';
import type { EntityRuntime } from '../engine/simulation';
import './system-detail.css';

type Props = {
  system: 'Economia' | 'População' | 'Política' | 'Militar' | 'Diplomacia' | 'Inteligência' | 'Tecnologia' | 'Estatísticas';
  entityId: string;
  entityName: string;
  year: number;
  runtime?: EntityRuntime;
};

function Bars({ rows }: { rows: Array<{ name: string; share: number }> }) {
  return <div className="detail-bars">{rows.map((row) => <div className="detail-bar-row" key={row.name}>
    <div><span>{row.name}</span><b>{row.share}%</b></div>
    <i><em style={{ width: `${Math.max(1, Math.min(100, row.share))}%` }} /></i>
  </div>)}</div>;
}

export function SystemDetailPanel({ system, entityId, entityName, year, runtime }: Props) {
  const profile = profileFor(entityId);
  if (!profile) return <div className="context-placeholder">Perfil detalhado de {entityName} ainda não foi conectado ao dataset histórico.</div>;

  if (system === 'Economia') {
    return <div className="context-panel">
      <div className="context-kicker">{profile.economy.productionLabel}</div>
      <Bars rows={profile.economy.sectors} />
      <div className="context-grid">
        <div><span>{profile.economy.fiscalLabel}</span><strong>{runtime ? `${runtime.treasuryIndex.toFixed(1)} idx` : 'Estimado'}</strong></div>
        <div><span>Atividade econômica</span><strong>{runtime ? `${runtime.economyIndex.toFixed(1)} idx` : 'Estimado'}</strong></div>
      </div>
      <div className="tag-block"><span>Recursos / capacidades</span><div>{profile.economy.resources.map((item) => <b key={item}>{item}</b>)}</div></div>
      <div className="tag-block"><span>Redes de comércio</span><div>{profile.economy.trade.map((item) => <b key={item}>{item}</b>)}</div></div>
      <p className="context-note">Os percentuais desta versão são perfis de gameplay iniciais e serão substituídos progressivamente por dados históricos/econômicos versionados por cenário.</p>
    </div>;
  }

  if (system === 'População') {
    return <div className="context-panel">
      <div className="context-kicker">{profile.population.socialLabel}</div>
      <Bars rows={profile.population.groups} />
      <div className="context-kicker context-gap">Religião / tradições</div>
      <Bars rows={profile.population.faiths} />
      <div className="tag-block"><span>Regiões principais</span><div>{profile.population.regions.map((item) => <b key={item}>{item}</b>)}</div></div>
      <div className="context-grid">
        <div><span>Índice populacional</span><strong>{runtime ? runtime.populationIndex.toFixed(1) : '—'}</strong></div>
        <div><span>Estabilidade social</span><strong>{runtime ? `${runtime.stability.toFixed(1)}%` : '—'}</strong></div>
      </div>
      <p className="context-note">As categorias são adaptadas ao período: em {year < 1800 ? 'sociedades pré-industriais' : 'cenários modernos'}, o jogo evita impor classificações anacrônicas.</p>
    </div>;
  }

  if (system === 'Estatísticas' && runtime) {
    const rows = [
      { name: 'Economia', share: runtime.economyIndex },
      { name: 'População', share: runtime.populationIndex },
      { name: 'Prontidão militar', share: runtime.militaryReadiness },
      { name: 'Tecnologia', share: runtime.technology },
      { name: 'Estabilidade', share: runtime.stability },
    ];
    return <div className="context-panel"><div className="context-kicker">Índices comparáveis da simulação</div><Bars rows={rows} /><p className="context-note">São índices internos de gameplay, não equivalem automaticamente a PIB, renda, efetivo ou outras medidas históricas reais.</p></div>;
  }

  return <div className="context-placeholder">O painel avançado de {system.toLowerCase()} está conectado ao motor-base e será aprofundado nas próximas versões.</div>;
}
