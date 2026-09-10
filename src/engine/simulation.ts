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

function dateSeed(date: GameDate, entityId: string) {
  return date.year * 372 + date.month * 31 + date.day + [...entityId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export function createInitialRuntime(date: GameDate, entities: ScenarioEntity[]): SimulationState {
  const runtime: Record<string, EntityRuntime> = {};
  const diplomacy: Record<string, DiplomaticRelation> = {};

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
  }

  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      const base = relationBetween(a, b, date.year);
      diplomacy[pairKey(a.id, b.id)] = { ...base, parties: [a.id, b.id], treaties: [] };
    }
  }

  return { date, entities: runtime, diplomacy, treaties: [], events: [], elapsedDays: 0 };
}

function treatyEffects(state: SimulationState, entityId: string) {
  const active = state.treaties.filter((treaty) => treaty.active && treaty.parties.includes(entityId));
  return {
    trade: active.filter((item) => item.type === 'trade').length,
    alliance: active.filter((item) => item.type === 'alliance').length,
    technology: active.filter((item) => item.type === 'technology').length,
  };
}

export function simulateDays(state: SimulationState, days: number): SimulationState {
  let next: SimulationState = {
    ...state,
    entities: { ...state.entities },
    diplomacy: { ...state.diplomacy },
    treaties: [...state.treaties],
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

      let economyIndex = current.economyIndex;
      let populationIndex = current.populationIndex;
      let stability = current.stability;
      let militaryReadiness = current.militaryReadiness;
      let technology = current.technology;
      let treasuryIndex = current.treasuryIndex;

      if (monthly) {
        const stabilityEffect = (stability - 50) / 500;
        economyIndex = clamp(economyIndex + stabilityEffect + n * 0.35 + agreements.trade * 0.035);
        treasuryIndex = clamp(treasuryIndex + (economyIndex - 50) / 500 + n * 0.18 + agreements.trade * 0.01);
        stability = clamp(stability + (economyIndex - 50) / 900 + n * 0.12 + agreements.alliance * 0.008);
        militaryReadiness = clamp(militaryReadiness + (treasuryIndex - 45) / 1600 + n * 0.08 + agreements.alliance * 0.01);
        technology = clamp(technology + agreements.technology * 0.012);
      }

      if (yearly) {
        populationIndex = clamp(populationIndex + 0.35 + n * 0.45);
        technology = clamp(technology + 0.22 + Math.max(0, economyIndex - 45) / 900 + n * 0.16);
      }

      entities[current.id] = { ...current, economyIndex, populationIndex, stability, militaryReadiness, technology, treasuryIndex };
    }

    next = { ...next, date, entities, elapsedDays: next.elapsedDays + 1 };

    if (date.day === 1 && [1, 4, 7, 10].includes(date.month)) {
      const relations = Object.values(next.diplomacy).filter((item) => item.tradeInterest >= 72 || item.score >= 68);
      if (relations.length) {
        const chosen = relations[(date.year + date.month) % relations.length];
        const event: WorldEvent = {
          id: `foreign-diplomacy-${date.year}-${date.month}`,
          date,
          entityId: chosen.parties[0],
          category: 'diplomacy',
          title: 'Iniciativa diplomática estrangeira',
          text: `Canais diplomáticos entre ${chosen.parties[0]} e ${chosen.parties[1]} demonstram interesse em aprofundar contatos. A proposta formal ainda dependerá dos objetivos e da memória de cada lado.`,
        };
        next.events = [event, ...next.events].slice(0, 40);
      }
    }

    if (date.day === 1 && date.month === 1) {
      const annualEvent: WorldEvent = {
        id: `year-${date.year}`,
        date,
        category: 'world',
        title: `Início de ${date.year}`,
        text: 'Economia, população, estabilidade, tecnologia e tratados ativos receberam seus ticks anuais.',
      };
      next.events = [annualEvent, ...next.events].slice(0, 40);
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
    events: [event, ...state.events].slice(0, 40),
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
    events: [directiveEvent, ...state.events].slice(0, 40),
  };
}
