import React, { useMemo, useState } from 'react';
import { profileFor } from '../data/entityProfiles';
import { locationsForEntity } from '../data/territories';
import { diplomaticReply, relationBetween } from '../data/diplomacy';
import { scenarios } from '../data/scenarios';
import type { EntityRuntime } from '../engine/simulation';
import './system-detail.css';

type SystemName = 'Economia' | 'População' | 'Política' | 'Militar' | 'Diplomacia' | 'Inteligência' | 'Tecnologia' | 'Estatísticas';

type Props = {
  system: SystemName;
  entityId: string;
  entityName: string;
  year: number;
  runtime?: EntityRuntime;
  allRuntimes?: Record<string, EntityRuntime>;
};

type ChatMessage = { side: 'player' | 'foreign'; text: string };

function Bars({ rows }: { rows: Array<{ name: string; share: number }> }) {
  return <div className="detail-bars">{rows.map((row) => <div className="detail-bar-row" key={row.name}>
    <div><span>{row.name}</span><b>{row.share.toFixed(row.share % 1 ? 1 : 0)}%</b></div>
    <i><em style={{ width: `${Math.max(1, Math.min(100, row.share))}%` }} /></i>
  </div>)}</div>;
}

function Tags({ label, items }: { label: string; items: string[] }) {
  return <div className="tag-block"><span>{label}</span><div>{items.map((item) => <b key={item}>{item}</b>)}</div></div>;
}

function technologyBranches(year: number) {
  if (year < 1600) return ['Administração e escrita', 'Metalurgia', 'Navegação', 'Fortificações', 'Artilharia de pólvora', 'Agricultura', 'Cartografia'];
  if (year < 1800) return ['Método científico', 'Metalurgia avançada', 'Navegação oceânica', 'Artilharia', 'Manufaturas', 'Administração fiscal'];
  if (year < 1914) return ['Vapor', 'Ferrovias', 'Aço', 'Eletricidade', 'Química', 'Telégrafo', 'Medicina moderna'];
  if (year < 1945) return ['Motores', 'Aviação', 'Rádio', 'Blindados', 'Produção em massa', 'Eletrônica inicial'];
  if (year < 1990) return ['Energia nuclear', 'Jatos', 'Computação', 'Satélites', 'Telecomunicações', 'Mísseis'];
  return ['Semicondutores', 'IA e computação', 'Biotecnologia', 'Energia avançada', 'Espaço', 'Robótica', 'Redes digitais'];
}

function DiplomacyConsole({ entityId, year, allRuntimes }: { entityId: string; year: number; allRuntimes?: Record<string, EntityRuntime> }) {
  const scenario = scenarios.find((item) => item.year === year) ?? scenarios.reduce((best, item) => Math.abs(item.year - year) < Math.abs(best.year - year) ? item : best, scenarios[0]);
  const from = scenario.entities.find((item) => item.id === entityId) ?? scenario.entities[0];
  const targets = scenario.entities.filter((item) => item.id !== from.id);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const target = targets.find((item) => item.id === targetId) ?? targets[0];
  const relation = target ? relationBetween(from, target, year) : null;

  function send() {
    const text = draft.trim();
    if (!text || !target) return;
    const reply = diplomaticReply(from, target, text, year);
    const outgoing: ChatMessage = { side: 'player', text };
    const incoming: ChatMessage = { side: 'foreign', text: reply };
    setMessages((current) => [...current, outgoing, incoming].slice(-8));
    setDraft('');
  }

  if (!target || !relation) return <div className="context-placeholder">Não há outra entidade conhecida disponível para contato neste cenário.</div>;

  const foreignRuntime = allRuntimes?.[target.id];
  return <div className="diplomacy-console">
    <div className="context-kicker">Canal diplomático</div>
    <select value={target.id} onChange={(event) => { setTargetId(event.target.value); setMessages([]); }}>
      {targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <div className="context-grid diplomacy-grid">
      <div><span>Relação</span><strong>{relation.score}/100</strong></div>
      <div><span>Confiança</span><strong>{relation.trust}/100</strong></div>
      <div><span>Interesse comercial</span><strong>{relation.tradeInterest}/100</strong></div>
      <div><span>Ameaça percebida</span><strong>{relation.threat}/100</strong></div>
    </div>
    <Tags label="Memória diplomática conhecida" items={relation.memory} />
    {foreignRuntime && <p className="context-note">Os índices internos de {target.name} não são exibidos aqui: o canal diplomático respeita fog of war e não revela dados secretos do motor.</p>}
    <div className="diplomatic-chat">
      {messages.length === 0 ? <div className="chat-empty">Escreva uma proposta livre. A resposta será condicionada pela relação, interesses e contexto do alvo.</div> : messages.map((message, index) => <div key={index} className={`chat-bubble ${message.side}`}><span>{message.side === 'player' ? from.name : target.name}</span><p>{message.text}</p></div>)}
    </div>
    <div className="diplomatic-compose">
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') send(); }} placeholder={`Fale com ${target.name}…`} />
      <button type="button" onClick={send}>Enviar</button>
    </div>
    <p className="context-note">Nesta alpha, as relações explícitas são priors de gameplay e as demais são geradas deterministicamente. A versão final usará memória histórica + acontecimentos reais da partida.</p>
  </div>;
}

function WorldRankings({ year, allRuntimes }: { year: number; allRuntimes?: Record<string, EntityRuntime> }) {
  const scenario = scenarios.find((item) => item.year === year) ?? scenarios.reduce((best, item) => Math.abs(item.year - year) < Math.abs(best.year - year) ? item : best, scenarios[0]);
  const rankings = useMemo(() => scenario.entities.map((item) => {
    const runtime = allRuntimes?.[item.id];
    const economy = runtime?.economyIndex ?? 50;
    const military = runtime?.militaryReadiness ?? item.military;
    const technology = runtime?.technology ?? item.technology;
    const stability = runtime?.stability ?? item.stability;
    const power = economy * .32 + military * .31 + technology * .25 + stability * .12;
    return { item, economy, military, technology, power };
  }).sort((a, b) => b.power - a.power), [scenario, allRuntimes]);

  return <div className="world-ranking">
    <div className="context-kicker">Ranking mundial conhecido • {year}</div>
    <div className="ranking-head"><span>#</span><span>Entidade</span><span>Poder</span><span>Eco.</span><span>Mil.</span><span>Tec.</span></div>
    {rankings.slice(0, 12).map((row, index) => <div className="ranking-row" key={row.item.id}>
      <span>{index + 1}</span><strong>{row.item.name}</strong><b>{row.power.toFixed(1)}</b><span>{row.economy.toFixed(0)}</span><span>{row.military.toFixed(0)}</span><span>{row.technology.toFixed(0)}</span>
    </div>)}
    <p className="context-note">O índice de poder combina variáveis internas de gameplay. PIB, PIB per capita, renda e população comparável serão adicionados quando o dataset econômico histórico por cenário estiver validado; o jogo não inventará esses números.</p>
  </div>;
}

export function SystemDetailPanel({ system, entityId, entityName, year, runtime, allRuntimes }: Props) {
  const profile = profileFor(entityId);
  const locations = locationsForEntity(entityId, year);

  if (system === 'Economia') {
    if (!profile) return <div className="context-placeholder">A economia detalhada de {entityName} ainda está sendo ligada ao dataset histórico. O motor-base continua ativo sem inventar setores específicos.</div>;
    return <div className="context-panel">
      <div className="context-kicker">{profile.economy.productionLabel}</div>
      <Bars rows={profile.economy.sectors} />
      <div className="context-grid">
        <div><span>{profile.economy.fiscalLabel}</span><strong>{runtime ? `${runtime.treasuryIndex.toFixed(1)} idx` : 'Estimado'}</strong></div>
        <div><span>Atividade econômica</span><strong>{runtime ? `${runtime.economyIndex.toFixed(1)} idx` : 'Estimado'}</strong></div>
      </div>
      <Tags label="Recursos / capacidades" items={profile.economy.resources} />
      <Tags label="Redes de comércio" items={profile.economy.trade} />
      <p className="context-note">Os percentuais desta versão são perfis de gameplay iniciais e serão substituídos progressivamente por dados históricos/econômicos versionados por cenário.</p>
    </div>;
  }

  if (system === 'População') {
    if (!profile) return <div className="context-placeholder">A composição populacional detalhada de {entityName} ainda não foi validada para este cenário. O jogo evita preencher etnia, religião ou classes com categorias inventadas.</div>;
    return <div className="context-panel">
      <div className="context-kicker">{profile.population.socialLabel}</div>
      <Bars rows={profile.population.groups} />
      <div className="context-kicker context-gap">Religião / tradições</div>
      <Bars rows={profile.population.faiths} />
      <Tags label="Regiões principais" items={profile.population.regions} />
      <div className="context-grid">
        <div><span>Índice populacional</span><strong>{runtime ? runtime.populationIndex.toFixed(1) : '—'}</strong></div>
        <div><span>Estabilidade social</span><strong>{runtime ? `${runtime.stability.toFixed(1)}%` : '—'}</strong></div>
      </div>
      <p className="context-note">As categorias são adaptadas ao período: em {year < 1800 ? 'sociedades pré-industriais' : 'cenários modernos'}, o jogo evita impor classificações anacrônicas.</p>
    </div>;
  }

  if (system === 'Política') {
    return <div className="context-panel">
      <div className="context-kicker">Administração territorial</div>
      <div className="context-grid">
        <div><span>Locations conectadas</span><strong>{locations.length}</strong></div>
        <div><span>Estabilidade do Estado</span><strong>{runtime ? `${runtime.stability.toFixed(1)}%` : '—'}</strong></div>
      </div>
      <Tags label={year < 1800 ? 'Centros e domínios registrados' : 'Centros territoriais registrados'} items={locations.slice(0, 8).map((item) => item.name)} />
      <p className="context-note">{year < 1800 ? 'A legitimidade deve considerar dinastia, elites, religião, costumes locais e autonomia regional conforme a entidade.' : 'A governança moderna poderá considerar instituições, eleições, partidos, federalismo, leis e opinião pública.'}</p>
    </div>;
  }

  if (system === 'Militar') {
    const terrainCounts = Object.entries(locations.reduce<Record<string, number>>((acc, item) => {
      acc[item.terrain] = (acc[item.terrain] ?? 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).map(([terrain, count]) => `${terrain}: ${count}`);
    return <div className="context-panel">
      <div className="context-kicker">Capacidade militar contextual</div>
      {runtime && <Bars rows={[
        { name: 'Prontidão', share: runtime.militaryReadiness },
        { name: 'Sustentação fiscal', share: runtime.treasuryIndex },
        { name: 'Base tecnológica', share: runtime.technology },
      ]} />}
      <Tags label="Terrenos registrados" items={terrainCounts.length ? terrainCounts : ['Cobertura territorial detalhada pendente']} />
      <p className="context-note">Em {year}, unidades, logística, fortificações e doutrinas serão limitadas às tecnologias e instituições disponíveis na época.</p>
    </div>;
  }

  if (system === 'Tecnologia') {
    const base = runtime?.technology ?? 50;
    const branches = technologyBranches(year).map((name, index) => ({ name, share: Math.max(8, Math.min(100, base - index * 3 + ((index % 2) * 5))) }));
    return <div className="context-panel">
      <div className="context-kicker">Ramos conhecidos / acessíveis em {year}</div>
      <Bars rows={branches} />
      <p className="context-note">Esta é uma leitura de capacidade, não uma lista de desbloqueios automáticos. Difusão, contato exterior, educação, indústria e pré-requisitos determinarão quando cada tecnologia poderá ser dominada e adotada.</p>
    </div>;
  }

  if (system === 'Diplomacia') {
    return <div className="context-panel">
      {runtime && <Bars rows={[
        { name: 'Peso econômico', share: runtime.economyIndex },
        { name: 'Peso militar', share: runtime.militaryReadiness },
        { name: 'Estabilidade interna', share: runtime.stability },
      ]} />}
      <DiplomacyConsole entityId={entityId} year={year} allRuntimes={allRuntimes} />
    </div>;
  }

  if (system === 'Inteligência' && runtime) {
    return <div className="context-panel">
      <div className="context-kicker">Capacidade de inteligência</div>
      <Bars rows={[
        { name: 'Capacidade técnica', share: runtime.technology },
        { name: 'Recursos disponíveis', share: runtime.treasuryIndex },
        { name: 'Segurança interna', share: runtime.stability },
      ]} />
      <p className="context-note">O Conselheiro e o jogador continuam limitados ao conhecimento que o Estado poderia razoavelmente possuir; inteligência não revela o estado interno real do motor automaticamente.</p>
    </div>;
  }

  if (system === 'Estatísticas') {
    return <div className="context-panel">
      {runtime && <><div className="context-kicker">Índices da entidade ativa</div><Bars rows={[
        { name: 'Economia', share: runtime.economyIndex },
        { name: 'População', share: runtime.populationIndex },
        { name: 'Prontidão militar', share: runtime.militaryReadiness },
        { name: 'Tecnologia', share: runtime.technology },
        { name: 'Estabilidade', share: runtime.stability },
      ]} /></>}
      <WorldRankings year={year} allRuntimes={allRuntimes} />
    </div>;
  }

  return <div className="context-placeholder">O painel avançado de {system.toLowerCase()} continuará sendo aprofundado nas próximas versões.</div>;
}
