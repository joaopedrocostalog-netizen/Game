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

export type WorldEvent = {
  id: string;
  date: GameDate;
  entityId?: string;
  category: 'economy' | 'population' | 'politics' | 'military' | 'technology' | 'world';
  title: string;
  text: string;
};

export type SimulationState = {
  date: GameDate;
  entities: Record<string, EntityRuntime>;
  events: WorldEvent[];
  elapsedDays: number;
};

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

export function createInitialRuntime(
  date: GameDate,
  entities: Array<{ id: string; stability: number; military: number; technology: number }>,
): SimulationState {
  const runtime: Record<string, EntityRuntime> = {};
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
  return { date, entities: runtime, events: [], elapsedDays: 0 };
}

export function simulateDays(state: SimulationState, days: number): SimulationState {
  let next: SimulationState = { ...state, entities: { ...state.entities }, events: [...state.events] };

  for (let i = 0; i < days; i += 1) {
    const date = addDays(next.date, 1);
    const entities: Record<string, EntityRuntime> = {};

    for (const current of Object.values(next.entities)) {
      const seed = dateSeed(date, current.id);
      const monthly = date.day === 1;
      const yearly = date.month === 1 && date.day === 1;
      const n = noise(seed);

      let economyIndex = current.economyIndex;
      let populationIndex = current.populationIndex;
      let stability = current.stability;
      let militaryReadiness = current.militaryReadiness;
      let technology = current.technology;
      let treasuryIndex = current.treasuryIndex;

      if (monthly) {
        const stabilityEffect = (stability - 50) / 500;
        economyIndex = clamp(economyIndex + stabilityEffect + n * 0.35);
        treasuryIndex = clamp(treasuryIndex + (economyIndex - 50) / 500 + n * 0.18);
        stability = clamp(stability + (economyIndex - 50) / 900 + n * 0.12);
        militaryReadiness = clamp(militaryReadiness + (treasuryIndex - 45) / 1600 + n * 0.08);
      }

      if (yearly) {
        populationIndex = clamp(populationIndex + 0.35 + n * 0.45);
        technology = clamp(technology + 0.22 + Math.max(0, economyIndex - 45) / 900 + n * 0.16);
      }

      entities[current.id] = {
        ...current,
        economyIndex,
        populationIndex,
        stability,
        militaryReadiness,
        technology,
        treasuryIndex,
      };
    }

    next = { ...next, date, entities, elapsedDays: next.elapsedDays + 1 };

    if (date.day === 1 && date.month === 1) {
      const annualEvent: WorldEvent = {
        id: `year-${date.year}`,
        date,
        category: 'world',
        title: `Início de ${date.year}`,
        text: 'Economia, população, estabilidade e tecnologia receberam seus ticks anuais.',
      };
      next.events = [annualEvent, ...next.events].slice(0, 30);
    }
  }

  return next;
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
    events: [directiveEvent, ...state.events].slice(0, 30),
  };
}
