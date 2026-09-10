import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brain, ChevronRight, FastForward, Globe2, Landmark, Map, Pause, Play, Settings2, Shield, Sparkles, Swords, TrendingUp, Users, BarChart3, Eye } from 'lucide-react';
import { WorldMap } from './components/WorldMap';
import { scenarios, type ScenarioEntity } from './data/scenarios';
import './styles.css';

type MapMode = 'Político' | 'Economia' | 'População' | 'Militar' | 'Tecnologia';
type UiMode = 'Simples' | 'Avançada';
type SystemName = 'Economia' | 'População' | 'Política' | 'Militar' | 'Diplomacia' | 'Inteligência' | 'Tecnologia' | 'Estatísticas';
type GameDate = { year: number; month: number; day: number };

const systemInfo: Record<SystemName, string> = {
  Economia: 'Produção, mercados, comércio, orçamento, trabalho, infraestrutura e cadeias produtivas adequadas à época.',
  População: 'Demografia, culturas, religiões, grupos sociais, profissões, migração e qualidade de vida.',
  Política: 'Governo, leis, instituições, grupos de interesse, legitimidade, eleições ou estruturas históricas equivalentes.',
  Militar: 'Forças, unidades, comandantes, logística, mobilização, planejamento, doutrinas e ocupação.',
  Diplomacia: 'Tratados, relações, confiança, rivalidades, comércio, influência e comunicação com outras entidades.',
  Inteligência: 'Coleta de informação, contraespionagem e operações clandestinas abstratas sujeitas a risco e descoberta.',
  Tecnologia: 'Conhecimento, difusão, adoção, capacidade local, pesquisa, contato exterior e catch-up tecnológico.',
  Estatísticas: 'Gráficos nacionais, comparações históricas e rankings mundiais limitados à informação conhecida pelo Estado.',
};

function addDays(date: GameDate, days: number): GameDate {
  const js = new Date(Date.UTC(date.year, date.month - 1, date.day));
  js.setUTCDate(js.getUTCDate() + days);
  return { year: js.getUTCFullYear(), month: js.getUTCMonth() + 1, day: js.getUTCDate() };
}

function formatDate(date: GameDate) {
  const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return { dayMonth: `${String(date.day).padStart(2, '0')} ${months[date.month - 1]}`, year: date.year };
}

function genericEntity(name: string): ScenarioEntity {
  return {
    id: `map-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type: 'Entidade selecionada no mapa',
    population: 'Dados em integração',
    treasury: '—',
    stability: 50,
    military: 50,
    technology: 50,
    culture: 'Dados históricos em integração',
    government: 'Dados em integração',
    specialty: 'Perfil histórico ainda será conectado ao banco temporal.',
  };
}

function App() {
  const [scenarioId, setScenarioId] = useState('2026');
  const scenario = useMemo(() => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0], [scenarioId]);
  const [selectedId, setSelectedId] = useState(scenarios[0].entities[0].id);
  const [mapSelection, setMapSelection] = useState<ScenarioEntity | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('Político');
  const [uiMode, setUiMode] = useState<UiMode>('Simples');
  const [activeSystem, setActiveSystem] = useState<SystemName>('Economia');
  const [speed, setSpeed] = useState(0);
  const [date, setDate] = useState<GameDate>({ year: 2026, month: 1, day: 1 });
  const [command, setCommand] = useState('');
  const [advisorText, setAdvisorText] = useState('Selecione uma entidade, consulte um sistema ou dê uma ordem. O Conselheiro só usará informações disponíveis ao seu Estado.');

  const seededEntity = useMemo(() => scenario.entities.find((item) => item.id === selectedId), [scenario, selectedId]);
  const entity = mapSelection ?? seededEntity ?? scenario.entities[0];
  const shownDate = formatDate(date);

  useEffect(() => {
    if (speed === 0) return;
    const interval = window.setInterval(() => setDate((value) => addDays(value, 1)), Math.max(130, 1100 / speed));
    return () => window.clearInterval(interval);
  }, [speed]);

  function changeScenario(id: string) {
    const next = scenarios.find((item) => item.id === id) ?? scenarios[0];
    setScenarioId(next.id);
    setSelectedId(next.entities[0].id);
    setMapSelection(null);
    setDate({ year: next.year, month: 1, day: 1 });
    setSpeed(0);
    setAdvisorText(`Cenário ${next.label} carregado. ${next.historicalLayerReady ? 'A geografia política contemporânea está disponível.' : 'A base política histórica completa será conectada ao motor territorial temporal.'}`);
  }

  function advanceDays(days: number, label: string) {
    setDate((value) => addDays(value, days));
    setAdvisorText(`Tempo avançado em ${label}. Os sistemas serão recalculados por ticks separados conforme o motor de simulação for sendo conectado.`);
  }

  function handleMapCountry(name: string) {
    if (!scenario.historicalLayerReady) {
      setAdvisorText(`Você selecionou a área correspondente a ${name} na geografia-base. No cenário de ${scenario.year}, o limite moderno não representa necessariamente a entidade histórica; a seleção política ficará vinculada às locations temporais quando esse dataset for integrado.`);
      return;
    }
    const known = scenario.entities.find((item) => item.name.toLowerCase() === name.toLowerCase());
    setMapSelection(known ?? genericEntity(name));
    if (known) setSelectedId(known.id);
  }

  function selectEntity(item: ScenarioEntity) {
    setSelectedId(item.id);
    setMapSelection(null);
    setAdvisorText(`${item.name} selecionado. Diferencial inicial: ${item.specialty}.`);
  }

  function submitCommand(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    setAdvisorText(`Ordem recebida para ${entity.name}: “${trimmed}”. A intenção foi registrada. O próximo estágio do motor transformará comandos em ações contextuais válidas para ${date.year}, respeitando recursos, instituições, tecnologia e conhecimento disponível.`);
    setCommand('');
  }

  const systems: { name: SystemName; icon: React.ReactNode }[] = [
    { name: 'Economia', icon: <TrendingUp size={16}/> },
    { name: 'População', icon: <Users size={16}/> },
    { name: 'Política', icon: <Landmark size={16}/> },
    { name: 'Militar', icon: <Swords size={16}/> },
    { name: 'Diplomacia', icon: <Shield size={16}/> },
    { name: 'Inteligência', icon: <Eye size={16}/> },
    { name: 'Tecnologia', icon: <Sparkles size={16}/> },
    { name: 'Estatísticas', icon: <BarChart3 size={16}/> },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Globe2 size={19} /></div>
          <div><strong>WORLD STATE</strong><span>Grand Strategy Simulator • alpha 0.2</span></div>
        </div>

        <div className="time-center">
          <button className={speed === 0 ? 'icon-button active' : 'icon-button'} onClick={() => setSpeed(0)} aria-label="Pausar"><Pause size={16} /></button>
          {[1, 2, 4, 8].map((value) => <button key={value} className={speed === value ? 'speed active' : 'speed'} onClick={() => setSpeed(value)}>{value}×</button>)}
          <div className="date-pill"><span>{shownDate.dayMonth}</span><strong>{shownDate.year}</strong></div>
          <button className="icon-button" onClick={() => advanceDays(30, '30 dias')} aria-label="Avançar 30 dias"><FastForward size={16} /></button>
        </div>

        <div className="top-actions">
          <select className="scenario-select" value={scenarioId} onChange={(event) => changeScenario(event.target.value)} aria-label="Selecionar cenário">
            {scenarios.map((item) => <option value={item.id} key={item.id}>{item.label} — {item.year}</option>)}
          </select>
          <button className="mode-toggle" onClick={() => setUiMode((mode) => mode === 'Simples' ? 'Avançada' : 'Simples')}><Settings2 size={15} /> {uiMode}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel panel">
          <div className="eyebrow">ENTIDADE ATIVA</div>
          <h1>{entity.name}</h1>
          <div className="entity-meta">{entity.type} • {entity.government}</div>
          <div className="specialty">{entity.specialty}</div>

          <div className="stat-grid">
            <Stat label="População" value={entity.population} />
            <Stat label="Tesouro" value={entity.treasury} />
            <Stat label="Estabilidade" value={`${entity.stability}%`} />
            <Stat label="Tecnologia" value={`${entity.technology}`} />
          </div>

          <div className="section-title">Sistemas</div>
          <nav className="side-nav">
            {systems.map((item) => (
              <button key={item.name} className={activeSystem === item.name ? 'nav-active' : ''} onClick={() => setActiveSystem(item.name)}>
                {item.icon} {item.name} <ChevronRight size={14}/>
              </button>
            ))}
          </nav>

          {uiMode === 'Avançada' && <div className="advanced-box">
            <div className="section-title">Visão avançada</div>
            <Metric label="Poder militar" value={entity.military} />
            <Metric label="Estabilidade" value={entity.stability} />
            <Metric label="Tecnologia" value={entity.technology} />
            <div className="micro-copy">Cultura/identidade: {entity.culture}</div>
          </div>}
        </aside>

        <section className="map-stage">
          <div className="map-toolbar panel-floating">
            {(['Político', 'Economia', 'População', 'Militar', 'Tecnologia'] as MapMode[]).map((mode) => <button key={mode} onClick={() => setMapMode(mode)} className={mapMode === mode ? 'active' : ''}>{mode}</button>)}
          </div>

          <div className="world-map panel">
            <div className="world-title"><Map size={16}/> Mapa mundial • {mapMode}</div>
            <WorldMap selectedName={scenario.historicalLayerReady ? entity.name : undefined} onSelectCountry={handleMapCountry} historicalLayerReady={scenario.historicalLayerReady} />
            <div className="entity-chips">
              {scenario.entities.map((item) => <button key={item.id} className={entity.id === item.id ? 'country-chip selected' : 'country-chip'} onClick={() => selectEntity(item)}>{item.name}</button>)}
            </div>
          </div>

          <div className="advance-bar panel">
            <button onClick={() => advanceDays(1, '1 dia')}>+1 dia</button>
            <button onClick={() => advanceDays(7, '1 semana')}>+1 semana</button>
            <button onClick={() => advanceDays(30, '1 mês')}>+1 mês</button>
            <button onClick={() => advanceDays(365, '1 ano')}>+1 ano</button>
            <span>{scenario.subtitle} • {speed === 0 ? 'Pausado' : `${speed}×`}</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="advisor-heading"><Brain size={17}/><div><span>CONSELHEIRO IA</span><strong>Conselho de Estado</strong></div></div>
          <div className="advisor-card"><p>{advisorText}</p><span className="confidence">Conhecimento limitado ao que o Estado poderia razoavelmente saber.</span></div>

          <div className="section-title">{activeSystem}</div>
          <div className="system-focus">
            <strong>{activeSystem} de {entity.name}</strong>
            <p>{systemInfo[activeSystem]}</p>
            {uiMode === 'Avançada' && <div className="detail-grid">
              <span><b>Época</b>{date.year}</span>
              <span><b>Modo</b>Avançado</span>
              <span><b>Confiança</b>Parcial</span>
              <span><b>Tick</b>Contextual</span>
            </div>}
          </div>

          <div className="section-title">Situação mundial</div>
          <div className="event-list">
            <Event tone="neutral" title="Motor territorial" text="Geografia real já está separada das futuras fronteiras políticas temporais." />
            <Event tone="warning" title="Cobertura histórica" text="A base de todas as entidades por época será adicionada por datasets progressivos, sem reduzir o objetivo de cobertura mundial completa." />
            <Event tone="positive" title="Simulação" text="Tempo contínuo e avanço manual já compartilham o mesmo relógio da partida." />
          </div>
        </aside>
      </main>

      <form className="command-bar" onSubmit={submitCommand}>
        <div className="command-label"><Brain size={18}/><span>Conselheiro</span></div>
        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={`Dê uma ordem para ${entity.name} ou pergunte sobre o mundo…`} />
        <button type="submit"><Play size={16}/> Executar</button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><div><span>{label}</span><strong>{value}</strong></div><div className="bar"><i style={{ width: `${value}%` }} /></div></div>; }
function Event({ title, text, tone }: { title: string; text: string; tone: 'neutral' | 'warning' | 'positive' }) { return <div className={`event ${tone}`}><span className="event-dot"/><div><strong>{title}</strong><p>{text}</p></div></div>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
