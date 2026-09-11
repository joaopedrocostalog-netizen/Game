import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brain, ChevronRight, FastForward, Globe2, Landmark, Map, Pause, Play, Settings2, Shield, Sparkles, Swords, TrendingUp, Users, BarChart3, Eye, ScrollText } from 'lucide-react';
import { WorldMap } from './components/WorldMap';
import { SystemDetailPanel } from './components/SystemDetailPanel';
import { DiplomaticInbox } from './components/DiplomaticInbox';
import { WarConsole } from './components/WarConsole';
import { scenarios, type ScenarioEntity } from './data/scenarios';
import { applyDiplomaticAction, applyPlayerDirective, createInitialRuntime, resolveDiplomaticProposal, setPlayerEntity, simulateDays, type GameDate, type ProposalDecision, type SimulationState } from './engine/simulation';
import { createInitialWarState, declareWar, setMobilization, simulateWarDays, type MobilizationLevel, type WarGoal, type WarState } from './engine/war';
import { applyBattleConsequences, createInitialArmyState, ensureEntityForces, simulateArmyToElapsed, type ArmyState } from './engine/army';
import { createInitialTerritorialControlState, type TerritorialControlState } from './engine/territorialControl';
import './styles.css';

type MapMode = 'Político' | 'Economia' | 'População' | 'Militar' | 'Tecnologia';
type UiMode = 'Simples' | 'Avançada';
type SystemName = 'Economia' | 'População' | 'Política' | 'Militar' | 'Diplomacia' | 'Inteligência' | 'Tecnologia' | 'Estatísticas';
type CampaignGlobal = typeof globalThis & { __WORLD_STATE_ARMY_STATE__?: ArmyState; __WORLD_STATE_TERRITORIAL_CONTROL__?: TerritorialControlState };

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

function formatDate(date: GameDate) {
  const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return { dayMonth: `${String(date.day).padStart(2, '0')} ${months[date.month - 1]}`, year: date.year };
}

function genericEntity(name: string): ScenarioEntity {
  return { id: `map-${name.toLowerCase().replace(/\s+/g, '-')}`, name, type: 'Entidade selecionada no mapa', population: 'Dados em integração', treasury: '—', stability: 50, military: 50, technology: 50, culture: 'Dados históricos em integração', government: 'Dados em integração', specialty: 'Perfil histórico ainda será conectado ao banco temporal.' };
}

function makeSimulation(year: number, entities: ScenarioEntity[]) { return createInitialRuntime({ year, month: 1, day: 1 }, entities); }

function App() {
  const [scenarioId, setScenarioId] = useState('2026');
  const scenario = useMemo(() => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0], [scenarioId]);
  const [selectedId, setSelectedId] = useState(scenarios[0].entities[0].id);
  const [mapSelection, setMapSelection] = useState<ScenarioEntity | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('Político');
  const [uiMode, setUiMode] = useState<UiMode>('Simples');
  const [activeSystem, setActiveSystem] = useState<SystemName>('Economia');
  const [speed, setSpeed] = useState(0);
  const [simulation, setSimulation] = useState<SimulationState>(() => makeSimulation(scenarios[0].year, scenarios[0].entities));
  const [warState, setWarState] = useState<WarState>(() => createInitialWarState());
  const [armyState, setArmyState] = useState<ArmyState>(() => createInitialArmyState());
  const [territorialControl, setTerritorialControl] = useState<TerritorialControlState>(() => createInitialTerritorialControlState());
  const [command, setCommand] = useState('');
  const [advisorText, setAdvisorText] = useState('Selecione uma entidade, consulte um sistema ou dê uma ordem. O Conselheiro só usará informações disponíveis ao seu Estado.');

  const seededEntity = useMemo(() => scenario.entities.find((item) => item.id === selectedId), [scenario, selectedId]);
  const entity = mapSelection ?? seededEntity ?? scenario.entities[0];
  const runtime = simulation.entities[entity.id];
  const shownDate = formatDate(simulation.date);
  const entityNames = useMemo(() => Object.fromEntries(scenario.entities.map((item) => [item.id, item.name])), [scenario]);
  const pendingProposals = simulation.proposals.filter((item) => item.toId === entity.id && item.status === 'pending').length;
  const activeWars = warState.wars.filter((war) => war.status === 'active').length;

  useEffect(() => {
    const root = globalThis as CampaignGlobal;
    root.__WORLD_STATE_ARMY_STATE__ = armyState;
    root.__WORLD_STATE_TERRITORIAL_CONTROL__ = territorialControl;
    const markers = armyState.units.filter((unit) => unit.entityId === entity.id).map((unit) => ({ id: unit.id, entityId: unit.entityId, name: unit.name, locationId: unit.locationId, destinationId: unit.destinationId, movementProgress: unit.movementProgress, strength: unit.strength, order: unit.order }));
    window.dispatchEvent(new CustomEvent('world-state-armies', { detail: { entityId: entity.id, markers } }));
    window.dispatchEvent(new CustomEvent('world-state-territorial-control', { detail: territorialControl }));
  }, [armyState, territorialControl, entity.id]);

  function runCampaignStep(days: number) {
    const nextSimulation = simulateDays(simulation, days);
    const activeEntityIds = new Set<string>();
    warState.wars.filter((war) => war.status === 'active').forEach((war) => [...war.attackers, ...war.defenders].forEach((id) => activeEntityIds.add(id)));
    let preparedArmy = ensureEntityForces(armyState, nextSimulation, entity.id, nextSimulation.date.year);
    for (const participantId of activeEntityIds) preparedArmy = ensureEntityForces(preparedArmy, nextSimulation, participantId, nextSimulation.date.year);
    preparedArmy = simulateArmyToElapsed(preparedArmy, nextSimulation, activeEntityIds, territorialControl);
    const root = globalThis as CampaignGlobal;
    root.__WORLD_STATE_ARMY_STATE__ = preparedArmy;
    root.__WORLD_STATE_TERRITORIAL_CONTROL__ = territorialControl;
    const nextWarState = simulateWarDays(warState, nextSimulation, days);
    const nextTerritorialControl = root.__WORLD_STATE_TERRITORIAL_CONTROL__ ?? territorialControl;
    const battleArmy = applyBattleConsequences(preparedArmy, nextWarState, nextSimulation, nextTerritorialControl, days);
    root.__WORLD_STATE_ARMY_STATE__ = battleArmy;
    setSimulation(nextSimulation);
    setWarState(nextWarState);
    setTerritorialControl(nextTerritorialControl);
    setArmyState(battleArmy);
  }

  useEffect(() => {
    if (speed === 0) return;
    const timer = window.setTimeout(() => runCampaignStep(1), Math.max(100, 900 / speed));
    return () => window.clearTimeout(timer);
  }, [speed, simulation, warState, armyState, territorialControl]);

  function changeScenario(id: string) {
    const next = scenarios.find((item) => item.id === id) ?? scenarios[0];
    const nextControl = createInitialTerritorialControlState();
    const nextArmy = createInitialArmyState();
    setScenarioId(next.id); setSelectedId(next.entities[0].id); setMapSelection(null); setSimulation(makeSimulation(next.year, next.entities)); setWarState(createInitialWarState()); setArmyState(nextArmy); setTerritorialControl(nextControl); setSpeed(0);
    setAdvisorText(`Cenário ${next.label} carregado. ${next.historicalLayerReady ? 'A geografia política contemporânea está disponível.' : 'Locations históricas já podem representar entidades do período; as fronteiras completas continuam sendo expandidas sem reutilizar limites modernos.'}`);
  }

  function advanceDays(days: number, label: string) { runCampaignStep(days); setAdvisorText(`Tempo avançado em ${label}. O motor executou ticks econômicos, estratégicos, diplomáticos, logísticos e militares.`); }

  function handleMapCountry(name: string) {
    if (!scenario.historicalLayerReady) { setAdvisorText(`A forma moderna de ${name} pertence apenas à geografia-base. Em ${scenario.year}, use os marcadores históricos temporais para selecionar entidades já integradas sem assumir fronteiras contemporâneas.`); return; }
    const known = scenario.entities.find((item) => item.name.toLowerCase() === name.toLowerCase());
    setMapSelection(known ?? genericEntity(name));
    if (known) { setSelectedId(known.id); setSimulation((state) => setPlayerEntity(state, known.id)); }
  }

  function handleTerritory(entityId: string, locationName: string) {
    const known = scenario.entities.find((item) => item.id === entityId);
    if (!known) { setAdvisorText(`${locationName} possui vínculo territorial registrado, mas a entidade proprietária ainda não tem perfil completo neste cenário.`); return; }
    setSelectedId(known.id); setMapSelection(null); setSimulation((state) => setPlayerEntity(state, known.id));
    setAdvisorText(`${locationName} selecionada. ${known.name} agora é a entidade controlada pelo jogador; sua IA autônoma foi suspensa.`);
  }

  function selectEntity(item: ScenarioEntity) { setSelectedId(item.id); setMapSelection(null); setSimulation((state) => setPlayerEntity(state, item.id)); setAdvisorText(`${item.name} selecionado como entidade controlada. Diferencial inicial: ${item.specialty}.`); }
  function selectSystem(name: SystemName) { setActiveSystem(name); setAdvisorText(`${name} aberto para ${entity.name}. ${systemInfo[name]}`); }
  function handleDiplomaticAction(targetId: string, message: string) { const target = scenario.entities.find((item) => item.id === targetId); setSimulation((state) => applyDiplomaticAction(state, entity.id, targetId, message)); setAdvisorText(`Mensagem diplomática enviada de ${entity.name} para ${target?.name ?? targetId}. A negociação altera relação, confiança, memória e tratados da campanha.`); }
  function handleProposalDecision(proposalId: string, decision: ProposalDecision, counterText?: string) { const proposal = simulation.proposals.find((item) => item.id === proposalId); const fromName = proposal ? (entityNames[proposal.fromId] ?? proposal.fromId) : 'a outra parte'; setSimulation((state) => resolveDiplomaticProposal(state, proposalId, decision, counterText)); setAdvisorText(decision === 'accept' ? `A proposta de ${fromName} foi aceita.` : decision === 'reject' ? `A proposta de ${fromName} foi recusada.` : `Uma contraproposta foi enviada a ${fromName}.`); }
  function handleMobilization(level: MobilizationLevel) { setWarState((state) => setMobilization(state, entity.id, level)); setAdvisorText(`${entity.name} alterou sua postura de mobilização.`); }

  function handleDeclareWar(targetId: string, goal: WarGoal) {
    const target = scenario.entities.find((item) => item.id === targetId);
    const result = declareWar(warState, simulation, entity.id, targetId, goal);
    setWarState(result.state);
    if (result.error) setAdvisorText(`A guerra não foi iniciada: ${result.message}`);
    else {
      let nextArmy = ensureEntityForces(armyState, simulation, entity.id, simulation.date.year);
      nextArmy = ensureEntityForces(nextArmy, simulation, targetId, simulation.date.year);
      setArmyState(nextArmy);
      setMapMode('Militar');
      setAdvisorText(`${entity.name} declarou guerra a ${target?.name ?? targetId}. ${result.message} As formações podem ser redistribuídas manualmente entre frentes e a IA ajustará as demais conforme a prioridade.`);
    }
  }

  function submitCommand(event: React.FormEvent) { event.preventDefault(); const trimmed = command.trim(); if (!trimmed) return; if (runtime) { setSimulation((state) => applyPlayerDirective(state, entity.id, trimmed)); setAdvisorText(`Diretriz aplicada ao motor de ${entity.name}: “${trimmed}”.`); } else setAdvisorText(`A ordem “${trimmed}” foi registrada, mas ${entity.name} ainda não possui perfil de simulação conectado.`); setCommand(''); }

  const systems: { name: SystemName; icon: React.ReactNode }[] = [
    { name: 'Economia', icon: <TrendingUp size={16}/> }, { name: 'População', icon: <Users size={16}/> }, { name: 'Política', icon: <Landmark size={16}/> }, { name: 'Militar', icon: <Swords size={16}/> }, { name: 'Diplomacia', icon: <Shield size={16}/> }, { name: 'Inteligência', icon: <Eye size={16}/> }, { name: 'Tecnologia', icon: <Sparkles size={16}/> }, { name: 'Estatísticas', icon: <BarChart3 size={16}/> },
  ];

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Globe2 size={19}/></div><div><strong>WORLD STATE</strong><span>Grand Strategy Simulator • alpha 0.11</span></div></div><div className="time-center"><button className={speed === 0 ? 'icon-button active' : 'icon-button'} onClick={() => setSpeed(0)} aria-label="Pausar"><Pause size={16}/></button>{[1,2,4,8].map((value) => <button key={value} className={speed === value ? 'speed active' : 'speed'} onClick={() => setSpeed(value)}>{value}×</button>)}<div className="date-pill"><span>{shownDate.dayMonth}</span><strong>{shownDate.year}</strong></div><button className="icon-button" onClick={() => advanceDays(30,'30 dias')} aria-label="Avançar 30 dias"><FastForward size={16}/></button></div><div className="top-actions"><select className="scenario-select" value={scenarioId} onChange={(event) => changeScenario(event.target.value)}>{scenarios.map((item) => <option value={item.id} key={item.id}>{item.label} — {item.year}</option>)}</select><button className="mode-toggle" onClick={() => setUiMode((mode) => mode === 'Simples' ? 'Avançada' : 'Simples')}><Settings2 size={15}/> {uiMode}</button></div></header>
    <main className="workspace">
      <aside className="left-panel panel"><div className="eyebrow">ENTIDADE CONTROLADA</div><h1>{entity.name}</h1><div className="entity-meta">{entity.type} • {entity.government}</div><div className="specialty">{entity.specialty}</div><div className="stat-grid"><Stat label="População" value={entity.population}/><Stat label="Tesouro" value={runtime ? `${runtime.treasuryIndex.toFixed(1)} idx` : entity.treasury}/><Stat label="Estabilidade" value={`${(runtime?.stability ?? entity.stability).toFixed(1)}%`}/><Stat label="Tecnologia" value={`${(runtime?.technology ?? entity.technology).toFixed(1)}`}/></div><div className="section-title">Sistemas</div><nav className="side-nav">{systems.map((item) => <button key={item.name} className={activeSystem === item.name ? 'nav-active' : ''} onClick={() => selectSystem(item.name)}>{item.icon} {item.name} <ChevronRight size={14}/></button>)}</nav>{uiMode === 'Avançada' && <div className="advanced-box"><div className="section-title">Estado da simulação</div><Metric label="Economia" value={runtime?.economyIndex ?? 50}/><Metric label="Prontidão militar" value={runtime?.militaryReadiness ?? entity.military}/><Metric label="Estabilidade" value={runtime?.stability ?? entity.stability}/><Metric label="Tecnologia" value={runtime?.technology ?? entity.technology}/><Metric label="Tesouro" value={runtime?.treasuryIndex ?? 50}/><div className="micro-copy">Cultura/identidade: {entity.culture}</div></div>}</aside>
      <section className="map-stage"><div className="map-toolbar panel-floating">{(['Político','Economia','População','Militar','Tecnologia'] as MapMode[]).map((mode) => <button key={mode} onClick={() => setMapMode(mode)} className={mapMode === mode ? 'active' : ''}>{mode}</button>)}</div><div className="world-map panel"><div className="world-title"><Map size={16}/> Mapa mundial • {mapMode}</div><WorldMap selectedName={scenario.historicalLayerReady ? entity.name : undefined} selectedEntityId={entity.id} year={simulation.date.year} entityNames={entityNames} onSelectCountry={handleMapCountry} onSelectTerritory={handleTerritory} historicalLayerReady={scenario.historicalLayerReady}/><div className="entity-chips">{scenario.entities.map((item) => <button key={item.id} className={entity.id === item.id ? 'country-chip selected' : 'country-chip'} onClick={() => selectEntity(item)}>{item.name}</button>)}</div></div><div className="advance-bar panel"><button onClick={() => advanceDays(1,'1 dia')}>+1 dia</button><button onClick={() => advanceDays(7,'1 semana')}>+1 semana</button><button onClick={() => advanceDays(30,'1 mês')}>+1 mês</button><button onClick={() => advanceDays(365,'1 ano')}>+1 ano</button><span>{scenario.subtitle} • {speed === 0 ? 'Pausado' : `${speed}×`} • tick #{simulation.elapsedDays} • guerras {activeWars} • formações {armyState.units.length}</span></div></section>
      <aside className="right-panel panel"><div className="advisor-heading"><Brain size={17}/><div><span>CONSELHEIRO IA</span><strong>Conselho de Estado</strong></div></div><div className="advisor-card"><p>{advisorText}</p><span className="confidence">Conhecimento limitado ao que o Estado poderia razoavelmente saber.</span></div>{(pendingProposals > 0 || activeSystem === 'Diplomacia') && <DiplomaticInbox proposals={simulation.proposals} entityId={entity.id} entityNames={entityNames} onResolve={handleProposalDecision}/>}<div className="section-title">{activeSystem}</div><div className="system-focus"><strong>{activeSystem} de {entity.name}</strong><p>{systemInfo[activeSystem]}</p>{runtime && <SystemSnapshot activeSystem={activeSystem} runtime={runtime}/>} {uiMode === 'Avançada' && <SystemDetailPanel system={activeSystem} entityId={entity.id} entityName={entity.name} year={simulation.date.year} runtime={runtime} allRuntimes={simulation.entities} diplomacy={simulation.diplomacy} treaties={simulation.treaties} onDiplomaticAction={handleDiplomaticAction}/>} {activeSystem === 'Militar' && <WarConsole entityId={entity.id} entities={scenario.entities} simulation={simulation} warState={warState} armyState={armyState} territorialControl={territorialControl} onArmyStateChange={setArmyState} onWarStateChange={setWarState} onMobilize={handleMobilization} onDeclareWar={handleDeclareWar}/>} {uiMode === 'Avançada' && <div className="detail-grid"><span><b>Época</b>{simulation.date.year}</span><span><b>Modo</b>Avançado</span><span><b>Tratados</b>{simulation.treaties.filter((item) => item.active).length}</span><span><b>Guerras</b>{activeWars}</span></div>}</div><div className="section-title history-title"><ScrollText size={12}/> História recente</div><div className="history-feed">{simulation.events.length === 0 ? <div className="empty-history">Nenhum acontecimento registrado ainda.</div> : simulation.events.slice(0,6).map((item) => <div className="history-item" key={item.id}><span>{String(item.date.day).padStart(2,'0')}/{String(item.date.month).padStart(2,'0')}/{item.date.year}</span><strong>{item.title}</strong><p>{item.text}</p></div>)}</div></aside>
    </main>
    <form className="command-bar" onSubmit={submitCommand}><div className="command-label"><Brain size={18}/><span>Conselheiro</span></div><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={`Dê uma ordem para ${entity.name} ou pergunte sobre o mundo…`}/><button type="submit"><Play size={16}/> Executar</button></form>
  </div>;
}

function SystemSnapshot({ activeSystem, runtime }: { activeSystem: SystemName; runtime: SimulationState['entities'][string] }) {
  const values: Record<SystemName, Array<[string, number]>> = { Economia: [['Atividade',runtime.economyIndex],['Tesouro',runtime.treasuryIndex],['Estabilidade econômica',(runtime.economyIndex+runtime.stability)/2]], População: [['Bem-estar demográfico',runtime.populationIndex],['Estabilidade social',runtime.stability],['Capacidade econômica',runtime.economyIndex]], Política: [['Estabilidade',runtime.stability],['Capacidade fiscal',runtime.treasuryIndex],['Pressão econômica',runtime.economyIndex]], Militar: [['Prontidão',runtime.militaryReadiness],['Sustentação fiscal',runtime.treasuryIndex],['Base tecnológica',runtime.technology]], Diplomacia: [['Capacidade material',(runtime.economyIndex+runtime.militaryReadiness)/2],['Estabilidade',runtime.stability],['Tecnologia',runtime.technology]], Inteligência: [['Capacidade tecnológica',runtime.technology],['Recursos',runtime.treasuryIndex],['Estabilidade interna',runtime.stability]], Tecnologia: [['Conhecimento',runtime.technology],['Base econômica',runtime.economyIndex],['Capacidade fiscal',runtime.treasuryIndex]], Estatísticas: [['Economia',runtime.economyIndex],['Militar',runtime.militaryReadiness],['Tecnologia',runtime.technology]] };
  return <div className="snapshot-list">{values[activeSystem].map(([label,value]) => <div key={label}><span>{label}</span><b>{value.toFixed(1)}</b><i><em style={{ width: `${Math.max(2,Math.min(100,value))}%` }}/></i></div>)}</div>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><div><span>{label}</span><strong>{value.toFixed(1)}</strong></div><div className="bar"><i style={{ width: `${Math.max(0,Math.min(100,value))}%` }}/></div></div>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);