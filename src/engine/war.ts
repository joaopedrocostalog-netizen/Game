import type { GameDate, SimulationState } from './simulation';

export type MobilizationLevel = 'none' | 'partial' | 'general';
export type WarGoal = 'territory' | 'reparations' | 'regime' | 'independence' | 'defense';
export type WarStatus = 'active' | 'ended';

export type FrontState = {
  id: string;
  name: string;
  progress: number;
  intensity: number;
};

export type War = {
  id: string;
  name: string;
  attackerId: string;
  defenderId: string;
  attackers: string[];
  defenders: string[];
  goal: WarGoal;
  startedAt: GameDate;
  status: WarStatus;
  score: number;
  attackerSupport: number;
  defenderSupport: number;
  attackerLosses: number;
  defenderLosses: number;
  elapsedDays: number;
  fronts: FrontState[];
  victor?: 'attackers' | 'defenders' | 'stalemate';
};

export type WarState = {
  wars: War[];
  mobilization: Record<string, MobilizationLevel>;
};

export type WarActionResult = {
  state: WarState;
  error?: string;
  message: string;
};

export function createInitialWarState(): WarState {
  return { wars: [], mobilization: {} };
}

export function mobilizationMultiplier(level: MobilizationLevel | undefined) {
  if (level === 'general') return 1.2;
  if (level === 'partial') return 1.08;
  return 0.92;
}

export function setMobilization(state: WarState, entityId: string, level: MobilizationLevel): WarState {
  return { ...state, mobilization: { ...state.mobilization, [entityId]: level } };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pairActive(state: WarState, a: string, b: string) {
  return state.wars.some((war) => war.status === 'active' && ((war.attackers.includes(a) && war.defenders.includes(b)) || (war.attackers.includes(b) && war.defenders.includes(a))));
}

function alliancePartners(simulation: SimulationState, entityId: string, enemyId: string) {
  const partners = new Set<string>();
  for (const treaty of simulation.treaties) {
    if (!treaty.active || treaty.type !== 'alliance' || !treaty.parties.includes(entityId)) continue;
    const other = treaty.parties[0] === entityId ? treaty.parties[1] : treaty.parties[0];
    if (other !== enemyId) partners.add(other);
  }
  return [...partners];
}

function coalitionPower(simulation: SimulationState, warState: WarState, members: string[]) {
  if (!members.length) return 0;
  return members.reduce((sum, id) => {
    const runtime = simulation.entities[id];
    if (!runtime) return sum;
    const mobilization = mobilizationMultiplier(warState.mobilization[id]);
    const base = runtime.militaryReadiness * 0.46 + runtime.technology * 0.22 + runtime.treasuryIndex * 0.18 + runtime.stability * 0.14;
    return sum + base * mobilization;
  }, 0);
}

export function declareWar(
  state: WarState,
  simulation: SimulationState,
  attackerId: string,
  defenderId: string,
  goal: WarGoal,
): WarActionResult {
  if (!attackerId || !defenderId || attackerId === defenderId) return { state, error: 'invalid-target', message: 'Selecione uma entidade estrangeira válida.' };
  if (!simulation.entities[attackerId] || !simulation.entities[defenderId]) return { state, error: 'missing-runtime', message: 'Uma das entidades ainda não possui perfil de simulação ativo.' };
  if (pairActive(state, attackerId, defenderId)) return { state, error: 'already-at-war', message: 'Essas entidades já estão em guerra.' };
  if (simulation.entities[attackerId].militaryReadiness < 28) return { state, error: 'low-readiness', message: 'A prontidão militar é baixa demais para iniciar uma guerra organizada.' };

  const attackers = [attackerId, ...alliancePartners(simulation, attackerId, defenderId)];
  const defenders = [defenderId, ...alliancePartners(simulation, defenderId, attackerId)].filter((id) => !attackers.includes(id));
  const id = `war-${attackerId}-${defenderId}-${simulation.date.year}-${simulation.date.month}-${simulation.elapsedDays}`;
  const war: War = {
    id,
    name: `${attackerId} × ${defenderId}`,
    attackerId,
    defenderId,
    attackers,
    defenders,
    goal,
    startedAt: simulation.date,
    status: 'active',
    score: 0,
    attackerSupport: 100,
    defenderSupport: 100,
    attackerLosses: 0,
    defenderLosses: 0,
    elapsedDays: 0,
    fronts: [{ id: `${id}-front-1`, name: 'Frente principal', progress: 50, intensity: 42 }],
  };

  const mobilization = { ...state.mobilization };
  mobilization[attackerId] = mobilization[attackerId] === 'general' ? 'general' : 'partial';
  mobilization[defenderId] = 'general';
  return {
    state: { ...state, wars: [war, ...state.wars], mobilization },
    message: `Guerra declarada. ${attackers.length - 1} aliado(s) apoiam o atacante e ${defenders.length - 1} aliado(s) apoiam o defensor.`,
  };
}

function dailyNoise(war: War, simulation: SimulationState) {
  const seed = `${war.id}:${simulation.date.year}:${simulation.date.month}:${simulation.date.day}:${war.elapsedDays}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

export function simulateWarDays(state: WarState, simulation: SimulationState, days: number): WarState {
  if (days <= 0 || !state.wars.some((war) => war.status === 'active')) return state;
  const wars = state.wars.map((war) => {
    if (war.status !== 'active') return war;

    const attackerPower = coalitionPower(simulation, state, war.attackers);
    const defenderPower = coalitionPower(simulation, state, war.defenders);
    const total = Math.max(1, attackerPower + defenderPower);
    const edge = (attackerPower - defenderPower) / total;
    const random = dailyNoise(war, simulation);
    const scoreDelta = (edge * 1.8 + random * 0.22) * Math.max(1, days / 7);
    const intensity = clamp(44 + Math.abs(edge) * 32 + random * 10, 20, 95);
    const attackerLossDelta = Math.max(0, (defenderPower / Math.max(1, attackerPower)) * intensity * days * 0.012);
    const defenderLossDelta = Math.max(0, (attackerPower / Math.max(1, defenderPower)) * intensity * days * 0.012);
    const attackerSupport = clamp(war.attackerSupport - days * (0.018 + attackerLossDelta * 0.0008), 0, 100);
    const defenderSupport = clamp(war.defenderSupport - days * (0.018 + defenderLossDelta * 0.0008), 0, 100);
    const score = clamp(war.score + scoreDelta, -100, 100);
    const progress = clamp(50 + score * 0.48, 2, 98);

    let status: WarStatus = 'active';
    let victor: War['victor'];
    if (score >= 92 || defenderSupport <= 5) { status = 'ended'; victor = 'attackers'; }
    else if (score <= -92 || attackerSupport <= 5) { status = 'ended'; victor = 'defenders'; }
    else if (war.elapsedDays + days >= 3650 && Math.abs(score) < 25) { status = 'ended'; victor = 'stalemate'; }

    return {
      ...war,
      score,
      attackerSupport,
      defenderSupport,
      attackerLosses: war.attackerLosses + attackerLossDelta,
      defenderLosses: war.defenderLosses + defenderLossDelta,
      elapsedDays: war.elapsedDays + days,
      status,
      victor,
      fronts: war.fronts.map((front) => ({ ...front, progress, intensity })),
    };
  });
  return { ...state, wars };
}

export function warsForEntity(state: WarState, entityId: string) {
  return state.wars.filter((war) => war.attackers.includes(entityId) || war.defenders.includes(entityId));
}
