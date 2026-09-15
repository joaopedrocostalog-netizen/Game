import { multilateralSanctionsState } from './multilateralSanctions';
import { pairKey, type SimulationState, type WorldEvent } from './simulation';

export type EvasionStrategy = 'domestic-substitution' | 'alternate-partners' | 'neutral-intermediaries';
export type EvasionStatus = 'building' | 'active' | 'exposed' | 'collapsed';

export type SanctionsEvasionNetwork = {
  id: string;
  regimeId: string;
  targetId: string;
  strategy: EvasionStrategy;
  intermediaryId?: string;
  status: EvasionStatus;
  resilience: number;
  relief: number;
  cost: number;
  exposureRisk: number;
  enforcementPressure: number;
  startedAtElapsedDay: number;
  lastProcessedElapsedDay: number;
};

export type SanctionsEvasionState = {
  networks: SanctionsEvasionNetwork[];
  lastProcessedElapsedDay: number;
};

type Root = typeof globalThis & { __WORLD_STATE_SANCTIONS_EVASION__?: SanctionsEvasionState };

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function rootState(): SanctionsEvasionState {
  const root = globalThis as Root;
  if (!root.__WORLD_STATE_SANCTIONS_EVASION__) root.__WORLD_STATE_SANCTIONS_EVASION__ = { networks: [], lastProcessedElapsedDay: 0 };
  return root.__WORLD_STATE_SANCTIONS_EVASION__;
}
function publish(state: SanctionsEvasionState) {
  (globalThis as Root).__WORLD_STATE_SANCTIONS_EVASION__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-sanctions-evasion', { detail: state }));
}
export function resetSanctionsEvasion() { publish({ networks: [], lastProcessedElapsedDay: 0 }); }
export function sanctionsEvasionState() { const state = rootState(); return { ...state, networks: state.networks.map((item) => ({ ...item })) }; }

function worldEvent(simulation: SimulationState, entityId: string, title: string, text: string): WorldEvent {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return { id: `sanctions-evasion-${entityId}-${simulation.elapsedDays}-${slug}`, date: simulation.date, entityId, category: 'economy', title, text };
}
function relation(simulation: SimulationState, a: string, b: string) { return simulation.diplomacy[pairKey(a, b)]; }
function mutateRelation(simulation: SimulationState, a: string, b: string, score: number, trust: number, threat: number, memory: string) {
  const key = pairKey(a, b); const current = simulation.diplomacy[key];
  if (!current) return simulation;
  return { ...simulation, diplomacy: { ...simulation.diplomacy, [key]: { ...current, score: clamp(current.score + score, -100, 100), trust: clamp(current.trust + trust), threat: clamp(current.threat + threat), memory: [memory, ...current.memory].slice(0, 8) } } };
}

function strategyBase(strategy: EvasionStrategy) {
  if (strategy === 'domestic-substitution') return { relief: 20, cost: 24, exposure: 8 };
  if (strategy === 'alternate-partners') return { relief: 30, cost: 15, exposure: 22 };
  return { relief: 38, cost: 18, exposure: 38 };
}

function enforcementFor(regimeId: string) {
  const regime = multilateralSanctionsState().regimes.find((item) => item.id === regimeId && item.status !== 'ended');
  if (!regime) return 100;
  return clamp(regime.marketIsolation * .58 + regime.cohesion * .28 + regime.legitimacy * .14);
}

function chooseIntermediary(targetId: string, regimeId: string, simulation: SimulationState) {
  const regime = multilateralSanctionsState().regimes.find((item) => item.id === regimeId);
  if (!regime) return undefined;
  return Object.keys(simulation.entities)
    .filter((id) => id !== targetId && id !== regime.sponsorId && !regime.memberIds.includes(id))
    .sort((a, b) => {
      const ar = relation(simulation, targetId, a); const br = relation(simulation, targetId, b);
      const av = (ar?.tradeInterest ?? 0) + (ar?.score ?? 0) * .35 + (simulation.entities[a]?.economyIndex ?? 0) * .25;
      const bv = (br?.tradeInterest ?? 0) + (br?.score ?? 0) * .35 + (simulation.entities[b]?.economyIndex ?? 0) * .25;
      return bv - av;
    })[0];
}

export function startSanctionsEvasion(regimeId: string, targetId: string, strategy: EvasionStrategy, simulation: SimulationState) {
  const regime = multilateralSanctionsState().regimes.find((item) => item.id === regimeId && item.targetId === targetId && item.status !== 'ended');
  if (!regime) return { accepted: false, simulation, message: 'Nenhum regime de sanções ativo foi encontrado para este Estado.' };
  const state = rootState();
  if (state.networks.some((item) => item.regimeId === regimeId && item.targetId === targetId && item.status !== 'collapsed')) return { accepted: false, simulation, message: 'Já existe uma rede de adaptação econômica ativa para este regime.' };
  const base = strategyBase(strategy);
  const intermediaryId = strategy === 'neutral-intermediaries' ? chooseIntermediary(targetId, regimeId, simulation) : undefined;
  const tech = simulation.entities[targetId]?.technology ?? 40;
  const economy = simulation.entities[targetId]?.economyIndex ?? 40;
  const network: SanctionsEvasionNetwork = {
    id: `sanctions-evasion-${regimeId}-${targetId}-${simulation.elapsedDays}`,
    regimeId, targetId, strategy, intermediaryId,
    status: 'building', resilience: clamp(24 + economy * .3 + tech * .18), relief: base.relief * .45,
    cost: base.cost, exposureRisk: base.exposure, enforcementPressure: enforcementFor(regimeId),
    startedAtElapsedDay: simulation.elapsedDays, lastProcessedElapsedDay: simulation.elapsedDays,
  };
  publish({ ...state, networks: [network, ...state.networks].slice(0, 60) });
  let nextSimulation = { ...simulation, events: [worldEvent(simulation, targetId, 'Adaptação ao isolamento econômico', 'O governo iniciou uma estratégia abstrata para reduzir a dependência dos mercados bloqueados. A eficácia dependerá da capacidade doméstica, de parceiros disponíveis e da fiscalização externa.'), ...simulation.events].slice(0, 80) };
  return { accepted: true, simulation: nextSimulation, network, message: 'Estratégia de adaptação iniciada. O alívio crescerá gradualmente, com custo e risco próprios.' };
}

export function sanctionsEvasionRelief(targetId: string) {
  const active = rootState().networks.filter((item) => item.targetId === targetId && (item.status === 'active' || item.status === 'building'));
  if (!active.length) return { relief: 0, cost: 0, exposureRisk: 0 };
  const relief = clamp(active.reduce((sum, item) => sum + item.relief, 0), 0, 62);
  const cost = clamp(active.reduce((sum, item) => sum + item.cost, 0), 0, 70);
  const exposureRisk = clamp(Math.max(...active.map((item) => item.exposureRisk)));
  return { relief, cost, exposureRisk };
}

export function processSanctionsEvasion(simulation: SimulationState) {
  const state = rootState();
  const days = Math.max(0, simulation.elapsedDays - state.lastProcessedElapsedDay);
  if (!days) return { simulation, changed: false };
  let nextSimulation = simulation;
  let changed = false;
  const regimes = multilateralSanctionsState().regimes;
  const networks = state.networks.map((network) => {
    if (network.status === 'collapsed') return network;
    const regime = regimes.find((item) => item.id === network.regimeId && item.status !== 'ended');
    if (!regime) return { ...network, status: 'collapsed' as const, relief: 0, lastProcessedElapsedDay: simulation.elapsedDays };
    const runtime = nextSimulation.entities[network.targetId];
    if (!runtime) return network;
    const base = strategyBase(network.strategy);
    const enforcement = enforcementFor(network.regimeId);
    const maturity = clamp((simulation.elapsedDays - network.startedAtElapsedDay) / 120 * 100);
    const resilience = clamp(network.resilience + days * ((runtime.technology + runtime.economyIndex) / 200) * .08 - days * enforcement / 10000);
    const intermediaryBonus = network.intermediaryId ? Math.max(0, (relation(nextSimulation, network.targetId, network.intermediaryId)?.tradeInterest ?? 0) - 40) * .12 : 0;
    const relief = clamp(base.relief * (0.45 + maturity / 180) + resilience * .18 + intermediaryBonus - enforcement * .22, 3, 58);
    const exposureRisk = clamp(base.exposure + enforcement * .28 + regime.memberIds.length * 2 - runtime.technology * .08);
    let status: EvasionStatus = maturity >= 45 ? 'active' : 'building';
    const deterministicSignal = (simulation.elapsedDays + network.id.length * 17) % 100;
    const exposed = network.strategy !== 'domestic-substitution' && status === 'active' && deterministicSignal < Math.min(18, exposureRisk * .18);
    if (exposed) {
      status = 'exposed';
      const intermediary = network.intermediaryId;
      if (intermediary) {
        for (const memberId of regime.memberIds) nextSimulation = mutateRelation(nextSimulation, memberId, intermediary, -4, -7, 3, 'Foi identificado como facilitador econômico de um Estado sob sanções multilaterais.');
        nextSimulation = { ...nextSimulation, events: [worldEvent(nextSimulation, intermediary, 'Rede econômica paralela descoberta', 'Membros do regime de sanções identificaram apoio econômico indireto ao Estado sancionado. A descoberta gerou pressão diplomática sobre o intermediário.'), ...nextSimulation.events].slice(0, 80) };
      }
      changed = true;
    }
    if (days > 0) {
      const burden = base.cost / 100;
      nextSimulation = { ...nextSimulation, entities: { ...nextSimulation.entities, [runtime.id]: { ...runtime, treasuryIndex: clamp(runtime.treasuryIndex - days * burden * .01), economyIndex: clamp(runtime.economyIndex - days * burden * .0025) } } };
      changed = true;
    }
    return { ...network, status, resilience, relief: status === 'exposed' ? relief * .55 : relief, exposureRisk, enforcementPressure: enforcement, lastProcessedElapsedDay: simulation.elapsedDays };
  });
  publish({ networks, lastProcessedElapsedDay: simulation.elapsedDays });
  return { simulation: nextSimulation, changed };
}

export function sanctionsEvasionNetworksFor(entityId: string) {
  return rootState().networks.filter((item) => item.targetId === entityId || item.intermediaryId === entityId).map((item) => ({ ...item }));
}
