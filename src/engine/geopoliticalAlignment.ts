import type { DiplomaticRelation, SimulationState, Treaty, WorldEvent } from './simulation';

export type GeopoliticalPosture = 'partner' | 'neutral' | 'rival';
export type InfluenceTrend = 'rising' | 'stable' | 'falling';

export type GeopoliticalLink = {
  id: string;
  parties: [string, string];
  posture: GeopoliticalPosture;
  affinity: number;
  hostility: number;
  updatedYear: number;
};

export type SphereLink = {
  id: string;
  patronId: string;
  memberId: string;
  strength: number;
  trend: InfluenceTrend;
  sinceYear: number;
  updatedYear: number;
};

export type GeopoliticalState = {
  lastProcessedYear?: number;
  links: GeopoliticalLink[];
  spheres: SphereLink[];
};

type GeopoliticalGlobal = typeof globalThis & { __WORLD_STATE_GEOPOLITICS__?: GeopoliticalState };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join('::');
}

function rootState(): GeopoliticalState {
  const root = globalThis as GeopoliticalGlobal;
  if (!root.__WORLD_STATE_GEOPOLITICS__) root.__WORLD_STATE_GEOPOLITICS__ = { links: [], spheres: [] };
  return root.__WORLD_STATE_GEOPOLITICS__;
}

function publish(state: GeopoliticalState) {
  (globalThis as GeopoliticalGlobal).__WORLD_STATE_GEOPOLITICS__ = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('world-state-geopolitics', { detail: state }));
}

export function resetGeopoliticalAlignment() {
  publish({ links: [], spheres: [] });
}

export function geopoliticalState() {
  const state = rootState();
  return { ...state, links: [...state.links], spheres: [...state.spheres] };
}

function hasActiveTreaty(simulation: SimulationState, a: string, b: string, type: Treaty['type']) {
  const key = pairKey(a, b);
  return simulation.treaties.some((treaty) => treaty.active && treaty.type === type && pairKey(...treaty.parties) === key);
}

function relationMetrics(simulation: SimulationState, relation: DiplomaticRelation) {
  const [a, b] = relation.parties;
  const alliance = hasActiveTreaty(simulation, a, b, 'alliance');
  const trade = hasActiveTreaty(simulation, a, b, 'trade');
  const technology = hasActiveTreaty(simulation, a, b, 'technology');
  const affinity = clamp(
    48 + relation.score * 0.34 + (relation.trust - 45) * 0.48 - relation.threat * 0.22 +
    (alliance ? 16 : 0) + (trade ? 5 : 0) + (technology ? 4 : 0),
  );
  const hostility = clamp(
    28 + Math.max(0, -relation.score) * 0.46 + relation.threat * 0.48 + Math.max(0, 42 - relation.trust) * 0.42 -
    (alliance ? 10 : 0) - (trade ? 2 : 0),
  );
  const posture: GeopoliticalPosture = hostility >= 68 ? 'rival' : affinity >= 70 ? 'partner' : 'neutral';
  return { affinity, hostility, posture };
}

function statePower(simulation: SimulationState, entityId: string) {
  const runtime = simulation.entities[entityId];
  if (!runtime) return 45;
  return runtime.militaryReadiness * 0.34 + runtime.economyIndex * 0.24 + runtime.technology * 0.2 + runtime.treasuryIndex * 0.12 + runtime.stability * 0.1;
}

function deterministicRoll(seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100;
}

function makeAlliance(simulation: SimulationState, a: string, b: string): SimulationState {
  if (hasActiveTreaty(simulation, a, b, 'alliance')) return simulation;
  const key = pairKey(a, b);
  const relation = simulation.diplomacy[key];
  if (!relation) return simulation;
  const treaty: Treaty = {
    id: `realignment-alliance-${key}-${simulation.date.year}`,
    type: 'alliance',
    parties: [a, b],
    signedAt: simulation.date,
    active: true,
  };
  return {
    ...simulation,
    treaties: [...simulation.treaties, treaty],
    diplomacy: {
      ...simulation.diplomacy,
      [key]: {
        ...relation,
        score: clamp(relation.score + 4, -100, 100),
        trust: clamp(relation.trust + 4),
        treaties: [...relation.treaties, treaty.id],
        memory: ['O alinhamento de longo prazo amadureceu em uma aliança formal.', ...relation.memory].slice(0, 8),
      },
    },
  };
}

function breakAlliance(simulation: SimulationState, a: string, b: string): SimulationState {
  const key = pairKey(a, b);
  const relation = simulation.diplomacy[key];
  let changed = false;
  const treaties = simulation.treaties.map((treaty) => {
    if (treaty.active && treaty.type === 'alliance' && pairKey(...treaty.parties) === key) {
      changed = true;
      return { ...treaty, active: false };
    }
    return treaty;
  });
  if (!changed || !relation) return simulation;
  return {
    ...simulation,
    treaties,
    diplomacy: {
      ...simulation.diplomacy,
      [key]: {
        ...relation,
        score: clamp(relation.score - 5, -100, 100),
        trust: clamp(relation.trust - 8),
        threat: clamp(relation.threat + 4),
        memory: ['A aliança se desfez após deterioração estratégica prolongada.', ...relation.memory].slice(0, 8),
      },
    },
  };
}

function sphereCandidates(simulation: SimulationState, links: GeopoliticalLink[]) {
  const candidates: Array<SphereLink & { score: number }> = [];
  for (const link of links) {
    if (link.affinity < 66 || link.hostility > 45) continue;
    const [a, b] = link.parties;
    const powerA = statePower(simulation, a);
    const powerB = statePower(simulation, b);
    const patronId = powerA >= powerB ? a : b;
    const memberId = patronId === a ? b : a;
    const patronPower = Math.max(powerA, powerB);
    const memberPower = Math.min(powerA, powerB);
    const powerGap = patronPower - memberPower;
    if (powerGap < 10) continue;
    const strength = clamp(25 + powerGap * 1.15 + (link.affinity - 60) * 0.55, 20, 94);
    candidates.push({
      id: `sphere-${patronId}-${memberId}`,
      patronId,
      memberId,
      strength,
      trend: 'stable',
      sinceYear: simulation.date.year,
      updatedYear: simulation.date.year,
      score: strength + patronPower * 0.15,
    });
  }
  const bestByMember = new Map<string, SphereLink & { score: number }>();
  for (const candidate of candidates) {
    const current = bestByMember.get(candidate.memberId);
    if (!current || candidate.score > current.score) bestByMember.set(candidate.memberId, candidate);
  }
  return [...bestByMember.values()];
}

function updateSpheres(simulation: SimulationState, links: GeopoliticalLink[], previous: SphereLink[]) {
  return sphereCandidates(simulation, links).map(({ score: _score, ...candidate }) => {
    const old = previous.find((item) => item.patronId === candidate.patronId && item.memberId === candidate.memberId);
    if (!old) return candidate;
    const delta = candidate.strength - old.strength;
    return {
      ...candidate,
      sinceYear: old.sinceYear,
      trend: delta > 3 ? 'rising' as const : delta < -3 ? 'falling' as const : 'stable' as const,
    };
  });
}

export function runAnnualGeopoliticalRealignment(simulation: SimulationState): SimulationState {
  const prior = rootState();
  if (prior.lastProcessedYear === simulation.date.year) return simulation;

  let next = simulation;
  const links: GeopoliticalLink[] = [];
  const events: WorldEvent[] = [];

  for (const relation of Object.values(next.diplomacy)) {
    const [a, b] = relation.parties;
    const metrics = relationMetrics(next, relation);
    links.push({
      id: `alignment-${pairKey(a, b)}`,
      parties: [a, b],
      posture: metrics.posture,
      affinity: metrics.affinity,
      hostility: metrics.hostility,
      updatedYear: next.date.year,
    });

    const playerInvolved = a === next.playerEntityId || b === next.playerEntityId;
    const alliance = hasActiveTreaty(next, a, b, 'alliance');

    if (!playerInvolved && alliance && metrics.hostility >= 78 && relation.trust < 30) {
      next = breakAlliance(next, a, b);
      events.push({
        id: `realignment-break-${pairKey(a, b)}-${next.date.year}`,
        date: next.date,
        category: 'diplomacy',
        title: 'Realinhamento: aliança dissolvida',
        text: `${a} e ${b} encerraram sua aliança após deterioração prolongada da confiança e aumento da ameaça percebida.`,
      });
      continue;
    }

    if (!playerInvolved && !alliance && metrics.affinity >= 84 && relation.trust >= 67 && relation.threat <= 35) {
      const aiA = next.strategicAI[a];
      const aiB = next.strategicAI[b];
      const openness = ((aiA?.openness ?? 50) + (aiB?.openness ?? 50)) / 2;
      if (openness >= 48 && deterministicRoll(`${a}:${b}:${next.date.year}:realignment`) < Math.min(78, 32 + (metrics.affinity - 80) * 5)) {
        next = makeAlliance(next, a, b);
        events.push({
          id: `realignment-alliance-${pairKey(a, b)}-${next.date.year}`,
          date: next.date,
          category: 'diplomacy',
          title: 'Realinhamento: nova aliança',
          text: `${a} e ${b} converteram anos de aproximação e confiança em uma aliança formal.`,
        });
      }
    }

    const key = pairKey(a, b);
    const current = next.diplomacy[key];
    if (!current) continue;
    const drift = metrics.posture === 'partner' ? 0.7 : metrics.posture === 'rival' ? -0.9 : 0;
    const trustDrift = metrics.posture === 'partner' ? 0.55 : metrics.posture === 'rival' ? -0.6 : 0;
    const threatDrift = metrics.posture === 'rival' ? 0.8 : metrics.posture === 'partner' ? -0.35 : -0.1;
    next = {
      ...next,
      diplomacy: {
        ...next.diplomacy,
        [key]: {
          ...current,
          score: clamp(current.score + drift, -100, 100),
          trust: clamp(current.trust + trustDrift),
          threat: clamp(current.threat + threatDrift),
        },
      },
    };
  }

  const spheres = updateSpheres(next, links, prior.spheres);
  publish({ lastProcessedYear: next.date.year, links, spheres });

  if (events.length) next = { ...next, events: [...events.slice(0, 6), ...next.events].slice(0, 50) };
  return next;
}

export function geopoliticalOutlookForEntity(simulation: SimulationState, entityId: string) {
  const links = Object.values(simulation.diplomacy)
    .filter((relation) => relation.parties.includes(entityId))
    .map((relation) => {
      const otherId = relation.parties[0] === entityId ? relation.parties[1] : relation.parties[0];
      const metrics = relationMetrics(simulation, relation);
      return { otherId, ...metrics };
    });
  const state = rootState();
  return {
    partners: links.filter((item) => item.posture === 'partner').sort((a, b) => b.affinity - a.affinity),
    rivals: links.filter((item) => item.posture === 'rival').sort((a, b) => b.hostility - a.hostility),
    neutral: links.filter((item) => item.posture === 'neutral').sort((a, b) => b.affinity - a.affinity),
    patronage: state.spheres.find((item) => item.memberId === entityId),
    influenced: state.spheres.filter((item) => item.patronId === entityId).sort((a, b) => b.strength - a.strength),
    lastProcessedYear: state.lastProcessedYear,
  };
}
