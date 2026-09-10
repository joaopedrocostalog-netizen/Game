import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brain, ChevronRight, FastForward, Globe2, Landmark, Map, Pause, Play, Settings2, Shield, Sparkles, Swords, TrendingUp } from 'lucide-react';
import './styles.css';

type MapMode = 'Político' | 'Economia' | 'População' | 'Militar' | 'Tecnologia';
type UiMode = 'Simples' | 'Avançada';

type Entity = {
  id: string;
  name: string;
  type: string;
  population: string;
  treasury: string;
  stability: number;
  military: number;
  technology: number;
  culture: string;
  government: string;
};

const entities: Entity[] = [
  { id: 'portugal', name: 'Portugal', type: 'Reino', population: '1,1 mi', treasury: '82', stability: 74, military: 61, technology: 72, culture: 'Portuguesa', government: 'Monarquia' },
  { id: 'castela', name: 'Coroa de Castela', type: 'Reino', population: '5,3 mi', treasury: '126', stability: 68, military: 79, technology: 69, culture: 'Castelhana', government: 'Monarquia' },
  { id: 'ottoman', name: 'Império Otomano', type: 'Império', population: '11,0 mi', treasury: '154', stability: 77, military: 90, technology: 74, culture: 'Otomana', government: 'Monarquia imperial' },
  { id: 'ming', name: 'Império Ming', type: 'Império', population: '103 mi', treasury: '221', stability: 71, military: 85, technology: 81, culture: 'Han e outras', government: 'Monarquia imperial' },
  { id: 'venice', name: 'República de Veneza', type: 'República', population: '1,5 mi', treasury: '118', stability: 83, military: 58, technology: 78, culture: 'Veneziana', government: 'República mercantil' },
];

function App() {
  const [selectedId, setSelectedId] = useState('portugal');
  const [mapMode, setMapMode] = useState<MapMode>('Político');
  const [uiMode, setUiMode] = useState<UiMode>('Simples');
  const [speed, setSpeed] = useState(0);
  const [year, setYear] = useState(1500);
  const [command, setCommand] = useState('');
  const [advisorText, setAdvisorText] = useState('A situação está estável. Nossa maior vantagem inicial é marítima, mas nossa população e capacidade terrestre são limitadas.');

  const entity = useMemo(() => entities.find((item) => item.id === selectedId) ?? entities[0], [selectedId]);

  function advance(amount: number) {
    setYear((value) => value + amount);
    setAdvisorText(`O tempo avançou para ${year + amount}. Os sistemas econômicos, diplomáticos e populacionais serão recalculados por ticks conforme a simulação for conectada.`);
  }

  function submitCommand(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    setAdvisorText(`Ordem recebida: “${trimmed}”. Nesta versão inicial, o Conselheiro registra a intenção. A próxima etapa conectará a interpretação ao motor de simulação e às ações válidas da época.`);
    setCommand('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Globe2 size={19} /></div>
          <div>
            <strong>WORLD STATE</strong>
            <span>Grand Strategy Simulator</span>
          </div>
        </div>

        <div className="time-center">
          <button className={speed === 0 ? 'icon-button active' : 'icon-button'} onClick={() => setSpeed(0)} aria-label="Pausar"><Pause size={16} /></button>
          {[1, 2, 4, 8].map((value) => (
            <button key={value} className={speed === value ? 'speed active' : 'speed'} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
          <div className="date-pill"><span>01 JAN</span><strong>{year}</strong></div>
          <button className="icon-button" onClick={() => advance(1)} aria-label="Avançar um ano"><FastForward size={16} /></button>
        </div>

        <div className="top-actions">
          <button className="mode-toggle" onClick={() => setUiMode((m) => m === 'Simples' ? 'Avançada' : 'Simples')}><Settings2 size={15} /> {uiMode}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel panel">
          <div className="eyebrow">ENTIDADE ATIVA</div>
          <h1>{entity.name}</h1>
          <div className="entity-meta">{entity.type} • {entity.government}</div>

          <div className="stat-grid">
            <Stat label="População" value={entity.population} />
            <Stat label="Tesouro" value={entity.treasury} />
            <Stat label="Estabilidade" value={`${entity.stability}%`} />
            <Stat label="Tecnologia" value={`${entity.technology}`} />
          </div>

          <div className="section-title">Sistemas</div>
          <nav className="side-nav">
            <button><TrendingUp size={16}/> Economia <ChevronRight size={14}/></button>
            <button><Landmark size={16}/> Política <ChevronRight size={14}/></button>
            <button><Swords size={16}/> Militar <ChevronRight size={14}/></button>
            <button><Shield size={16}/> Diplomacia <ChevronRight size={14}/></button>
            <button><Sparkles size={16}/> Tecnologia <ChevronRight size={14}/></button>
          </nav>

          {uiMode === 'Avançada' && (
            <div className="advanced-box">
              <div className="section-title">Visão avançada</div>
              <Metric label="Poder militar" value={entity.military} />
              <Metric label="Estabilidade" value={entity.stability} />
              <Metric label="Tecnologia" value={entity.technology} />
              <div className="micro-copy">Cultura predominante: {entity.culture}</div>
            </div>
          )}
        </aside>

        <section className="map-stage">
          <div className="map-toolbar panel-floating">
            {(['Político', 'Economia', 'População', 'Militar', 'Tecnologia'] as MapMode[]).map((mode) => (
              <button key={mode} onClick={() => setMapMode(mode)} className={mapMode === mode ? 'active' : ''}>{mode}</button>
            ))}
          </div>

          <div className="world-map panel">
            <div className="map-bg-grid" />
            <div className="world-title"><Map size={16}/> Mapa mundial • {mapMode}</div>
            <div className="continents" aria-label="Mapa estilizado provisório do mundo">
              <div className="continent americas" />
              <div className="continent europe" />
              <div className="continent africa" />
              <div className="continent asia" />
              <div className="continent oceania" />
            </div>
            <div className="map-note">Mapa vetorial provisório da v0.1. A próxima etapa substituirá esta composição por geografia real e fronteiras históricas temporais.</div>
            <div className="entity-chips">
              {entities.map((item) => (
                <button key={item.id} className={selectedId === item.id ? 'country-chip selected' : 'country-chip'} onClick={() => setSelectedId(item.id)}>{item.name}</button>
              ))}
            </div>
          </div>

          <div className="advance-bar panel">
            <button onClick={() => advance(1)}>+1 ano</button>
            <button onClick={() => advance(5)}>+5 anos</button>
            <button onClick={() => advance(10)}>+10 anos</button>
            <span>Velocidade: {speed === 0 ? 'Pausado' : `${speed}×`}</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="advisor-heading"><Brain size={17}/><div><span>CONSELHEIRO IA</span><strong>Conselho da Coroa</strong></div></div>
          <div className="advisor-card">
            <p>{advisorText}</p>
            <span className="confidence">Informação baseada apenas no conhecimento disponível ao Estado</span>
          </div>

          <div className="section-title">Situação mundial</div>
          <div className="event-list">
            <Event tone="neutral" title="Rotas marítimas" text="Exploração e comércio oceânico estão ganhando importância." />
            <Event tone="warning" title="Rivalidades europeias" text="As potências regionais acompanham movimentos umas das outras." />
            <Event tone="positive" title="Conhecimento" text="Contato estrangeiro poderá acelerar a difusão tecnológica." />
          </div>
        </aside>
      </main>

      <form className="command-bar" onSubmit={submitCommand}>
        <div className="command-label"><Brain size={18}/><span>Conselheiro</span></div>
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Dê uma ordem ou pergunte sobre o reino..." />
        <button type="submit"><Play size={16}/> Executar</button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><div><span>{label}</span><strong>{value}</strong></div><div className="bar"><i style={{ width: `${value}%` }} /></div></div>;
}

function Event({ title, text, tone }: { title: string; text: string; tone: 'neutral' | 'warning' | 'positive' }) {
  return <div className={`event ${tone}`}><span className="event-dot"/><div><strong>{title}</strong><p>{text}</p></div></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
