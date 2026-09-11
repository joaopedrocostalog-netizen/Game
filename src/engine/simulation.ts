import { relationBetween, type RelationState } from '../data/diplomacy';
import type { ScenarioEntity } from '../data/scenarios';

export type GameDate = { year: number; month: number; day: number };

export type EntityRuntime = {
  id: string;
  populationIndex: number;
  economyIndex: number;
  stability: number;
  militaryReadiness: number;
  technology: number;
  treasuryIndex: number;
};

export type TreatyType = 'trade' | 'alliance' | 'technology';
export type Treaty = {
  id: string;
  type: TreatyType;
  parties: [string, string];
  signedAt: GameDate;
  active: boolean;
};

export type DiplomaticRelation = RelationState & {
  parties: [string, string];
  treaties: string[];
};

export type StrategicFocus = 'economy' | 'military' | 'technology' | 'stability' | 'diplomacy';
export type StrategicAIState = {
  entityId: string;
  focus: StrategicFocus;
  aggression: number;
  openness: number;
  riskTolerance: number;
  objective: string;
  reviews: number;
};

export type WorldEvent = {
  id: string;
  date: GameDate;
  entityId?: string;
  category: 'economy' | 'population' | 'politics' | 'military' | 'technology' | 'diplomacy' | 'world';
  title: string;
  text: string;
};

export type SimulationState = {
  date: GameDate;
  entities: Record<string, EntityRuntime>;
  diplomacy: Record<string, DiplomaticRelation>;
  treaties: Treaty[];
  strategicAI: Record<string, StrategicAIState>;
  events: WorldEvent[];
  elapsedDays: number;
};

export function pairKey(a: string, b: string) {
  return [a, b].sort().join('::');
}

export function addDays(date: GameDate, days: number): GameDate {
  const js = new Date(Date.UTC(date.year, date.month - 1, date.day));
  js.setUTCDate(js.getUTCDate() + days);
  return { year: js.getUTCFullYear(), month: js.getUTCMonth() + 1, day: js.getUTCDate() };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function noise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function dateSeed(date: GameDate, entityId: string) {
  return date.year * 372 + date.month * 31 + date.day + [...entityId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function initialFocus(entity: ScenarioEntity): StrategicFocus {
  const text = `${entity.specialty} ${entity.government} ${entity.type}`.toLowerCase();
  if (/comérc|mercant|naval|marít|porto|trade/.test(text)) return 'diplomacy';
  if (/militar|guerra|exército|caval|expans|império/.test(text)) return 'military';
  if (/tecnolog|ciência|engenh|inova|industrial/.test(text)) return 'technology';
  if (entity.stability < 48) return 'stability';
  return 'economy';
}

function objectiveFor(focus: StrategicFocus) {
  if (focus === 'economy') return 'Expandir capacidade econômica e preservar o tesouro';
  if (focus === 'military') return 'Aumentar segurança, prontidão e margem estratégica';
  if (focus === 'technology') return 'Reduzir defasagem e ampliar capacidade tecnológica';
  if (focus === 'stability') return 'Consolidar autoridade e reduzir riscos internos';
  return 'Aprofundar relações úteis e reduzir isolamento estratégico';
}

function buildAIState(entity: ScenarioEntity): StrategicAIState {
  const seed = hash(`${entity.id}:${entity.specialty}:${entity.government}`);
  const focus = initialFocus(entity);
  return {
    entityId: entity.id,
    focus,
    aggression: clamp(22 + entity.military * 0.42 + (seed % 18)),
    openness: clamp(28 + ((seed >> 4) % 45) + (/comérc|diplom|marít/i.test(entity.specialty) ? 14 : 0)),
    riskTolerance: clamp(24 + ((seed >> 9) % 55)),
    objective: objectiveFor(focus),
    reviews: 0,
  };
}

export function createInitialRuntime(date: GameDate, entities: ScenarioEntity[]): SimulationState {
  const runtime: Record<string, EntityRuntime> = {};
  const diplomacy: Record<string, DiplomaticRelation> = {};
  const strategicAI: Record<string, StrategicAIState> = {};

  for (const entity of entities) {
    runtime[entity.id] = {
      id: entity.id,
      populationIndex: 50,
      economyIndex: 50,
      stability: entity.stability,
      militaryReadiness: entity.military,
      technology: entity.technology,
      treasuryIndex: 55,
    };
    strategicAI[entity.id] = buildAIState(entity);
  }

  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      const base = relationBetween(a, b, date.year);
      diplomacy[pairKey(a.id, b.id)] = { ...base, parties: [a.id, b.id], treaties: [] };
    }
  }

  return { date, entities: runtime, diplomacy, treaties: [], strategicAI, events: [], elapsedDays: 0 };
}

function treatyEffects(state: SimulationState, entityId: string) {
  const active = state.treaties.filter((treaty) => treaty.active && treaty.parties.includes(entityId));
  return {
    trade: active.filter((item) => item.type === 'trade').length,
    alliance: active.filter((item) => item.type === 'alliance').length,
    technology: active.filter((item) => item.type === 'technology').length,
  };
}

function chooseFocus(runtime: EntityRuntime, ai: StrategicAIState): StrategicFocus {
  if (runtime.stability < 42) return 'stability';
  if (runtime.treasuryIndex < 40 || runtime.economyIndex < 43) return 'economy';
  if (runtime.technology < 46) return 'technology';
  if (ai.aggression >= 65 && runtime.militaryReadiness < 70) return 'military';
  if (ai.openness >= 62) return 'diplomacy';
  return ai.focus;
}

function relationCandidates(state: SimulationState, entityId: string) {
  return Object.values(state.diplomacy).filter((relation) => relation.parties.includes(entityId));
}

function counterpart(relation: DiplomaticRelation, entityId: string) {
  return relation.parties[0] === entityId ? relation.parties[1] : relation.parties[0];
}

function hasTreaty(state: SimulationState, a: string, b: string, type: TreatyType) {
  const key = pairKey(a, b);
  return state.treaties.some((item) => item.active && item.type === type && pairKey(...item.parties) === key);
}

function signAITreaty(state: SimulationState, relation: DiplomaticRelation, type: TreatyType, date: GameDate) {
  if (hasTreaty(state, relation.parties[0], relation.parties[1], type)) return state;
  const key = pairKey(...relation.parties);
  const treaty: Treaty = {
    id: `ai-${type}-${key}-${date.year}-${date.month}`,
    type,
    parties: relation.parties,
    signedAt: date,
    active: true,
  };
  const updatedRelation: DiplomaticRelation = {
    ...relation,
    treaties: [...relation.treaties, treaty.id],
    memory: [`Acordo ${type} firmado por iniciativa estratégica durante a campanha`, ...relation.memory].slice(0, 8),
    score: clamp(relation.score + 4),
    trust: clamp(relation.trust + 3),
  };
  return {
    ...state,
    treaties: [...state.treaties, treaty],
    diplomacy: { ...state.diplomacy, [key]: updatedRelation },
  };
}

function runStrategicAI(state: SimulationState, date: GameDate): SimulationState {
  let next = state;
  const aiEntries = Object.values(next.strategicAI);
  const generatedEvents: WorldEvent[] = [];

  for (const currentAI of aiEntries) {
    const runtime = next.entities[currentAI.entityId];
    if (!runtime) continue;

    const focus = chooseFocus(runtime, currentAI);
    const ai: StrategicAIState = {
      ...currentAI,
      focus,
      objective: objectiveFor(focus),
      reviews: currentAI.reviews + 1,
    };
    next = { ...next, strategicAI: { ...next.strategicAI, [ai.entityId]: ai } };

    const relations = relationCandidates(next, ai.entityId);
    if (!relations.length) continue;

    if (focus === 'diplomacy' || focus === 'economy') {
      const best = [...relations].sort((a, b) => (b.tradeInterest + b.score * 0.55 + b.trust * 0.3) - (a.tradeInterest + a.score * 0.55 + a.trust * 0.3))[0];
      const other = counterpart(best, ai.entityId);
      if (focus === 'economy' && best.tradeInterest >= 66 && best.score >= 38 && !hasTreaty(next, ai.entityId, other, 'trade')) {
        next = signAITreaty(next, best, 'trade', date);
        generatedEvents.push({
          id: `ai-trade-${ai.entityId}-${other}-${date.year}-${date.month}`,
          date,
          entityId: ai.entityId,
          category: 'diplomacy',
          title: 'IA estratégica: acordo comercial',
          text: `${ai.entityId} identificou ${other} como parceiro economicamente útil e concluiu um acordo comercial após avaliar interesse, confiança e relação bilateral.`,
        });
      } else if (focus === 'diplomacy' && best.score >= 64 && best.trust >= 58 && ai.riskTolerance >= 38 && !hasTreaty(next, ai.entityId, other, 'alliance')) {
        next = signAITreaty(next, best, 'alliance', date);
        generatedEvents.push({
          id: `ai-alliance-${ai.entityId}-${other}-${date.year}-${date.month}`,
          date,
          entityId: ai.entityId,
          category: 'diplomacy',
          title: 'IA estratégica: alinhamento',
          text: `${ai.entityId} decidiu aprofundar sua segurança externa e formalizou uma aliança com ${other}.`,
        });
      }
    }

    if (focus === 'technology') {
      const best = [...relations].sort((a, b) => (b.trust + b.score) - (a.trust + a.score))[0];
      const other = counterpart(best, ai.entityId);
      if (best.trust >= 55 && best.score >= 46 && !hasTreaty(next, ai.entityId, other, 'technology')) {
        next = signAITreaty(next, best, 'technology', date);
        generatedEvents.push({
          id: `ai-tech-${ai.entityId}-${other}-${date.year}-${date.month}`,
          date,
          entityId: ai.entityId,
          category: 'technology',
          title: 'IA estratégica: cooperação tecnológica',
          text: `${ai.entityId} buscou reduzir sua defasagem por meio de cooperação tecnológica com ${other}.`,
        });
      }
    }

    if (focus === 'military' && ai.aggression >= 62) {
      const tense = [...relations].sort((a, b) => (b.threat - b.score * 0.35) - (a.threat - a.score * 0.35))[0];
      const other = counterpart(tense, ai.entityId);
      const key = pairKey(ai.entityId, other);
      const updated: DiplomaticRelation = {
        ...tense,
        score: clamp(tense.score - 2.5),
        trust: clamp(tense.trust - 2),
        threat: clamp(tense.threat + 3),
        memory: [`Pressão estratégica de ${ai.entityId} durante a campanha`, ...tense.memory].slice(0, 8),
      };
      next = { ...next, diplomacy: { ...next.diplomacy, [key]: updated } };
      generatedEvents.push({
        id: `ai-pressure-${ai.entityId}-${other}-${date.year}-${date.month}`,
        date,
        entityId: ai.entityId,
        category: 'military',
        title: 'IA estratégica: pressão sobre rival',
        text: `${ai.entityId} passou a tratar ${other} como preocupação estratégica e elevou sua pressão diplomático-militar.`,
      });
    }
  }

  if (generatedEvents.length) {
    next = { ...next, events: [...generatedEvents.slice(0, 6), ...next.events].slice(0, 50) };
  }
  return next;
}

export function simulateDays(state: SimulationState, days: number): SimulationState {
  let next: SimulationState = {
    ...state,
    entities: { ...state.entities },
    diplomacy: { ...state.diplomacy },
    treaties: [...state.treaties],
    strategicAI: { ...state.strategicAI },
    events: [...state.events],
  };

  for (let i = 0; i < days; i += 1) {
    const date = addDays(next.date, 1);
    const entities: Record<string, EntityRuntime> = {};

    for (const current of Object.values(next.entities)) {
      const seed = dateSeed(date, current.id);
      const monthly = date.day === 1;
      const yearly = date.month === 1 && date.day === 1;
      const n = noise(seed);
      const agreements = treatyEffects(next, current.id);
      const ai = next.strategicAI[current.id];

      let economyIndex = current.economyIndex;
      let populationIndex = current.populationIndex;
      let stability = current.stability;
      let militaryReadiness = current.militaryReadiness;
      let technology = current.technology;
      let treasuryIndex = current.treasuryIndex;

      if (monthly) {
        const stabilityEffect = (stability - 50) / 500;
        economyIndex = clamp(economyIndex + stabilityEffect + n * 0.35 + agreements.trade * 0.035 + (ai?.focus === 'economy' ? 0.025 : 0));
        treasuryIndex = clamp(treasuryIndex + (economyIndex - 50) / 500 + n * 0.18 + agreements.trade * 0.01 + (ai?.focus === 'economy' ? 0.012 : 0));
        stability = clamp(stability + (economyIndex - 50) / 900 + n * 0.12 + agreements.alliance * 0.008 + (ai?.focus === 'stability' ? 0.03 : 0));
        militaryReadiness = clamp(militaryReadiness + (treasuryIndex - 45) / 1600 + n * 0.08 + agreements.alliance * 0.01 + (ai?.focus === 'military' ? 0.025 : 0));
        technology = clamp(technology + agreements.technology * 0.012 + (ai?.focus === 'technology' ? 0.018 : 0));
      }

      if (yearly) {
        populationIndex = clamp(populationIndex + 0.35 + n * 0.45);
        technology = clamp(technology + 0.22 + Math.max(0, economyIndex - 45) / 900 + n * 0.16);
      }

      entities[current.id] = { ...current, economyIndex, populationIndex, stability, militaryReadiness, technology, treasuryIndex };
    }

    next = { ...next, date, entities, elapsedDays: next.elapsedDays + 1 };

    if (date.day === 1 && [1, 4, 7, 10].includes(date.month)) {
      next = runStrategicAI(next, date);
    }

    if (date.day === 1 && date.month === 1) {
      const annualEvent: WorldEvent = {
        id: `year-${date.year}`,
        date,
        category: 'world',
        title: `Início de ${date.year}`,
        text: 'Economia, população, estabilidade, tecnologia, tratados e objetivos estratégicos receberam seus ciclos anuais.',
      };
      next.events = [annualEvent, ...next.events].slice(0, 50);
    }
  }

  return next;
}

export function applyDiplomaticAction(state: SimulationState, fromId: string, toId: string, message: string): SimulationState {
  const key = pairKey(fromId, toId);
  const current = state.diplomacy[key];
  if (!current) return state;

  const text = message.toLowerCase();
  const relation: DiplomaticRelation = { ...current, memory: [...current.memory], treaties: [...current.treaties] };
  const treaties = [...state.treaties];
  let outcome = 'A conversa foi registrada e passará a fazer parte da memória bilateral.';
  let newTreaty: TreatyType | null = null;

  if (/comérc|tarifa|mercador|porto|acordo econômico/.test(text)) {
    const accepted = relation.tradeInterest >= 65 && relation.score >= 38;
    relation.score = clamp(relation.score + (accepted ? 5 : 1));
    relation.trust = clamp(relation.trust + (accepted ? 4 : 1));
    relation.memory.unshift(accepted ? 'Acordo comercial negociado durante a campanha' : 'Proposta comercial sem acordo formal');
    if (accepted) { newTreaty = 'trade'; outcome = 'A proposta comercial foi aceita e um acordo de comércio entrou em vigor.'; }
  } else if (/alian|defesa mútua|pacto militar/.test(text)) {
    const accepted = relation.score >= 65 && relation.trust >= 60 && relation.threat < 65;
    relation.score = clamp(relation.score + (accepted ? 7 : -1));
    relation.trust = clamp(relation.trust + (accepted ? 6 : -1));
    relation.memory.unshift(accepted ? 'Aliança formal assinada durante a campanha' : 'Proposta de aliança recusada');
    if (accepted) { newTreaty = 'alliance'; outcome = 'A aliança foi aceita e passa a influenciar segurança e prontidão.'; }
    else outcome = 'A aliança não reuniu confiança suficiente para ser aceita.';
  } else if (/tecnolog|engenheir|licença|conhecimento/.test(text)) {
    const accepted = relation.trust >= 58 && relation.score >= 48;
    relation.trust = clamp(relation.trust + (accepted ? 4 : 0));
    relation.memory.unshift(accepted ? 'Cooperação tecnológica assinada' : 'Cooperação tecnológica discutida sem acordo');
    if (accepted) { newTreaty = 'technology'; outcome = 'Foi estabelecida cooperação tecnológica entre as partes.'; }
  } else if (/ultimato|ameaç|exijo|retir/.test(text)) {
    relation.score = clamp(relation.score - 9);
    relation.trust = clamp(relation.trust - 10);
    relation.threat = clamp(relation.threat + 12);
    relation.memory.unshift('Pressão diplomática ou ultimato durante a campanha');
    outcome = 'O tom coercitivo piorou a relação, reduziu confiança e elevou a ameaça percebida.';
  } else {
    relation.score = clamp(relation.score + 1);
    relation.trust = clamp(relation.trust + 0.5);
    relation.memory.unshift('Contato diplomático recente');
  }

  if (newTreaty) {
    const already = treaties.some((item) => item.active && item.type === newTreaty && pairKey(...item.parties) === key);
    if (!already) {
      const treaty: Treaty = {
        id: `${newTreaty}-${key}-${state.elapsedDays}`,
        type: newTreaty,
        parties: [fromId, toId],
        signedAt: state.date,
        active: true,
      };
      treaties.push(treaty);
      relation.treaties.push(treaty.id);
    }
  }

  const event: WorldEvent = {
    id: `dip-${state.elapsedDays}-${fromId}-${toId}`,
    date: state.date,
    entityId: fromId,
    category: 'diplomacy',
    title: 'Negociação diplomática',
    text: `${fromId} → ${toId}: ${message} — ${outcome}`,
  };

  return {
    ...state,
    diplomacy: { ...state.diplomacy, [key]: relation },
    treaties,
    events: [event, ...state.events].slice(0, 50),
  };
}

export function applyPlayerDirective(state: SimulationState, entityId: string, directive: string): SimulationState {
  const current = state.entities[entityId];
  if (!current) return state;

  const text = directive.toLowerCase();
  const updated = { ...current };
  let category: WorldEvent['category'] = 'politics';
  let consequence = 'A ordem foi registrada como decisão estratégica. Seus efeitos serão resolvidos pelos sistemas da simulação.';

  if (/econom|indústr|comérc|impost|infra|ferrovia/.test(text)) {
    category = 'economy';
    updated.economyIndex = clamp(updated.economyIndex + 0.6);
    updated.treasuryIndex = clamp(updated.treasuryIndex - 0.3);
    consequence = 'A prioridade econômica aumenta atividade potencial, mas exige recursos do tesouro.';
  } else if (/militar|exército|frota|guerra|defesa|fronteira/.test(text)) {
    category = 'military';
    updated.militaryReadiness = clamp(updated.militaryReadiness + 0.7);
    updated.treasuryIndex = clamp(updated.treasuryIndex - 0.4);
    consequence = 'A prontidão militar aumentou, com custo fiscal inicial.';
  } else if (/tecnolog|pesquisa|universidade|engenheir|moderniz/.test(text)) {
    category = 'technology';
    updated.technology = clamp(updated.technology + 0.45);
    updated.treasuryIndex = clamp(updated.treasuryIndex - 0.25);
    consequence = 'O investimento melhora a capacidade tecnológica, mas a adoção completa continuará dependendo do tempo e dos pré-requisitos.';
  } else if (/popula|saúde|educa|moradia|salário/.test(text)) {
    category = 'population';
    updated.populationIndex = clamp(updated.populationIndex + 0.35);
    updated.stability = clamp(updated.stability + 0.25);
    updated.treasuryIndex = clamp(updated.treasuryIndex - 0.35);
    consequence = 'A política social melhora bem-estar e estabilidade, com impacto no orçamento.';
  }

  const directiveEvent: WorldEvent = {
    id: `directive-${state.elapsedDays}-${Date.now()}`,
    date: state.date,
    entityId,
    category,
    title: 'Diretriz do jogador',
    text: `${directive} — ${consequence}`,
  };

  return {
    ...state,
    entities: { ...state.entities, [entityId]: updated },
    events: [directiveEvent, ...state.events].slice(0, 50),
  };
}
