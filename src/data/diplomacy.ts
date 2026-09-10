import type { ScenarioEntity } from './scenarios';

export type RelationState = {
  score: number;
  trust: number;
  tradeInterest: number;
  threat: number;
  memory: string[];
};

const explicit: Record<string, Partial<Record<string, Partial<RelationState>>>> = {
  'portugal-1500': {
    'castile-1500': { score: 58, trust: 55, tradeInterest: 62, threat: 41, memory: ['Rivalidade peninsular moderada', 'Interesses marítimos parcialmente concorrentes'] },
    'venice-1500': { score: 42, trust: 39, tradeInterest: 76, threat: 18, memory: ['Interesse comercial no Mediterrâneo', 'Concorrência por rotas orientais'] },
    'ottoman-1500': { score: 18, trust: 20, tradeInterest: 44, threat: 47, memory: ['Interesses estratégicos distintos no comércio oriental'] },
  },
  'castile-1500': {
    'aragon-1500': { score: 82, trust: 78, tradeInterest: 67, threat: 15, memory: ['União dinástica e cooperação política'] },
    'france-1500': { score: 26, trust: 31, tradeInterest: 49, threat: 61, memory: ['Competição continental'] },
  },
  'ottoman-1500': {
    'mamluk-1500': { score: 24, trust: 22, tradeInterest: 55, threat: 69, memory: ['Competição regional e estratégica'] },
    'venice-1500': { score: 37, trust: 34, tradeInterest: 79, threat: 33, memory: ['Comércio relevante apesar de rivalidades'] },
  },
  'england-1500': {
    'scotland-1500': { score: 20, trust: 18, tradeInterest: 35, threat: 72, memory: ['Rivalidade fronteiriça e dinástica'] },
    'france-1500': { score: 29, trust: 30, tradeInterest: 48, threat: 58, memory: ['Rivalidade histórica e interesses continentais'] },
  },
  'brazil': {
    'usa-2026': { score: 69, trust: 66, tradeInterest: 82, threat: 14, memory: ['Relação diplomática estável', 'Interesses comerciais relevantes'] },
    'china-2026': { score: 72, trust: 63, tradeInterest: 91, threat: 17, memory: ['Forte relação comercial'] },
  },
  'japan-2026': {
    'usa-2026': { score: 86, trust: 84, tradeInterest: 88, threat: 9, memory: ['Aliança e cooperação estratégica'] },
    'china-2026': { score: 43, trust: 38, tradeInterest: 86, threat: 54, memory: ['Alta interdependência econômica', 'Tensões estratégicas regionais'] },
  },
};

function hash(text: string) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h >>> 0);
}

function fallback(a: ScenarioEntity, b: ScenarioEntity, year: number): RelationState {
  const seed = hash(`${a.id}:${b.id}:${year}`);
  const specialtyOverlap = a.specialty.split(/[, ]+/).some((token) => token.length > 6 && b.specialty.toLowerCase().includes(token.toLowerCase()));
  const base = 38 + (seed % 31);
  return {
    score: Math.max(10, Math.min(90, base + (specialtyOverlap ? 6 : 0))),
    trust: Math.max(12, Math.min(88, base - 4 + (seed % 9))),
    tradeInterest: Math.max(18, Math.min(94, 42 + (seed % 45))),
    threat: Math.max(5, Math.min(85, 18 + ((seed >> 4) % 48))),
    memory: ['Sem memória diplomática específica validada neste protótipo'],
  };
}

export function relationBetween(a: ScenarioEntity, b: ScenarioEntity, year: number): RelationState {
  const direct = explicit[a.id]?.[b.id];
  const reverse = explicit[b.id]?.[a.id];
  const data = direct ?? reverse;
  if (!data) return fallback(a, b, year);
  const base = fallback(a, b, year);
  return {
    score: data.score ?? base.score,
    trust: data.trust ?? base.trust,
    tradeInterest: data.tradeInterest ?? base.tradeInterest,
    threat: data.threat ?? base.threat,
    memory: data.memory ?? base.memory,
  };
}

export function diplomaticReply(
  from: ScenarioEntity,
  to: ScenarioEntity,
  message: string,
  year: number,
) {
  const relation = relationBetween(from, to, year);
  const text = message.toLowerCase();
  const friendly = relation.score >= 65;
  const tense = relation.score <= 32 || relation.threat >= 65;

  if (/alian|defesa|militar/.test(text)) {
    if (friendly && relation.trust >= 60) return `${to.name} demonstra abertura para discutir cooperação militar, mas exige termos claros, reciprocidade e compatibilidade com seus interesses estratégicos.`;
    if (tense) return `${to.name} considera uma aliança prematura. O governo prefere reduzir tensões e observar suas intenções antes de assumir compromissos militares.`;
    return `${to.name} aceita iniciar conversas exploratórias sobre segurança, sem compromisso formal neste momento.`;
  }
  if (/comérc|tarifa|porto|mercador|acordo econômico/.test(text)) {
    if (relation.tradeInterest >= 70) return `${to.name} vê forte potencial comercial na proposta e solicita detalhes sobre tarifas, acesso a mercados e duração do acordo.`;
    return `${to.name} aceita avaliar a proposta comercial, mas quer garantias de benefício mútuo e proteção aos seus interesses internos.`;
  }
  if (/ameaç|ultimato|exijo|retir/.test(text)) {
    if (tense) return `${to.name} rejeita a pressão e considera a mensagem uma escalada. Sua ameaça percebida aumentará caso o tom seja mantido.`;
    return `${to.name} recebeu a exigência com preocupação e propõe negociação antes de qualquer medida irreversível.`;
  }
  if (/tecnolog|engenheir|conhecimento|licença/.test(text)) {
    return `${to.name} pode considerar cooperação técnica, mas avaliará o valor estratégico da tecnologia, o nível de confiança e possíveis contrapartidas.`;
  }
  return friendly
    ? `${to.name} responde em tom construtivo. O governo considera a relação suficientemente positiva para continuar a negociação e pede uma proposta mais concreta.`
    : tense
      ? `${to.name} responde com cautela. Rivalidades, ameaças percebidas e baixa confiança limitam o espaço para concessões.`
      : `${to.name} mantém posição pragmática e está disposto a conversar, desde que a proposta seja compatível com seus interesses atuais.`;
}
